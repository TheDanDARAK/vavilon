import type { Game } from '../shared/types'

/**
 * Whitelist for `games:update` patches coming over IPC. The renderer is
 * sandboxed, but a compromised/XSS-ed renderer should not be able to rewrite
 * the record id, inject unknown keys or put strings into numeric fields.
 */

type Achievement = NonNullable<Game['achievements']>[number]

const has = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

function validAchievements(value: unknown): Achievement[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter(
    (item): item is Achievement =>
      !!item && typeof item === 'object' && typeof (item as { api?: unknown }).api === 'string'
  )
}

export function sanitizeGamePatch(value: unknown): Partial<Game> {
  const out: Partial<Game> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  const input = value as Record<string, unknown>

  if (has(input, 'name')) {
    const name = input.name
    if (typeof name === 'string' && name.trim()) out.name = name.trim()
  }

  if (has(input, 'exePath')) {
    const exePath = input.exePath
    if (typeof exePath === 'string' && exePath.trim()) out.exePath = exePath.trim()
  }

  for (const key of ['workDir', 'coverPath'] as const) {
    if (!has(input, key)) continue
    const next = input[key]
    if (next === undefined) out[key] = undefined
    else if (typeof next === 'string') out[key] = next
  }

  if (has(input, 'args')) {
    const args = input.args
    if (args === undefined) out.args = undefined
    else if (Array.isArray(args)) {
      out.args = args.filter((arg): arg is string => typeof arg === 'string')
    }
  }

  if (has(input, 'appId')) {
    const appId = input.appId
    if (appId === undefined) out.appId = undefined
    else if (typeof appId === 'number' && Number.isInteger(appId) && appId > 0) {
      out.appId = appId
    }
  }

  for (const key of ['playtimeSeconds', 'addedAt'] as const) {
    if (!has(input, key)) continue
    const next = input[key]
    if (typeof next === 'number' && Number.isFinite(next) && next >= 0) out[key] = next
  }

  if (has(input, 'lastPlayedAt')) {
    const lastPlayedAt = input.lastPlayedAt
    if (lastPlayedAt === undefined) out.lastPlayedAt = undefined
    else if (typeof lastPlayedAt === 'number' && Number.isFinite(lastPlayedAt) && lastPlayedAt > 0) {
      out.lastPlayedAt = lastPlayedAt
    }
  }

  if (has(input, 'achievements')) {
    const achievements = input.achievements
    if (achievements === undefined) out.achievements = undefined
    else {
      const filtered = validAchievements(achievements)
      if (filtered) out.achievements = filtered
    }
  }

  if (has(input, 'metadata')) {
    const metadata = input.metadata
    if (metadata === undefined) out.metadata = undefined
    else if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      out.metadata = metadata as Game['metadata']
    }
  }

  return out
}
