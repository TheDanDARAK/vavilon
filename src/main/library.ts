import { ipcMain, dialog, app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'fs'
import { join, dirname, basename, extname } from 'path'
import type { Game, WishlistEntry } from '../shared/types'

export type { Game, AchievementRecord, WishlistEntry } from '../shared/types'

interface LibraryFile {
  version: number
  games: Game[]
  wishlist?: WishlistEntry[]
}

const LIBRARY_VERSION = 1

function libraryPath(): string {
  return join(app.getPath('userData'), 'library.json')
}

/**
 * Crash-safe JSON write: data lands in a temp file first and is then renamed
 * over the real one, so a power cut mid-write can never truncate the file.
 */
function atomicWrite(file: string, data: string): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data, 'utf-8')
  renameSync(tmp, file)
}

/** Copies the current library file to library.json.bak (used before destructive ops). */
export function backupLibrary(): void {
  const path = libraryPath()
  if (existsSync(path)) copyFileSync(path, `${path}.bak`)
}

/** Notifies all windows that the library changed, so the UI reloads. */
export function broadcastChange(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('games:changed')
  }
}

function loadLibrary(): LibraryFile {
  // main file first, then the .bak copy (created before destructive operations)
  for (const path of [libraryPath(), `${libraryPath()}.bak`]) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8')) as LibraryFile
      if (Array.isArray(data.games)) {
        return {
          version: LIBRARY_VERSION,
          games: data.games,
          wishlist: Array.isArray(data.wishlist) ? data.wishlist : []
        }
      }
    } catch {
      // missing or corrupted — try the next source
    }
  }
  return { version: LIBRARY_VERSION, games: [], wishlist: [] }
}

function saveLibrary(lib: LibraryFile): void {
  atomicWrite(libraryPath(), JSON.stringify(lib, null, 2))
}

export function getGames(): Game[] {
  return loadLibrary().games
}

/* ---------- wishlist (storefront "хочу поиграть") ---------- */

export function getWishlist(): WishlistEntry[] {
  return loadLibrary().wishlist ?? []
}

export function addToWishlist(entry: WishlistEntry): WishlistEntry[] {
  const lib = loadLibrary()
  lib.wishlist ??= []
  if (!lib.wishlist.some((w) => w.id === entry.id)) {
    lib.wishlist.push({ ...entry, addedAt: Date.now() })
    saveLibrary(lib)
    broadcastChange()
  }
  return lib.wishlist
}

export function removeFromWishlist(rawgId: number): WishlistEntry[] {
  const lib = loadLibrary()
  if (lib.wishlist?.some((w) => w.id === rawgId)) {
    lib.wishlist = lib.wishlist.filter((w) => w.id !== rawgId)
    saveLibrary(lib)
    broadcastChange()
  }
  return lib.wishlist ?? []
}

export function updateGame(id: string, patch: Partial<Game>): void {
  const lib = loadLibrary()
  const idx = lib.games.findIndex((g) => g.id === id)
  if (idx >= 0) {
    lib.games[idx] = { ...lib.games[idx], ...patch }
    saveLibrary(lib)
    broadcastChange()
  }
}

function newId(): string {
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Persists a complete game record (used by profile import). */
export function addGameRecord(game: Game): Game {
  const lib = loadLibrary()
  lib.games.push(game)
  saveLibrary(lib)
  broadcastChange()
  return game
}

/** Replaces the whole library (used by profile import in "replace" mode). */
export function saveGames(games: Game[]): void {
  saveLibrary({ version: LIBRARY_VERSION, games, wishlist: loadLibrary().wishlist })
  broadcastChange()
}

export function registerLibraryIpc(ipc: typeof ipcMain): void {
  ipc.handle('games:list', () => getGames())

  ipc.handle('games:add', async (event, game: Partial<Game> & { exePath: string }) => {
    const lib = loadLibrary()

    // Duplicate protection: same exe (or same Steam appId) is already in the library
    const existing = lib.games.find(
      (g) =>
        g.exePath.toLowerCase() === game.exePath.toLowerCase() ||
        (game.appId !== undefined && g.appId !== undefined && g.appId === game.appId)
    )
    if (existing) {
      return { game: existing, duplicated: true }
    }

    const gameToAdd: Game = {
      id: newId(),
      name: game.name || basename(game.exePath, '.exe'),
      exePath: game.exePath,
      workDir: game.workDir || dirname(game.exePath),
      args: game.args || [],
      appId: game.appId,
      coverPath: game.coverPath,
      playtimeSeconds: game.playtimeSeconds ?? 0,
      addedAt: Date.now(),
      achievements: game.achievements || []
    }
    lib.games.push(gameToAdd)
    saveLibrary(lib)
    broadcastChange()
    return { game: gameToAdd, duplicated: false }
  })

  ipc.handle('games:update', (_event, id: string, patch: Partial<Game>) => {
    updateGame(id, patch)
    return true
  })

  ipc.handle('games:remove', (_event, id: string) => {
    const lib = loadLibrary()
    const removed = lib.games.find((g) => g.id === id)
    lib.games = lib.games.filter((g) => g.id !== id)
    saveLibrary(lib)

    // drop the cached cover, but only if it is our own copy in the covers folder
    if (removed?.coverPath) {
      const coversDir = join(app.getPath('userData'), 'covers')
      if (removed.coverPath.startsWith(coversDir)) {
        try {
          rmSync(removed.coverPath)
        } catch {
          // ignore
        }
      }
    }
    broadcastChange()
    return true
  })

  ipc.handle('games:pickExe', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: 'Выберите exe-файл игры',
      filters: [{ name: 'Исполняемые файлы', extensions: ['exe'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const exePath = result.filePaths[0]
    return {
      exePath,
      suggestedName: basename(exePath, '.exe'),
      suggestedWorkDir: dirname(exePath)
    }
  })

  /** Picks an image file, copies it into the covers cache and sets it as the game cover. */
  ipc.handle('games:pickCover', async (event, gameId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: 'Выберите обложку',
      filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const src = result.filePaths[0]
    const coversDir = join(app.getPath('userData'), 'covers')
    mkdirSync(coversDir, { recursive: true })

    // drop any previous cached copy of this game's cover (possibly another format)
    try {
      for (const file of readdirSync(coversDir)) {
        if (file.startsWith(`${gameId}.`)) rmSync(join(coversDir, file))
      }
    } catch {
      // ignore cleanup errors
    }

    const dest = join(coversDir, `${gameId}${extname(src).toLowerCase()}`)
    copyFileSync(src, dest)
    updateGame(gameId, { coverPath: dest })
    return dest
  })

  /** Clears the cover and removes the cached copy from the covers folder. */
  ipc.handle('games:removeCover', (_event, gameId: string) => {
    const game = getGames().find((g) => g.id === gameId)
    const cover = game?.coverPath
    updateGame(gameId, { coverPath: undefined })
    // delete only our own cached copy, never a user file from elsewhere
    if (cover && cover.startsWith(join(app.getPath('userData'), 'covers'))) {
      try {
        rmSync(cover)
      } catch {
        // ignore
      }
    }
    return true
  })
}
