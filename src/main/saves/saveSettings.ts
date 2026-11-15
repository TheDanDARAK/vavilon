import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import {
  normalizeSettings,
  SETTINGS_DEFAULTS,
  type LauncherSettings
} from './settingsModel'

export type { LauncherSettings } from './settingsModel'

/**
 * Launcher settings (userData/settings.json).
 * The saves section controls ludusavi integration:
 * cloud saves live in a folder the user chooses (e.g. their Google Drive folder).
 */

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
  const merged: LauncherSettings = normalizeSettings({
    general: { ...SETTINGS_DEFAULTS.general, ...(stored.general ?? {}) },
    achievements: { ...SETTINGS_DEFAULTS.achievements, ...(stored.achievements ?? {}) },
    saves: { ...SETTINGS_DEFAULTS.saves, ...(stored.saves ?? {}) },
    store: { ...SETTINGS_DEFAULTS.store, ...(stored.store ?? {}) }
  })
  if (!merged.saves.ludusaviPath) {
    merged.saves.ludusaviPath = guessLudusaviPath()
  }
  cache = merged
  return merged
}

export function saveSettings(settings: LauncherSettings): void {
  const normalized = normalizeSettings(settings)
  cache = normalized
  // crash-safe write: temp file first, then rename over the real one
  const tmp = `${settingsPath()}.tmp`
  writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf-8')
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
  // Start minimized to the tray: the login item passes --hidden, and the
  // renderer window stays hidden until the user opens it from the tray.
  const args = app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden']
  app.setLoginItemSettings({
    openAtLogin: general.startWithWindows,
    path: process.execPath,
    args
  })
}
