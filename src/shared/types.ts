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
  /** Stat-based achievement progress, when the emulator reports it */
  progress?: number
  maxProgress?: number
}

/** One screenshot fetched from the store (URL only, never saved to disk) */
export interface GameScreenshot {
  url: string
  thumbUrl?: string
}

/**
 * Store metadata (Steam). Only text and CDN URLs are stored in library.json —
 * images and videos are streamed from the internet on demand, so nothing
 * but a few kilobytes of JSON ever lands on disk.
 */
export interface GameMetadata {
  /** Steam AppID the metadata was fetched for */
  appId?: number
  /** Short description (one paragraph) */
  shortDescription?: string
  /** Full description (rich HTML, as delivered by the store) */
  fullDescription?: string
  /** Vertical cover image URL (library_600x900) */
  coverUrl?: string
  /** Wide banner (header) URL */
  headerUrl?: string
  /** Big background/hero image URL */
  heroUrl?: string
  /** Trailer video URL (mp4, streamed) */
  trailerUrl?: string
  trailerThumbUrl?: string
  screenshots?: GameScreenshot[]
  developer?: string[]
  publisher?: string[]
  genres?: string[]
  releaseDate?: string
  /** Positive reviews in percent (0..100) */
  ratingPct?: number
  /** Localized rating label, e.g. "Крайне положительные" */
  ratingLabel?: string
  storeUrl?: string
  /** When the metadata was last refreshed (ms) */
  fetchedAt?: number
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
  /** Internet metadata (descriptions, covers, trailer), URL-based */
  metadata?: GameMetadata
  playtimeSeconds: number
  lastPlayedAt?: number
  addedAt: number
  achievements?: AchievementRecord[]
}

/** One suggestion from the store name search */
export interface SteamSearchHit {
  appId: number
  name: string
  iconUrl?: string
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
