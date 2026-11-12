import { app, BrowserWindow, ipcMain, net, protocol, shell } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { cpSync } from 'fs'
import { pathToFileURL } from 'url'
import { registerLibraryIpc } from './library'
import { registerRunnerIpc } from './runner'
import { registerProfileIpc } from './profile'
import {
  startAchievementWatcher,
  stopAchievementWatcher,
  registerAchievementsIpc
} from './achievements/watcher'
import { registerGbeSetupIpc } from './achievements/gbeSetup'
import { registerSavesIpc, registerGeneralIpc } from './saves/saveIpc'
import { applyAutostart } from './saves/saveSettings'
import { createTray, shouldHideToTray, markQuitting } from './tray'

// Must be registered before app ready: serves local files (covers, icons) to the renderer
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

let mainWindow: BrowserWindow | null = null

/**
 * App data lives in %APPDATA%\vavilon. One-time migration from the old
 * dev-era folder (%APPDATA%\my-launcher) so nothing from the library is lost.
 */
function setupUserData(): void {
  const appData = app.getPath('appData')
  const newDir = join(appData, 'vavilon')
  const oldDir = join(appData, 'my-launcher')
  const hasNew = existsSync(join(newDir, 'library.json'))
  const hasOld = existsSync(join(oldDir, 'library.json'))
  if (!hasNew && hasOld) {
    cpSync(oldDir, newDir, { recursive: true })
  }
  app.setPath('userData', newDir)
}

function registerMediaProtocol(): void {
  protocol.handle('media', (request) => {
    const url = new URL(request.url)
    // media://local/<encodeURIComponent(absolute path)>
    const filePath = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    title: 'Vavilon',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Close-to-tray: closing the window keeps the launcher (and watchdog) alive
  mainWindow.on('close', (event) => {
    if (shouldHideToTray()) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  // Open external links in the default browser, not inside the app
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  setupUserData()
  registerMediaProtocol()
  registerLibraryIpc(ipcMain)
  registerRunnerIpc(ipcMain, () => mainWindow)
  registerProfileIpc(ipcMain)
  registerAchievementsIpc()
  registerGbeSetupIpc()
  registerSavesIpc(() => mainWindow)
  registerGeneralIpc()

  createWindow()
  createTray()
  applyAutostart()
  startAchievementWatcher()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  markQuitting()
  stopAchievementWatcher()
})

app.on('window-all-closed', () => {
  // with close-to-tray the window is hidden rather than destroyed, so this
  // only fires on a real close — quitting is correct in every case
  app.quit()
})
