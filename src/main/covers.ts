import { app, ipcMain, net } from 'electron'
import { existsSync } from 'fs'
import { mkdir, writeFile, readdir, rm } from 'fs/promises'
import { join, dirname } from 'path'
import type { Game } from '../shared/types'
import { loadSettings } from './saves/saveSettings'
import { getGames, updateGame } from './library'

/**
 * Cover art resolver.
 *
 * Steam CDN alone is not enough: old titles without a vertical capsule, delisted
 * games and non-Steam releases would come up empty. The chain mirrors
 * Achievement Watcher Next:
 *   1. Steam CDN  — library_600x900 → header → library_hero (two mirrors)
 *   2. Steam community name search → AppID → Steam CDN (when the game has no AppID)
 *   3. SteamGridDB — portrait grids by AppID, then by name (bundled public key,
 *      no per-user key needed; a user key in settings takes precedence)
 *   4. RAWG      — background_image by name (only if a RAWG key is configured)
 */

const USER_AGENT = 'vavilon/0.8 (+personal use)'
const TIMEOUT_MS = 20000

/**
 * Public SteamGridDB artwork key, bundled the same way Achievement Watcher Next
 * does it, so covers work without asking the user for a key. A key entered in
 * settings overrides it.
 */
const SGDB_FALLBACK_KEY = '2a9d32ddd0bfe4e1191b4f6ff56fef60'
const SGDB_BASE = 'https://www.steamgriddb.com/api/v2'

export interface CoverCandidate {
  url: string
  /** Human-readable source, shown in setup reports */
  source: string
}

function sgdbKey(): string {
  return loadSettings().store.steamGridDbApiKey.trim() || SGDB_FALLBACK_KEY
}

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const res = await net.fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/** Steam CDN candidates for one AppID, portrait first. */
function steamCandidates(appId: number): CoverCandidate[] {
  const hosts = [
    'https://cdn.cloudflare.steamstatic.com',
    'https://cdn.akamai.steamstatic.com'
  ]
  const files: Array<{ file: string; label: string }> = [
    { file: 'library_600x900_2x.jpg', label: 'Steam (обложка 2x)' },
    { file: 'library_600x900.jpg', label: 'Steam (обложка)' },
    { file: 'header.jpg', label: 'Steam (header)' },
    { file: 'library_hero.jpg', label: 'Steam (hero)' }
  ]
  const out: CoverCandidate[] = []
  for (const { file, label } of files) {
    for (const host of hosts) {
      out.push({ url: `${host}/steam/apps/${appId}/${file}`, source: label })
    }
  }
  return out
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '')
}

/** Keyless Steam community name search → AppID of an exact/normalized match. */
async function steamAppIdByName(name: string): Promise<number | null> {
  const hits = await fetchJson<Array<{ appid: number; name: string }>>(
    `https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(name)}`
  )
  if (!hits || hits.length === 0) return null
  const exact = hits.find((h) => normalizeName(h.name) === normalizeName(name))
  return (exact ?? hits[0]).appid
}

async function sgdbGridsByGameId(gameId: number, source: string): Promise<CoverCandidate[]> {
  const grids = await fetchJson<{ data?: Array<{ url?: string }> }>(
    `${SGDB_BASE}/grids/game/${gameId}?dimensions=600x900&limit=10`,
    { Authorization: `Bearer ${sgdbKey()}` }
  )
  return (grids?.data ?? [])
    .filter((g) => g.url)
    .map((g) => ({ url: g.url as string, source }))
}

/** SteamGridDB portrait grids for a known Steam AppID. */
async function sgdbGridsForSteamAppId(appId: number): Promise<CoverCandidate[]> {
  const identity = await fetchJson<{ data?: { id: number } }>(`${SGDB_BASE}/games/steam/${appId}`, {
    Authorization: `Bearer ${sgdbKey()}`
  })
  const id = identity?.data?.id
  return id ? sgdbGridsByGameId(id, 'SteamGridDB') : []
}

/** SteamGridDB portrait grids by name (autocomplete → first game → grids). */
async function sgdbGridsByName(name: string): Promise<CoverCandidate[]> {
  const search = await fetchJson<{ data?: Array<{ id: number; name: string }> }>(
    `${SGDB_BASE}/search/autocomplete/${encodeURIComponent(name)}`,
    { Authorization: `Bearer ${sgdbKey()}` }
  )
  const list = search?.data ?? []
  if (list.length === 0) return []
  const hit = list.find((g) => normalizeName(g.name) === normalizeName(name)) ?? list[0]
  return sgdbGridsByGameId(hit.id, 'SteamGridDB')
}

