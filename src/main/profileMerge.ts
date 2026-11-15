import { basename, dirname } from 'path'
import type { Game } from '../shared/types'

/**
 * Pure profile-merge logic (no Electron/fs), kept separate so imports can be
 * unit-tested: id matching, metadata preservation and achievement merging.
 */

function positiveNumber(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Normalizes an imported record: new unique id + all required fields present. */
export function normalizeImported(inc: Game): Game {
  const exePath = String(inc.exePath)
  return {
    id: `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: typeof inc.name === 'string' && inc.name.trim() ? inc.name.trim() : basename(exePath, '.exe'),
    exePath,
    workDir: typeof inc.workDir === 'string' && inc.workDir ? inc.workDir : dirname(exePath),
    args: Array.isArray(inc.args) ? inc.args.filter((a): a is string => typeof a === 'string') : [],
    appId:
      typeof inc.appId === 'number' && Number.isInteger(inc.appId) && inc.appId > 0
        ? inc.appId
        : undefined,
    coverPath: typeof inc.coverPath === 'string' ? inc.coverPath : undefined,
    metadata: inc.metadata,
    playtimeSeconds: positiveNumber(inc.playtimeSeconds),
    lastPlayedAt: positiveNumber(inc.lastPlayedAt) || undefined,
    addedAt: positiveNumber(inc.addedAt, Date.now()),
    achievements: Array.isArray(inc.achievements) ? inc.achievements : []
  }
}

function mergeAchievements(a: Game['achievements'], b: Game['achievements']): Game['achievements'] {
  const left = Array.isArray(a) ? a : []
  const right = Array.isArray(b) ? b : []
  const map = new Map<string, NonNullable<Game['achievements']>[number]>()
  for (const ach of [...left, ...right]) {
    if (!ach || typeof ach.api !== 'string') continue
    const prev = map.get(ach.api)
    if (!prev || ((ach.unlockedAt ?? 0) > (prev.unlockedAt ?? 0) && ach.unlockedAt)) {
      map.set(ach.api, ach)
    }
  }
  return Array.from(map.values())
}

/**
 * Merges imported games into a base list.
 * A game is considered the same if it has the same exePath (case-insensitive)
 * or the same Steam appId.
 * Achievements are merged by API name: unlock timestamps are kept (max wins).
 * Games missing from the library are added back (this is what makes profiles
 * survive reinstalls: export -> delete game -> import -> game returns).
 */
export function mergeGames(
  base: Game[],
  incoming: Game[]
): { games: Game[]; added: number; updated: number } {
  const games = [...base]
  const byExe = new Map<string, number>()
  const byAppId = new Map<number, number>()

  const remember = (game: Game, index: number): void => {
    byExe.set(game.exePath.toLowerCase(), index)
    if (game.appId !== undefined) byAppId.set(game.appId, index)
  }
  games.forEach(remember)

  let added = 0
  let updated = 0

  for (const inc of incoming) {
    if (!inc || typeof inc.exePath !== 'string' || !inc.exePath) continue
    const appId = inc.appId
    const matchIndex =
      byExe.get(inc.exePath.toLowerCase()) ??
      (appId !== undefined ? byAppId.get(appId) : undefined)

    if (matchIndex === undefined) {
      const record = normalizeImported(inc)
      games.push(record)
      remember(record, games.length - 1)
      added++
      continue
    }

    const match = games[matchIndex]
    games[matchIndex] = {
      ...match,
      achievements: mergeAchievements(match.achievements, inc.achievements),
      playtimeSeconds: Math.max(
        positiveNumber(match.playtimeSeconds),
        positiveNumber(inc.playtimeSeconds)
      ),
      lastPlayedAt:
        Math.max(positiveNumber(match.lastPlayedAt), positiveNumber(inc.lastPlayedAt)) || undefined,
      appId: match.appId ?? inc.appId,
      coverPath: match.coverPath ?? inc.coverPath,
      // internet metadata is URL/text only — keep it across export/import
      metadata: match.metadata ?? inc.metadata
    }
    updated++
  }

  return { games, added, updated }
}
