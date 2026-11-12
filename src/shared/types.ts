/**
 * Shared data types used by the main process, preload and renderer.
 * The profile JSON schema is built from these types.
 */

export interface AchievementRecord {
  /** Emulator API name, e.g. "ACH_WIN_ONE_GAME" */
  api: string
  displayName?: string
  description?: string
  icon?: string
  unlockedAt?: number
  /** Rarity in percent (0..100), if known */
  rarity?: number
}

export interface Game {
  id: string
  name: string
  exePath: string
  /** Working directory; defaults to the exe folder */
  workDir?: string
  args?: string[]
  /** Steam AppID, used later by the achievement engine */
  appId?: number
  coverPath?: string
  playtimeSeconds: number
  lastPlayedAt?: number
  addedAt: number
  achievements?: AchievementRecord[]
}

export interface ProfileFile {
  app: 'my-launcher'
  version: number
  exportedAt: number
  games: Game[]
}

/** Payload of an in-app achievement unlock toast */
export interface AchievementUnlockEvent {
  gameId: string
  gameName: string
  name: string
  icon?: string
  rarity?: number
}

/** General behaviour of the launcher (tray, autostart) */
export interface GeneralSettings {
  /** Start the launcher when Windows starts */
  startWithWindows: boolean
  /** Closing the window hides the launcher into the tray instead of quitting */
  closeToTray: boolean
  /** Ask for confirmation before removing a game from the library */
  confirmDelete: boolean
}

/** Achievement watcher behaviour */
export interface AchievementSettings {
  /** Show OS notifications when the window is not focused */
  notifications: boolean
  /** Show in-app toast popups for unlocks */
  toasts: boolean
  /** How often the watchdog polls emulator save files (ms) */
  pollIntervalMs: number
}

/** Save (ludusavi) section of the launcher settings */
export interface SavesSettings {
  /** Master switch for save backup/restore */
  enabled: boolean
  /** Path to ludusavi.exe */
  ludusaviPath: string
  /** Backup destination folder, e.g. a folder inside Google Drive */
  backupPath: string
}

/** Progress message for save operations */
export interface SavesStatusPayload {
  stage: 'sync' | 'restore' | 'launch'
  gameName: string
  ok: boolean
  message?: string
}
