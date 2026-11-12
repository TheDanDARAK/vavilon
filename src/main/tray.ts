import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { loadSettings } from './saves/saveSettings'

/**
 * System tray: keeps the launcher (and the achievement watchdog) alive
 * after the window is closed. Quit only through the tray menu.
 */

let tray: Tray | null = null
let quitting = false

function trayIcon(): Electron.NativeImage {
  const candidates = [
    join(app.getAppPath(), 'resources', 'tray.png'),
    join(process.resourcesPath ?? '', 'tray.png')
  ]
  for (const path of candidates) {
    if (path && existsSync(path)) {
      const image = nativeImage.createFromPath(path)
      if (!image.isEmpty()) return image
    }
  }
  // empty image = Electron draws a placeholder
  return nativeImage.createEmpty()
}

function showMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    win.show()
    win.focus()
  } else {
    // recreate the window after an accidental full close
    app.emit('activate')
  }
}

export function markQuitting(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}

/** True when the close event should hide the window to the tray instead. */
export function shouldHideToTray(): boolean {
  if (quitting) return false
  return loadSettings().general.closeToTray
}

export function createTray(): void {
  if (tray) return
  tray = new Tray(trayIcon())
  tray.setToolTip('Vavilon — библиотека игр')

  const menu = Menu.buildFromTemplate([
    {
      label: 'Открыть',
      click: () => showMainWindow()
    },
    { type: 'separator' },
    {
      label: 'Выйти',
      click: () => {
        markQuitting()
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)

  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
