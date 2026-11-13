import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { basename, dirname } from 'path'
import { getGames, Game, updateGame, addGameRecord, saveGames, backupLibrary } from './library'

interface ProfileFile {
  app: 'my-launcher' | 'vavilon'
  version: number
  exportedAt: number
  games: Game[]
}

const PROFILE_VERSION = 2

function buildProfile(): ProfileFile {
  return {
    app: 'vavilon',
    version: PROFILE_VERSION,
    exportedAt: Date.now(),
    games: getGames()
  }
}

/** Normalizes an imported record: new unique id + all required fields present. */
function normalizeImported(inc: Game): Game {
  return {
    id: `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: inc.name || basename(inc.exePath, '.exe'),
    exePath: inc.exePath,
    workDir: inc.workDir || dirname(inc.exePath),
    args: inc.args ?? [],
    appId: inc.appId,
    coverPath: inc.coverPath,
    playtimeSeconds: inc.playtimeSeconds ?? 0,
    lastPlayedAt: inc.lastPlayedAt,
    addedAt: inc.addedAt ?? Date.now(),
    achievements: inc.achievements ?? []
  }
}

/**
 * Merges imported games into the library.
 * A game is considered the same if it has the same exePath (case-insensitive)
 * or the same Steam appId.
 * Achievements are merged by API name: unlock timestamps are kept (max wins).
 * Games missing from the library are added back (this is what makes profiles
 * survive reinstalls: export -> delete game -> import -> game returns).
 */
export function mergeProfile(incoming: Game[]): { added: number; updated: number } {
  let added = 0
  let updated = 0

  for (const inc of incoming) {
    if (!inc.exePath) continue
    const existing = getGames()
    const match = existing.find(
      (g) =>
        g.exePath.toLowerCase() === inc.exePath.toLowerCase() ||
        (inc.appId !== undefined && g.appId !== undefined && g.appId === inc.appId)
    )

    if (!match) {
      addGameRecord(normalizeImported(inc))
      added++
      continue
    }

    const mergedAchievements = mergeAchievements(match.achievements ?? [], inc.achievements ?? [])
    updateGame(match.id, {
      achievements: mergedAchievements,
      playtimeSeconds: Math.max(match.playtimeSeconds ?? 0, inc.playtimeSeconds ?? 0),
      lastPlayedAt: Math.max(match.lastPlayedAt ?? 0, inc.lastPlayedAt ?? 0) || undefined,
      appId: match.appId ?? inc.appId,
      coverPath: match.coverPath ?? inc.coverPath
    })
    updated++
  }
  return { added, updated }
}

function mergeAchievements(a: Game['achievements'], b: Game['achievements']): Game['achievements'] {
  const map = new Map<string, NonNullable<Game['achievements']>[number]>()
  for (const ach of [...(a ?? []), ...(b ?? [])]) {
    const prev = map.get(ach.api)
    if (!prev || ((ach.unlockedAt ?? 0) > (prev.unlockedAt ?? 0) && ach.unlockedAt)) {
      map.set(ach.api, ach)
    }
  }
  return Array.from(map.values())
}

export function registerProfileIpc(ipc: typeof ipcMain): void {
  ipc.handle('profile:export', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showSaveDialog(win as BrowserWindow, {
      title: 'Экспорт профиля',
      defaultPath: `vavilon-profile-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'Профиль Vavilon', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, JSON.stringify(buildProfile(), null, 2), 'utf-8')
    return result.filePath
  })

  ipc.handle('profile:import', async (event, mode: 'merge' | 'replace') => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: 'Импорт профиля',
      filters: [{ name: 'Профиль Vavilon', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const raw = readFileSync(result.filePaths[0], 'utf-8')
    const profile = JSON.parse(raw) as ProfileFile
    if (
      (profile.app !== 'vavilon' && profile.app !== 'my-launcher') ||
      !Array.isArray(profile.games)
    ) {
      throw new Error('Это не профиль Vavilon')
    }

    if (mode === 'replace') {
      // keep a backup first, so an accidental replace is recoverable
      backupLibrary()
      // wipe the library, then import everything from the profile
      saveGames([])
      return mergeProfile(profile.games)
    }
    return mergeProfile(profile.games)
  })
}
