import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

/**
 * Launcher settings (userData/settings.json).
 * The saves section controls ludusavi integration:
 * cloud saves live in a folder the user chooses (e.g. their Google Drive folder).
 */

export interface LauncherSettings {
  general: {
    /** Start the launcher when Windows starts */
    startWithWindows: boolean
    /** Closing the window hides the launcher into the tray instead of quitting */
    closeToTray: boolean
    /** Ask for confirmation before removing a game from the library */
    confirmDelete: boolean
  }
  achievements: {
    /** Show OS notifications when the window is not focused */
    notifications: boolean
    /** Show in-app toast popups for unlocks */
    toasts: boolean
    /** How often the watchdog polls emulator save files (ms) */
    pollIntervalMs: number
  }
  saves: {
    /** Master switch for save backup/restore */
    enabled: boolean
    /** Path to ludusavi.exe (auto-detected on first run) */
    ludusaviPath: string
    /** Backup destination folder, e.g. a folder inside Google Drive */
    backupPath: string
  }
  store: {
    /** Free RAWG API key (rawg.io/apidocs) that powers the storefront */
    rawgApiKey: string
  }
}

const DEFAULTS: LauncherSettings = {
  general: {
    startWithWindows: false,
    closeToTray: false,
    confirmDelete: true
  },
  achievements: {
    notifications: true,
    toasts: true,
    pollIntervalMs: 4000
  },
  saves: {
    enabled: false,
    ludusaviPath: '',
    backupPath: ''
  },
  store: {
    rawgApiKey: ''
  }
}

let cache: LauncherSettings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function guessLudusaviPath(): string {
  // development: portable copy in the tools folder; packaged: resources/binaries
  const candidates = [
    // packaged: bundled next to the app in resources
    join(process.resourcesPath ?? '', 'binaries', 'ludusavi.exe'),
    // development: the repo copy
    join(app.getAppPath(), 'resources', 'binaries', 'ludusavi.exe'),
    join(app.getAppPath(), 'binaries', 'ludusavi.exe')
  ]
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return ''
}

export function loadSettings(): LauncherSettings {
  if (cache) return cache
  let stored: Partial<LauncherSettings> = {}
  try {
    stored = JSON.parse(readFileSync(settingsPath(), 'utf-8')) as Partial<LauncherSettings>
  } catch {
    // first run
  }
  const merged: LauncherSettings = {
    general: { ...DEFAULTS.general, ...(stored.general ?? {}) },
    achievements: { ...DEFAULTS.achievements, ...(stored.achievements ?? {}) },
    saves: { ...DEFAULTS.saves, ...(stored.saves ?? {}) },
    store: { ...DEFAULTS.store, ...(stored.store ?? {}) }
  }
  if (!merged.saves.ludusaviPath) {
    merged.saves.ludusaviPath = guessLudusaviPath()
  }
  cache = merged
  return merged
}

export function saveSettings(settings: LauncherSettings): void {
  cache = settings
  // crash-safe write: temp file first, then rename over the real one
  const tmp = `${settingsPath()}.tmp`
  writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf-8')
  renameSync(tmp, settingsPath())
}

export function saveSettingsPatch(patch: Partial<LauncherSettings>): LauncherSettings {
  const current = loadSettings()
  const next: LauncherSettings = {
    general: { ...current.general, ...(patch.general ?? {}) },
    achievements: { ...current.achievements, ...(patch.achievements ?? {}) },
    saves: { ...current.saves, ...(patch.saves ?? {}) },
    store: { ...current.store, ...(patch.store ?? {}) }
  }
  saveSettings(next)
  return next
}

/** Applies the autostart setting to the OS login items. */
export function applyAutostart(): void {
  const { general } = loadSettings()
  app.setLoginItemSettings({
    openAtLogin: general.startWithWindows,
    path: process.execPath
  })
}
