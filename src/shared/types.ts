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

/* ============================================================
   Storefront (RAWG catalogue): types shared across the bridge
   ============================================================ */

/** One game card shown in the storefront */
export interface StoreGame {
  id: number
  name: string
  coverUrl?: string
  /** Release date as "YYYY-MM-DD" */
  released?: string
  /** RAWG user rating (0..5) */
  rating?: number
  /** Metacritic score, when known */
  metacritic?: number
  genres?: string[]
}

/** Full storefront game details, fetched on demand when a card is opened */
export interface StoreGameDetails extends StoreGame {
  description?: string
  website?: string
  screenshots?: GameScreenshot[]
}

/** Recommended batch: games + the genre slugs they were picked by */
export interface StoreRecommendation {
  games: StoreGame[]
  /** Empty list → the fallback "popular now" feed */
  basisSlugs: string[]
}

/** Generic storefront request result (main never throws to the renderer) */
export interface StoreResult<T> {
  ok: boolean
  data?: T
  error?: string
  /** true → the user must enter a RAWG API key in settings first */
  needKey?: boolean
}

/** Wishlist entry, persisted inside library.json next to the games */
export interface WishlistEntry extends StoreGame {
  addedAt: number
}

/** Genres available as storefront filters (RAWG slugs, Russian labels) */
export interface StoreGenre {
  slug: string
  label: string
}

export const STORE_GENRES: StoreGenre[] = [
  { slug: 'action', label: 'Экшен' },
  { slug: 'role-playing-games-rpg', label: 'RPG' },
  { slug: 'shooter', label: 'Шутеры' },
  { slug: 'strategy', label: 'Стратегии' },
  { slug: 'adventure', label: 'Приключения' },
  { slug: 'simulation', label: 'Симуляторы' },
  { slug: 'platformer', label: 'Платформеры' },
  { slug: 'puzzle', label: 'Головоломки' },
  { slug: 'racing', label: 'Гонки' },
  { slug: 'sports', label: 'Спорт' },
  { slug: 'indie', label: 'Инди' },
  { slug: 'casual', label: 'Казуальные' },
  { slug: 'fighting', label: 'Файтинги' },
  { slug: 'massively-multiplayer', label: 'MMO' }
]

/* ============================================================
   Torrent search (search.exfreedomist.com): types shared across the bridge
   ============================================================ */

/** One torrent release returned by the aggregator */
export interface TorrentResult {
  /** Stable key: the one-time /magnet path from the search page */
  key: string
  /** Display title of the release */
  title: string
  /** Tracker name, e.g. "rutracker" */
  tracker?: string
  /** Tracker category, e.g. "RPG" */
  category?: string
  /** Human-readable size, e.g. "148.88 GB" */
  size?: string
  /** Release/publish date as "YYYY-MM-DD" */
  date?: string
  seeds?: number
  leechers?: number
  /** Whether the aggregator marked the release as verified */
  verified?: boolean
}

/** Parsed aggregator search page */
export interface TorrentSearchPage {
  total: number
  results: TorrentResult[]
}

/** Generic torrent request result (main never throws to the renderer) */
export interface TorrentResultEnvelope<T> {
  ok: boolean
  data?: T
  error?: string
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
