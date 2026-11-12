import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * Decoders for Steam-emulator achievement save files.
 *
 * Runtime save (written by the emulator while the game runs):
 *   %APPDATA%\GSE Saves\<appid>\achievements.json   (GBE Fork / new Goldberg)
 *   %APPDATA%\Goldberg SteamEmu Saves\<appid>\achievements.json (classic Goldberg)
 *   <same roots>\achievements.ini (some forks write INI instead)
 *
 * Runtime JSON shape (from gbe_fork sources):
 *   { "ACH_API_NAME": { "earned": true, "earned_time": 1699..., "progress": 1, "max_progress": 10 } }
 */

export interface RuntimeAchEntry {
  earned: boolean
  /** Unix seconds, 0 if unknown */
  earnedTime: number
  progress?: number
  maxProgress?: number
}

const ACH_FILE_JSON = 'achievements.json'
const ACH_FILE_INI = 'achievements.ini'

export function saveRoots(): string[] {
  const appData =
    process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
  return [join(appData, 'GSE Saves'), join(appData, 'Goldberg SteamEmu Saves')]
}

/** All existing achievement save files for one Steam appid. */
export function saveFilesForAppId(appId: number): string[] {
  const out: string[] = []
  for (const root of saveRoots()) {
    const json = join(root, String(appId), ACH_FILE_JSON)
    const ini = join(root, String(appId), ACH_FILE_INI)
    if (existsSync(json)) out.push(json)
    if (existsSync(ini)) out.push(ini)
  }
  return out
}

function toNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

function parseJsonRuntime(raw: string): Record<string, RuntimeAchEntry> {
  const data = JSON.parse(raw) as Record<string, unknown>
  const result: Record<string, RuntimeAchEntry> = {}

  // Newer fork variant: { "achieved": [{ "name": "...", "earned": true, "earned_time": 0 }] }
  if (Array.isArray(data.achieved)) {
    for (const item of data.achieved as Array<Record<string, unknown>>) {
      if (typeof item.name !== 'string') continue
      result[item.name.toLowerCase()] = {
        earned: item.earned !== false,
        earnedTime: toNumber(item.earned_time) ?? toNumber(item.earnedTime) ?? 0
      }
    }
    return result
  }

  // Common variant: { "ACH_NAME": { "earned": true, "earned_time": 123 } }
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'object' || value === null) continue
    const rec = value as Record<string, unknown>
    result[key.toLowerCase()] = {
      earned: rec.earned === true,
      earnedTime: toNumber(rec.earned_time) ?? toNumber(rec.earnedTime) ?? 0,
      progress: toNumber(rec.progress),
      maxProgress: toNumber(rec.max_progress) ?? toNumber(rec.maxProgress)
    }
  }
  return result
}

/**
 * Lenient INI parser: sections ignored, `KEY=value` lines only.
 * A non-zero numeric value (or any non-empty value) counts as earned;
 * a value > 1 is treated as an unlock timestamp.
 */
function parseIniRuntime(raw: string): Record<string, RuntimeAchEntry> {
  const result: Record<string, RuntimeAchEntry> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('[')) {
      continue
    }
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!key) continue
    const num = toNumber(value)
    const earned = num === undefined ? value !== '' : num !== 0
    const earnedTime = num !== undefined && num > 1 ? num : 0
    result[key.toLowerCase()] = { earned, earnedTime }
  }
  return result
}

/** Reads one runtime save file. Returns null if unreadable/invalid. */
export function readRuntimeAchievements(file: string): Record<string, RuntimeAchEntry> | null {
  try {
    const raw = readFileSync(file, 'utf-8')
    return file.toLowerCase().endsWith('.ini')
      ? parseIniRuntime(raw)
      : parseJsonRuntime(raw)
  } catch {
    return null
  }
}

/** Merged runtime state for an appid across all known emulator roots. */
export function readRuntimeAchievementsForAppId(
  appId: number
): Record<string, RuntimeAchEntry> | null {
  const files = saveFilesForAppId(appId)
  if (files.length === 0) return null
  const merged: Record<string, RuntimeAchEntry> = {}
  for (const file of files) {
    const entries = readRuntimeAchievements(file)
    if (!entries) continue
    for (const [key, entry] of Object.entries(entries)) {
      const prev = merged[key]
      if (!prev || entry.earnedTime > prev.earnedTime) merged[key] = entry
    }
  }
  return Object.keys(merged).length > 0 ? merged : null
}
