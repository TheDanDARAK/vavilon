import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { getGames, Game, saveGames, backupLibrary } from './library'
import { mergeGames } from './profileMerge'

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

/** Merge mode: one read, one atomic write, one broadcast. */
export function mergeProfile(incoming: Game[]): { added: number; updated: number } {
  const merged = mergeGames(getGames(), incoming)
  if (merged.added > 0 || merged.updated > 0) saveGames(merged.games)
  return { added: merged.added, updated: merged.updated }
}

/** Replace mode: build the whole library first, then write it once. */
function replaceProfile(incoming: Game[]): { added: number; updated: number } {
  // keep a backup first, so an accidental replace is recoverable
  backupLibrary()
  const merged = mergeGames([], incoming)
  saveGames(merged.games)
  return { added: merged.added, updated: 0 }
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

    // invalid entries are skipped rather than aborting an already wiped library
    const games = profile.games.filter((g) => g && typeof g.exePath === 'string' && g.exePath)
    return mode === 'replace' ? replaceProfile(games) : mergeProfile(games)
  })
}
