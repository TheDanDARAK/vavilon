import { readFileSync, existsSync } from 'fs'
import { join, basename } from 'path'

/**
 * Achievement schema reader: `steam_settings\achievements.json` next to the game.
 * This file defines api names, display names, descriptions and icons
 * (the "dictionary"), while the runtime save only records unlock state.
 *
 * Shape (gbe_fork / Goldberg):
 * [
 *   {
 *     "name": "ACH_WIN_ONE_GAME",
 *     "displayName": "Winner" | { "english": "Winner", "russian": "Победитель" },
 *     "description": "..." | { "english": "...", ... },
 *     "icon": "icon_1.png" | "achievement_images/icon_1.png",
 *     "icon_gray": "..." (old format: "icongray"),
 *     "hidden": "0" | 0,
 *     "unlock_percentage": 12.5
 *   }
 * ]
 */

export interface SchemaAch {
  name: string
  displayName?: string
  description?: string
  /** Absolute path to the unlocked icon, if found on disk */
  iconPath?: string
  /** Absolute path to the locked icon, if found on disk */
  iconGrayPath?: string
  hidden?: boolean
  /** Global unlock rate in percent (0..100) */
  rarity?: number
}

export interface GameSchema {
  dir: string
  achievements: SchemaAch[]
}

function localized(value: unknown): string | undefined {
  if (typeof value === 'string' && value) return value
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    const strings: Array<[string, string]> = []
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === 'string' && key !== 'token') strings.push([key, val])
    }
    const find = (lang: string): string | undefined =>
      strings.find(([key]) => key.toLowerCase() === lang)?.[1]
    // prefer the user's language, then english, then any non-token entry
    return find('russian') ?? find('english') ?? strings[0]?.[1]
  }
  return undefined
}

function resolveIcon(settingsDir: string, iconField: unknown): string | undefined {
  if (typeof iconField !== 'string' || !iconField) return undefined
  const candidates = [
    join(settingsDir, iconField),
    join(settingsDir, 'achievement_images', basename(iconField))
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function findSettingsDir(gameDir: string): string | null {
  for (const name of ['steam_settings', 'steam_settings.EXAMPLE']) {
    const dir = join(gameDir, name)
    if (existsSync(join(dir, 'achievements.json'))) return dir
  }
  return null
}

/** Loads the schema for a game folder. Returns null when there is no steam_settings. */
export function loadSchema(gameDir: string): GameSchema | null {
  const settingsDir = findSettingsDir(gameDir)
  if (!settingsDir) return null

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(settingsDir, 'achievements.json'), 'utf-8'))
  } catch {
    return null
  }
  if (!Array.isArray(raw)) return null

  const achievements: SchemaAch[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    const name = typeof rec.name === 'string' ? rec.name : undefined
    if (!name) continue

    const hiddenRaw = rec.hidden
    const hidden = hiddenRaw === true || hiddenRaw === '1' || hiddenRaw === 1

    const rarityRaw = typeof rec.unlock_percentage === 'number' ? rec.unlock_percentage : undefined

    achievements.push({
      name,
      displayName: localized(rec.displayName) ?? localized(rec.display_name),
      description: localized(rec.description),
      iconPath: resolveIcon(settingsDir, rec.icon),
      iconGrayPath: resolveIcon(settingsDir, rec.icon_gray ?? rec.icongray),
      hidden,
      rarity: rarityRaw
    })
  }

  return achievements.length > 0 ? { dir: settingsDir, achievements } : null
}
