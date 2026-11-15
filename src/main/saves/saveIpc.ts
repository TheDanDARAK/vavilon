import { ipcMain, dialog, BrowserWindow } from 'electron'
import { loadSettings, saveSettingsPatch, applyAutostart } from './saveSettings'
import { backupGame, restoreGame, findNameByAppId, clearNameCache } from './ludusavi'
import { getGames } from '../library'
import { syncNowSilently, restartAchievementWatcher } from '../achievements/watcher'

interface SaveStatusPayload {
  stage: 'sync' | 'restore' | 'launch'
  gameName: string
  ok: boolean
  message?: string
}

function sendStatus(win: BrowserWindow | null, payload: SaveStatusPayload): void {
  win?.webContents.send('saves:status', payload)
}

export function registerGeneralIpc(): void {
  ipcMain.handle('general:get', () => loadSettings().general)

  ipcMain.handle('general:set', (_event, patch: Partial<LauncherSettingsGeneral>) => {
    const next = saveSettingsPatch({ general: { ...loadSettings().general, ...patch } })
    applyAutostart()
    return next.general
  })

  ipcMain.handle('ach:get', () => loadSettings().achievements)

  ipcMain.handle('ach:set', (_event, patch: Partial<LauncherSettingsAch>) => {
    const next = saveSettingsPatch({ achievements: { ...loadSettings().achievements, ...patch } })
    // the polling loop reads the interval at start — restart it
    restartAchievementWatcher()
    return next.achievements
  })
}

type LauncherSettingsGeneral = ReturnType<typeof loadSettings>['general']
type LauncherSettingsAch = ReturnType<typeof loadSettings>['achievements']

export function registerSavesIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('saves:get', () => loadSettings().saves)

  ipcMain.handle('saves:set', (_event, patch: Partial<LauncherSettingsSaves>) => {
    const current = loadSettings().saves
    const next = saveSettingsPatch({ saves: { ...current, ...patch } })
    clearNameCache()
    return next.saves
  })

  ipcMain.handle('saves:pickLudusavi', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: 'Выберите ludusavi.exe',
      filters: [{ name: 'ludusavi', extensions: ['exe'] }],
      properties: ['openFile']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle('saves:pickBackupDir', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: 'Папка для сохранений (например, папка на Google Drive)',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  /** Backs up every library game that ludusavi recognizes. */
  ipcMain.handle('saves:syncNow', async () => {
    const win = getWindow()
    const games = getGames()
    let processed = 0
    let failed = 0
    const unknown: string[] = []
    let cursor = 0

    // A few games in parallel: backups are independent, and doing hundreds
    // strictly one-by-one kept the launcher busy for minutes.
    const worker = async (): Promise<void> => {
      while (cursor < games.length) {
        const game = games[cursor++]
        let name: string | null = null
        if (game.appId) name = await findNameByAppId(game.appId)
        if (!name) {
          unknown.push(game.name)
          continue
        }
        sendStatus(win, { stage: 'sync', gameName: game.name, ok: true })
        const result = await backupGame(name)
        if (result.ok) processed++
        else failed++
        sendStatus(win, {
          stage: 'sync',
          gameName: game.name,
          ok: result.ok,
          message: result.ok ? 'сохранения скопированы' : 'ошибка бэкапа'
        })
      }
    }

    const workers = Math.min(3, Math.max(1, games.length))
    await Promise.all(Array.from({ length: workers }, () => worker()))

    return { processed, failed, unknown }
  })

  /** Manual restore for one game (e.g. after reinstalling or on another PC). */
  ipcMain.handle('saves:restore', async (_event, gameId: string) => {
    const win = getWindow()
    const game = getGames().find((g) => g.id === gameId)
    if (!game) return { ok: false, message: 'Игра не найдена' }

    const name = game.appId ? await findNameByAppId(game.appId) : null
    if (!name) {
      const payload = {
        stage: 'restore' as const,
        gameName: game.name,
        ok: false,
        message: 'ludusavi не знает эту игру'
      }
      sendStatus(win, payload)
      return payload
    }
    const result = await restoreGame(name)
    const payload = {
      stage: 'restore' as const,
      gameName: game.name,
      ok: result.ok,
      message: result.ok ? 'сохранения восстановлены' : 'ошибка восстановления'
    }
    sendStatus(win, payload)
    // import achievements from the freshly restored emulator save folder
    syncNowSilently()
    return payload
  })
}

type LauncherSettingsSaves = ReturnType<typeof loadSettings>['saves']
