import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  Game,
  AchievementUnlockEvent,
  AchievementSettings,
  GeneralSettings,
  GameMetadata,
  SavesSettings,
  SavesStatusPayload,
  SteamSearchHit,
  StoreGame,
  StoreGameDetails,
  StoreList,
  StoreRecommendation,
  StoreResult,
  TorrentResultEnvelope,
  TorrentSearchPage,
  UpdateInfo,
  UpdaterState,
  WishlistEntry
} from '../shared/types'

const api = {
  getGames: (): Promise<Game[]> => ipcRenderer.invoke('games:list'),
  getMissingGames: (): Promise<string[]> => ipcRenderer.invoke('games:missing'),
  addGame: (
    game: Partial<Game> & { exePath: string }
  ): Promise<{ game: Game; duplicated: boolean }> => ipcRenderer.invoke('games:add', game),
  updateGame: (id: string, patch: Partial<Game>): Promise<boolean> =>
    ipcRenderer.invoke('games:update', id, patch),
  removeGame: (id: string): Promise<boolean> => ipcRenderer.invoke('games:remove', id),
  pickExe: (): Promise<{ exePath: string; suggestedName: string; suggestedWorkDir: string } | null> =>
    ipcRenderer.invoke('games:pickExe'),
  pickCover: (gameId: string): Promise<string | null> =>
    ipcRenderer.invoke('games:pickCover', gameId),
  removeCover: (gameId: string): Promise<boolean> =>
    ipcRenderer.invoke('games:removeCover', gameId),
  /** Resolve a cover through Steam → SteamGridDB → RAWG and cache it locally */
  autoCover: (
    gameId: string,
    force?: boolean
  ): Promise<{ ok: boolean; path?: string; source?: string; message?: string }> =>
    ipcRenderer.invoke('covers:auto', gameId, force),
  /** Store metadata (Steam): everything goes by URL, nothing is saved to disk */
  searchSteam: (term: string): Promise<SteamSearchHit[]> =>
    ipcRenderer.invoke('metadata:search', term),
  fetchMetadata: (appId: number): Promise<GameMetadata | null> =>
    ipcRenderer.invoke('metadata:fetch', appId),
  applyMetadata: (gameId: string, metadata: GameMetadata): Promise<boolean> =>
    ipcRenderer.invoke('metadata:apply', gameId, metadata),
  syncGameMetadata: (gameId: string): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke('metadata:sync', gameId),
  /** Storefront (RAWG): the API key plus catalogue requests */
  storeGetKey: (): Promise<string> => ipcRenderer.invoke('store:getKey'),
  storeSetKey: (key: string): Promise<string> => ipcRenderer.invoke('store:setKey', key),
  /** Optional SteamGridDB key (empty → bundled public fallback key) */
  storeGetSteamGridDbKey: (): Promise<string> => ipcRenderer.invoke('store:getSteamGridDbKey'),
  storeSetSteamGridDbKey: (key: string): Promise<string> =>
    ipcRenderer.invoke('store:setSteamGridDbKey', key),
  storeNewReleases: (genre?: string, page?: number): Promise<StoreResult<StoreList<StoreGame>>> =>
    ipcRenderer.invoke('store:newReleases', genre, page),
  storeRecommend: (): Promise<StoreResult<StoreRecommendation>> =>
    ipcRenderer.invoke('store:recommend'),
  storeDetails: (id: number): Promise<StoreResult<StoreGameDetails>> =>
    ipcRenderer.invoke('store:details', id),
  storeSearch: (term: string, page?: number): Promise<StoreResult<StoreList<StoreGame>>> =>
    ipcRenderer.invoke('store:search', term, page),
  /** "Similar" suggestions: for a library game (resolved by name) or a RAWG id */
  storeSimilarForGame: (
    gameId: string
  ): Promise<StoreResult<{ games: StoreGame[]; source?: string }>> =>
    ipcRenderer.invoke('store:similarForGame', gameId),
  storeSimilar: (id: number): Promise<StoreResult<StoreGame[]>> =>
    ipcRenderer.invoke('store:similar', id),
  /** Wishlist, persisted inside library.json */
  storeWishlistGet: (): Promise<WishlistEntry[]> => ipcRenderer.invoke('store:wishlist:get'),
  storeWishlistAdd: (entry: WishlistEntry): Promise<WishlistEntry[]> =>
    ipcRenderer.invoke('store:wishlist:add', entry),
  storeWishlistRemove: (id: number): Promise<WishlistEntry[]> =>
    ipcRenderer.invoke('store:wishlist:remove', id),
  /** Torrent search through search.exfreedomist.com */
  torrentsSearch: (
    query: string,
    options?: { orderBy?: string; offset?: number }
  ): Promise<TorrentResultEnvelope<TorrentSearchPage>> =>
    ipcRenderer.invoke('torrents:search', query, options),
  torrentsMagnet: (key: string): Promise<TorrentResultEnvelope<string>> =>
    ipcRenderer.invoke('torrents:magnet', key),
  torrentsCopy: (text: string): Promise<boolean> => ipcRenderer.invoke('torrents:copy', text),
  torrentsOpen: (uri: string): Promise<boolean> => ipcRenderer.invoke('torrents:open', uri),
  /** Absolute path of a dropped file (webUtils works in the sandboxed preload). */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  launchGame: (id: string): Promise<boolean> => ipcRenderer.invoke('games:launch', id),
  isRunning: (id: string): Promise<boolean> => ipcRenderer.invoke('games:isRunning', id),
  stopGame: (id: string): Promise<boolean> => ipcRenderer.invoke('games:stop', id),
  exportProfile: (): Promise<string | null> => ipcRenderer.invoke('profile:export'),
  importProfile: (mode: 'merge' | 'replace'): Promise<unknown> =>
    ipcRenderer.invoke('profile:import', mode),
  syncAchievements: (): Promise<boolean> => ipcRenderer.invoke('achievements:sync'),
  diagnoseEmu: (gameId: string): Promise<unknown> => ipcRenderer.invoke('gbe:diagnose', gameId),
  setupSchema: (gameId: string): Promise<unknown> => ipcRenderer.invoke('gbe:schema', gameId),
  installEmu: (gameId: string): Promise<unknown> => ipcRenderer.invoke('gbe:install', gameId),
  pickCustomDll: (): Promise<{ name: string; arch: 32 | 64 } | null> =>
    ipcRenderer.invoke('gbe:pickCustomDll'),
  clearCustomDll: (): Promise<boolean> => ipcRenderer.invoke('gbe:clearCustomDll'),
  /** Add the emulator cache + game folder to Windows Defender exclusions */
  addEmuExclusion: (
    gameId: string
  ): Promise<{ ok: boolean; message: string; paths: string[] }> =>
    ipcRenderer.invoke('gbe:addExclusion', gameId),
  getSavesSettings: (): Promise<SavesSettings> => ipcRenderer.invoke('saves:get'),
  setSavesSettings: (patch: Partial<SavesSettings>): Promise<SavesSettings> =>
    ipcRenderer.invoke('saves:set', patch),
  pickLudusaviExe: (): Promise<string | null> => ipcRenderer.invoke('saves:pickLudusavi'),
  pickBackupDir: (): Promise<string | null> => ipcRenderer.invoke('saves:pickBackupDir'),
  syncSavesNow: (): Promise<{ processed: number; failed: number; unknown: string[] }> =>
    ipcRenderer.invoke('saves:syncNow'),
  restoreSaves: (gameId: string): Promise<unknown> => ipcRenderer.invoke('saves:restore', gameId),
  getGeneralSettings: (): Promise<GeneralSettings> => ipcRenderer.invoke('general:get'),
  setGeneralSettings: (patch: Partial<GeneralSettings>): Promise<GeneralSettings> =>
    ipcRenderer.invoke('general:set', patch),
  getAchSettings: (): Promise<AchievementSettings> => ipcRenderer.invoke('ach:get'),
  setAchSettings: (patch: Partial<AchievementSettings>): Promise<AchievementSettings> =>
    ipcRenderer.invoke('ach:set', patch),
  exportUnlocks: (gameId: string): Promise<{ exported: number; file: string; files: string[] }> =>
    ipcRenderer.invoke('gbe:exportUnlocks', gameId),
  restoreEmu: (
    gameId: string
  ): Promise<{ restored: string[]; removed: string[]; warnings: string[] }> =>
    ipcRenderer.invoke('gbe:restore', gameId),
  resetAchievements: (gameId: string): Promise<{ cleared: number; files: string[] }> =>
    ipcRenderer.invoke('gbe:resetAch', gameId),
  /** Launcher version + GitHub Releases update check */
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('updates:version'),
  checkUpdates: (): Promise<UpdateInfo> => ipcRenderer.invoke('updates:check'),
  openReleasePage: (url: string): Promise<boolean> => ipcRenderer.invoke('updates:open', url),
  /** Over-the-air updater (electron-updater + portable fallback) */
  getUpdaterState: (): Promise<UpdaterState> => ipcRenderer.invoke('updater:state'),
  checkUpdater: (): Promise<UpdaterState> => ipcRenderer.invoke('updater:check'),
  downloadUpdate: (): Promise<UpdaterState> => ipcRenderer.invoke('updater:download'),
  installUpdate: (): Promise<boolean> => ipcRenderer.invoke('updater:install'),
  /** Big Picture: leave fullscreen gamepad mode and reload the normal UI */
  exitBigPicture: (): Promise<boolean> => ipcRenderer.invoke('bigpicture:exit'),
  openDataDir: (): Promise<boolean> => ipcRenderer.invoke('app:openDataDir'),
  onSaveStatus: (callback: (payload: SavesStatusPayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: SavesStatusPayload): void => callback(payload)
    ipcRenderer.on('saves:status', listener)
    return () => ipcRenderer.removeListener('saves:status', listener)
  },
  onAchievementUnlocked: (
    callback: (event: AchievementUnlockEvent) => void
  ): (() => void) => {
    const listener = (_e: unknown, payload: AchievementUnlockEvent): void => callback(payload)
    ipcRenderer.on('achievements:unlocked', listener)
    return () => ipcRenderer.removeListener('achievements:unlocked', listener)
  },
  onGamesChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('games:changed', listener)
    return () => ipcRenderer.removeListener('games:changed', listener)
  },
  /** Live running state of one game (id, running) */
  onGameRunningChanged: (callback: (id: string, running: boolean) => void): (() => void) => {
    const listener = (_e: unknown, id: string, running: boolean): void => callback(id, running)
    ipcRenderer.on('games:running', listener)
    return () => ipcRenderer.removeListener('games:running', listener)
  },
  /** Live over-the-air updater state (checking → downloading → downloaded) */
  onUpdaterState: (callback: (state: UpdaterState) => void): (() => void) => {
    const listener = (_e: unknown, state: UpdaterState): void => callback(state)
    ipcRenderer.on('updater:state', listener)
    return () => ipcRenderer.removeListener('updater:state', listener)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