/** RAWG background image by name (only when a RAWG key is configured). */
async function rawgCandidates(name: string): Promise<CoverCandidate[]> {
  const key = loadSettings().store.rawgApiKey.trim()
  if (!key) return []
  const data = await fetchJson<{ results?: Array<{ background_image?: string }> }>(
    `https://api.rawg.io/api/games?key=${encodeURIComponent(key)}&search=${encodeURIComponent(name)}&page_size=1`
  )
  const url = data?.results?.[0]?.background_image
  return url ? [{ url, source: 'RAWG' }] : []
}

/**
 * Ordered list of cover candidates for a game. Tries Steam first (fast, exact
 * by AppID), then the non-Steam providers.
 */
export async function findCoverCandidates(game: Game): Promise<CoverCandidate[]> {
  const candidates: CoverCandidate[] = []
  let appId = game.appId

  if (appId) {
    candidates.push(...steamCandidates(appId))
  } else {
    // no AppID: resolve one through the keyless Steam name search
    try {
      const found = await steamAppIdByName(game.name)
      if (found) {
        appId = found
        candidates.push(...steamCandidates(found))
      }
    } catch {
      // offline — the non-Steam providers below may still work
    }
  }

  if (appId) candidates.push(...(await sgdbGridsForSteamAppId(appId)))
  candidates.push(...(await sgdbGridsByName(game.name)))
  candidates.push(...(await rawgCandidates(game.name)))

  return candidates
}

/** Downloads an image response into destBase with an extension from its MIME type. */
async function saveImageResponse(res: Response, destBase: string): Promise<string | null> {
  const type = (res.headers.get('content-type') ?? '').toLowerCase()
  if (!res.ok || !type.startsWith('image')) return null
  const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg'
  const dest = `${destBase}${ext}`
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
  return dest
}

/** Removes previously cached copies of one game's cover (any format). */
async function clearCachedCover(gameId: string): Promise<void> {
  const dir = join(app.getPath('userData'), 'covers')
  if (!existsSync(dir)) return
  try {
    for (const file of await readdir(dir)) {
      if (file.startsWith(`${gameId}.`)) await rm(join(dir, file)).catch(() => {})
    }
  } catch {
    // ignore
  }
}

export interface CoverResult {
  ok: boolean
  path?: string
  source?: string
  message?: string
}

/**
 * Resolves and caches a cover for a game in userData/covers.
 * With `force=false` an existing local cover is kept (setup never clobbers a
 * user's own choice); `force=true` re-downloads and replaces it.
 */
export async function resolveAndCacheCover(game: Game, force: boolean): Promise<CoverResult> {
  if (!force && game.coverPath && existsSync(game.coverPath)) {
    return { ok: true, path: game.coverPath, source: 'локальная обложка' }
  }

  const candidates = await findCoverCandidates(game)
  if (candidates.length === 0) {
    return { ok: false, message: 'Не удалось найти ни одного источника обложки' }
  }

  const destBase = join(app.getPath('userData'), 'covers', game.id)
  // drop stale copies first so the new download is never blocked by an old file
  await clearCachedCover(game.id)

  for (const candidate of candidates) {
    try {
      const res = await net.fetch(candidate.url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      const saved = await saveImageResponse(res, destBase)
      if (saved) {
        updateGame(game.id, { coverPath: saved })
        return { ok: true, path: saved, source: candidate.source }
      }
    } catch {
      // try the next candidate
    }
  }
  return { ok: false, message: 'Обложка не найдена ни в Steam, ни в SteamGridDB, ни в RAWG' }
}

export function registerCoversIpc(): void {
  /** Resolve a cover through the whole provider chain and cache it locally. */
  ipcMain.handle('covers:auto', async (_event, gameId: string, force?: boolean): Promise<CoverResult> => {
    const game = getGames().find((g) => g.id === gameId)
    if (!game) return { ok: false, message: 'Игра не найдена' }
    return resolveAndCacheCover(game, force === true)
  })
}
