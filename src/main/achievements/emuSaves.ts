import { readFileSync, existsSync } from 'fs'
import { join, basename } from 'path'

/**
 * Decoders for Steam-emulator achievement save files.
 *
 * Vavilon originally only read %APPDATA%\GSE Saves and
 * %APPDATA%\Goldberg SteamEmu Saves. Real games often use scene emulators that
 * write elsewhere (CODEX/RUNE, EMPRESS, RLD!, OnlineFix, Razor1911, CreamAPI,
 * ...), which is why achievements were sometimes "not seen". The table below
 * mirrors the save-root table of Achievement Watcher Next, plus a small set of
 * per-format parsers.
 *
 * Runtime save shapes:
 *   GBE/Goldberg  achievements.json   { "ACH_API": { "earned": true, "earned_time": 1699..., ... } }
 *   CODEX/RUNE    achievements.ini    [State]\nACH_API=1
 *   OnlineFix     achievements.ini    same INI shape
 *   EMPRESS       achievements.json   same JSON shape
 *   Razor1911     achievement         "ACH_API 1 1699...\n" per line
 *   CreamAPI      CreamAPI.Achievements.cfg   INI shape under <appid>\stats
 */

export interface RuntimeAchEntry {
  earned: boolean
  /** Unix seconds, 0 if unknown */
  earnedTime: number
  progress?: number
  maxProgress?: number
}

interface RootSpec {
  /** Windows environment variable the root hangs off */
  env: 'APPDATA' | 'LOCALAPPDATA' | 'PROGRAMDATA' | 'PUBLIC'
  /** Path relative to the env root; <appid> is substituted */
  rel: string
  /** Candidate file names inside the <appid> folder */
  files: string[]
}

/**
 * All known emulator save roots. Read-only: the launcher never writes here
 * (exports and resets only touch `saveRoots()` below, i.e. GSE/Goldberg).
 */
const RUNTIME_ROOTS: RootSpec[] = [
  { env: 'APPDATA', rel: 'GSE Saves/<appid>', files: ['achievements.json', 'achievements.ini'] },
  {
    env: 'APPDATA',
    rel: 'Goldberg SteamEmu Saves/<appid>',
    files: ['achievements.json', 'achievements.ini']
  },
  { env: 'APPDATA', rel: 'Steam/CODEX/<appid>', files: ['achievements.ini'] },
  { env: 'APPDATA', rel: 'Steam/RUNE/<appid>', files: ['achievements.ini'] },
  { env: 'APPDATA', rel: 'Steam/RLD!/<appid>', files: ['achiev.ini', 'Achievements.ini'] },
  { env: 'APPDATA', rel: 'EMPRESS/remote/<appid>', files: ['achievements.json'] },
  { env: 'APPDATA', rel: 'EMPRESS/<appid>', files: ['achievements.json'] },
  { env: 'APPDATA', rel: '.1911/<appid>', files: ['achievement'] },
  { env: 'APPDATA', rel: 'CreamAPI/<appid>/stats', files: ['CreamAPI.Achievements.cfg'] },
  { env: 'PUBLIC', rel: 'Documents/OnlineFix/<appid>', files: ['achievements.ini'] },
  { env: 'PUBLIC', rel: 'Documents/Steam/CODEX/<appid>', files: ['achievements.ini'] },
  { env: 'PUBLIC', rel: 'Documents/Steam/RUNE/<appid>', files: ['achievements.ini'] },
  { env: 'PUBLIC', rel: 'Documents/Steam/CPY/<appid>', files: ['achievements.ini'] },
  { env: 'PUBLIC', rel: 'Documents/Steam/RLD!/<appid>', files: ['achiev.ini', 'Achievements.ini'] },
  { env: 'PUBLIC', rel: 'Documents/EMPRESS/remote/<appid>', files: ['achievements.json'] },
  { env: 'PROGRAMDATA', rel: 'Steam/<appid>/stats', files: ['achievements.ini'] }
]

function envRoot(env: RootSpec['env']): string | null {
  const value = process.env[env]
  return value && value.trim() ? value : null
}

/**
 * Roots the launcher is allowed to WRITE to (export/reset). Kept intentionally
 * narrow: only the two modern Goldberg/GBE locations are managed.
 */
export function saveRoots(): string[] {
  const appData =
    process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
  return [join(appData, 'GSE Saves'), join(appData, 'Goldberg SteamEmu Saves')]
}

/** Every existing runtime achievement file for one Steam appid (read-only). */
export function saveFilesForAppId(appId: number): string[] {
  const out: string[] = []
  const id = String(appId)
  for (const root of RUNTIME_ROOTS) {
    const base = envRoot(root.env)
    if (!base) continue
    const dir = join(base, ...root.rel.split('/').map((part) => (part === '<appid>' ? id : part)))
    for (const file of root.files) {
      const full = join(dir, file)
      if (existsSync(full)) out.push(full)
    }
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
 * a value > 1 is treated as an unlock timestamp. Covers CODEX/RUNE,
 * OnlineFix, CreamAPI and RLD!'s `achiev.ini`.
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

/**
 * Razor1911 `%APPDATA%\.1911\<appid>\achievement`: one entry per line,
 * `ACH_API <0|1> <unix seconds>` (also seen as `ACH_API <0|1>`).
 */
function parseRazorRuntime(raw: string): Record<string, RuntimeAchEntry> {
  const result: Record<string, RuntimeAchEntry> = {}
  for (const line of raw.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 2) continue
    const [name, flag, time] = parts
    if (!/^[A-Za-z0-9_]+$/.test(name)) continue
    const earned = flag !== '0' && flag.toLowerCase() !== 'false'
    const seconds = toNumber(time)
    result[name.toLowerCase()] = {
      earned,
      earnedTime: earned && seconds && seconds > 1 ? seconds : 0
    }
  }
  return result
}

type ParserKind = 'json' | 'ini' | 'razor'

/** Picks a parser from the file name (extension alone is not enough). */
function parserFor(file: string): ParserKind {
  const base = basename(file).toLowerCase()
  if (base === 'achievement') return 'razor'
  if (base.endsWith('.json')) return 'json'
  return 'ini'
}

/** Reads one runtime save file. Returns null if unreadable/invalid. */
export function readRuntimeAchievements(file: string): Record<string, RuntimeAchEntry> | null {
  try {
    const raw = readFileSync(file, 'utf-8')
    switch (parserFor(file)) {
      case 'json':
        return parseJsonRuntime(raw)
      case 'razor':
        return parseRazorRuntime(raw)
      default:
        return parseIniRuntime(raw)
    }
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
      // keep the later timestamp; a flag-only unlock (time 0) must still win
      if (!prev || entry.earnedTime > prev.earnedTime || (entry.earned && !prev.earned)) {
        merged[key] = entry
      }
    }
  }
  return Object.keys(merged).length > 0 ? merged : null
}
