import { Notification, BrowserWindow, ipcMain } from 'electron'
import type { AchievementRecord, Game } from '../../shared/types'
import { getGames, updateGames, broadcastChange } from '../library'
import { readRuntimeAchievementsForAppId, type RuntimeAchEntry } from './emuSaves'
import { loadSchema, type GameSchema } from './schema'
import { loadSettings } from '../saves/saveSettings'

/**
 * Achievement watchdog.
 * Polls emulator save files (%APPDATA%\GSE Saves\<appid>\achievements.json),
 * merges unlock state into the library and shows popups for fresh unlocks.
 *
 * The library record is the permanent source of truth for the UI:
 * even if the game (and its saves) are removed, history stays in the profile.
 */

const FALLBACK_POLL_INTERVAL_MS = 4000

let timer: NodeJS.Timeout | null = null
let initialSync = true

function pollInterval(): number {
  const ms = loadSettings().achievements.pollIntervalMs
  return Number.isFinite(ms) && ms >= 1000 ? ms : FALLBACK_POLL_INTERVAL_MS
}

const schemaCache = new Map<string, { gameDir: string; schema: GameSchema | null }>()

function schemaFor(game: Game): GameSchema | null {
  const gameDir = game.workDir ?? ''
  const cached = schemaCache.get(game.id)
  if (cached && cached.gameDir === gameDir) return cached.schema
  const schema = gameDir ? loadSchema(gameDir) : null
  schemaCache.set(game.id, { gameDir, schema })
  return schema
}

/**
 * Drops the cached schema for one game (or all games). The cache only notices
 * a changed game directory, so after installing/updating/removing the emulator
 * schema in-session it must be invalidated explicitly — otherwise names,
 * icons and rarity stay missing until the launcher restarts.
 */
export function invalidateSchemaCache(gameId?: string): void {
  if (gameId) schemaCache.delete(gameId)
  else schemaCache.clear()
}

function getWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

function notifyUnlock(game: Game, record: AchievementRecord): void {
  const payload = {
    gameId: game.id,
    gameName: game.name,
    name: record.displayName || record.api,
    icon: record.icon,
    rarity: record.rarity
  }

  const ach = loadSettings().achievements
  const win = getWindow()
  // In-app toast when the launcher is visible; OS notification otherwise
  if (win && !win.isMinimized() && win.isFocused()) {
    if (ach.toasts) win.webContents.send('achievements:unlocked', payload)
  } else if (ach.notifications) {
    const notification = new Notification({
      title: '🏆 Достижение разблокировано',
      body: `${game.name} — ${payload.name}`,
      icon: record.icon
    })
    notification.on('click', () => {
      win?.show()
      win?.focus()
      win?.webContents.send('achievements:unlocked', payload)
    })
    notification.show()
  }
}

function upsertRecord(
  apiName: string,
  existing: AchievementRecord | undefined,
  schemaAch: GameSchema['achievements'][number] | undefined,
  entry: RuntimeAchEntry
): AchievementRecord {
  const unlockedAt = entry.earned && entry.earnedTime > 0 ? entry.earnedTime * 1000 : undefined
  const bestUnlockedAt =
    unlockedAt !== undefined && unlockedAt > (existing?.unlockedAt ?? 0)
      ? unlockedAt
      : existing?.unlockedAt

  return {
    api: existing?.api ?? schemaAch?.name ?? apiName,
    displayName: existing?.displayName ?? schemaAch?.displayName,
    description: existing?.description ?? schemaAch?.description,
    icon: existing?.icon ?? schemaAch?.iconPath,
    rarity: existing?.rarity ?? schemaAch?.rarity,
    unlockedAt: bestUnlockedAt,
    progress: entry.progress ?? existing?.progress,
    maxProgress: entry.maxProgress ?? existing?.maxProgress
  }
}

/**
 * One poll pass over all games with an appId.
 * Returns true when any game was updated.
 */
function poll(): boolean {
  const games = getGames()
  const updates: Array<{ id: string; patch: Partial<Game> }> = []
  const unlocks: Array<{ game: Game; record: AchievementRecord }> = []

  for (const game of games) {
    if (!game.appId) continue
    const runtime = readRuntimeAchievementsForAppId(game.appId)
    if (!runtime) continue

    const schema = schemaFor(game)
    const schemaByName = new Map(schema?.achievements.map((a) => [a.name.toLowerCase(), a]) ?? [])

    const stored = new Map((game.achievements ?? []).map((a) => [a.api.toLowerCase(), a]))
    let updated = false
    const newUnlocks: AchievementRecord[] = []

    for (const [key, entry] of Object.entries(runtime)) {
      const prev = stored.get(key)
      const prevUnlockedAt = prev?.unlockedAt ?? 0
      const entryUnlockedAt = entry.earned && entry.earnedTime > 0 ? entry.earnedTime * 1000 : 0
      const progressChanged =
        (entry.progress !== undefined || entry.maxProgress !== undefined) &&
        (prev?.progress !== entry.progress || prev?.maxProgress !== entry.maxProgress)

      if (entryUnlockedAt > prevUnlockedAt || progressChanged) {
        const record = upsertRecord(key, prev, schemaByName.get(key), entry)
        stored.set(key, record)
        updated = true
        // only a fresh unlock (by emulator timestamp) shows a toast —
        // progress-only changes and the startup import stay silent
        const isFreshUnlock =
          entryUnlockedAt > prevUnlockedAt &&
          !initialSync &&
          Date.now() - entryUnlockedAt < pollInterval() * 4
        if (isFreshUnlock) newUnlocks.push(record)
      } else if (schemaByName.has(key)) {
        // enrich records the schema can complete: achievements imported before
        // the schema existed (or records still missing a name) get their
        // display name, icon, description and rarity filled in here
        const sch = schemaByName.get(key)
        if (!prev || !prev.displayName) {
          stored.set(key, upsertRecord(key, prev, sch, entry))
          updated = true
        }
      }
    }

    if (updated) {
      // preserve schema order when a schema is available
      const ordered = schema
        ? schema.achievements
            .map((a) => stored.get(a.name.toLowerCase()))
            .filter((r): r is AchievementRecord => r !== undefined)
        : Array.from(stored.values())
      updates.push({ id: game.id, patch: { achievements: ordered } })
      for (const record of newUnlocks) unlocks.push({ game, record })
    }
  }

  // one library write + one renderer reload for the whole poll
  const changed = updateGames(updates)
  if (changed) {
    for (const { game, record } of unlocks) notifyUnlock(game, record)
  }
  return changed
}

export function startAchievementWatcher(): void {
  if (timer) return
  initialSync = true
  poll()
  initialSync = false
  timer = setInterval(poll, pollInterval())
}

/** Restarts the polling loop (after the interval setting was changed). */
export function restartAchievementWatcher(): void {
  stopAchievementWatcher()
  startAchievementWatcher()
}

export function stopAchievementWatcher(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

/** Manual one-shot rescan without notifications. */
export function syncNowSilently(): boolean {
  initialSync = true
  const changed = poll()
  initialSync = false
  if (changed) broadcastChange()
  return changed
}

export function registerAchievementsIpc(): void {
  ipcMain.handle('achievements:sync', () => syncNowSilently())
}
