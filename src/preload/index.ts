import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  Game,
  AchievementUnlockEvent,
  AchievementSettings,
  GeneralSettings,
  SavesSettings,
  SavesStatusPayload
} from '../shared/types'

const api = {
  getGames: (): Promise<Game[]> => ipcRenderer.invoke('games:list'),
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
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
