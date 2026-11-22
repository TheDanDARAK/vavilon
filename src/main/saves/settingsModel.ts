/**
 * Settings model shared by the loader and the UI-facing IPC layer.
 * Pure by design: normalization can be unit-tested without Electron.
 */

export interface LauncherSettings {
  general: {
    /** Start the launcher when Windows starts */
    startWithWindows: boolean
    /** Closing the window hides the launcher into the tray instead of quitting */
    closeToTray: boolean
    /** Ask for confirmation before removing a game from the library */
    confirmDelete: boolean
    /** Check GitHub Releases for a new version on startup */
    autoUpdateCheck: boolean
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
    /**
     * Optional SteamGridDB API key. When empty the launcher uses a bundled
     * public fallback key (like Achievement Watcher Next), so covers work
     * out of the box.
     */
    steamGridDbApiKey: string
  }
}

export const SETTINGS_DEFAULTS: LauncherSettings = {
  general: {
    startWithWindows: false,
    closeToTray: false,
    confirmDelete: true,
    autoUpdateCheck: true
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
    rawgApiKey: '',
    steamGridDbApiKey: ''
  }
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function asPollInterval(value: unknown): number {
  const ms = Number(value)
  return Number.isFinite(ms) && ms >= 1000 && ms <= 60000
    ? Math.round(ms)
    : SETTINGS_DEFAULTS.achievements.pollIntervalMs
}

/**
 * Coerces values read from settings.json (or sent over IPC) back to the
 * expected types/ranges. A hand-edited or corrupted file could otherwise put
 * strings into toggles or a zero into the poll interval.
 */
export function normalizeSettings(input: LauncherSettings): LauncherSettings {
  return {
    general: {
      startWithWindows: asBool(
        input.general?.startWithWindows,
        SETTINGS_DEFAULTS.general.startWithWindows
      ),
      closeToTray: asBool(input.general?.closeToTray, SETTINGS_DEFAULTS.general.closeToTray),
      confirmDelete: asBool(input.general?.confirmDelete, SETTINGS_DEFAULTS.general.confirmDelete),
      autoUpdateCheck: asBool(
        input.general?.autoUpdateCheck,
        SETTINGS_DEFAULTS.general.autoUpdateCheck
      )
    },
    achievements: {
      notifications: asBool(
        input.achievements?.notifications,
        SETTINGS_DEFAULTS.achievements.notifications
      ),
      toasts: asBool(input.achievements?.toasts, SETTINGS_DEFAULTS.achievements.toasts),
      pollIntervalMs: asPollInterval(input.achievements?.pollIntervalMs)
    },
    saves: {
      enabled: asBool(input.saves?.enabled, SETTINGS_DEFAULTS.saves.enabled),
      ludusaviPath: asText(input.saves?.ludusaviPath),
      backupPath: asText(input.saves?.backupPath)
    },
    store: {
      rawgApiKey: asText(input.store?.rawgApiKey),
      steamGridDbApiKey: asText(input.store?.steamGridDbApiKey)
    }
  }
}
