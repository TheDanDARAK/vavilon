import { ipcMain, dialog, app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname, basename } from 'path'
import type { Game } from '../shared/types'

export type { Game, AchievementRecord } from '../shared/types'

interface LibraryFile {
  version: number
  games: Game[]
}

const LIBRARY_VERSION = 1

function libraryPath(): string {
  return join(app.getPath('userData'), 'library.json')
}

/** Notifies all windows that the library changed, so the UI reloads. */
export function broadcastChange(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('games:changed')
  }
}

function loadLibrary(): LibraryFile {
  try {
    const raw = readFileSync(libraryPath(), 'utf-8')
    const data = JSON.parse(raw) as LibraryFile
    if (Array.isArray(data.games)) {
      return { version: LIBRARY_VERSION, games: data.games }
    }
  } catch {
    // first run or corrupted file
  }
  return { version: LIBRARY_VERSION, games: [] }
}

function saveLibrary(lib: LibraryFile): void {
  writeFileSync(libraryPath(), JSON.stringify(lib, null, 2), 'utf-8')
}

export function getGames(): Game[] {
  return loadLibrary().games
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
  saveLibrary({ version: LIBRARY_VERSION, games })
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
    lib.games = lib.games.filter((g) => g.id !== id)
    saveLibrary(lib)
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
      suggestedName: basename(exePath, '.exe')
    }
  })
}
