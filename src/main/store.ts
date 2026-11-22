import { ipcMain, net } from 'electron'
import type {
  GameScreenshot,
  StoreGame,
  StoreGameDetails,
  StoreList,
  StoreRecommendation,
  StoreResult,
  WishlistEntry
} from '../shared/types'
import {
  getGames,
  getWishlist,
  addToWishlist,
  removeFromWishlist
} from './library'
import { loadSettings, saveSettingsPatch } from './saves/saveSettings'

/**
 * Storefront data provider (RAWG API): new releases, game details, catalogue
 * search and "recommended for you" suggestions derived from the user's own
 * library genres. Only JSON + CDN URLs cross the bridge — images are streamed
 * straight from the RAWG CDN, nothing is cached on disk (same policy as Steam
 * metadata).
 */

const RAWG_BASE = 'https://api.rawg.io/api'
const TIMEOUT_MS = 15000
const CACHE_TTL_MS = 10 * 60 * 1000
const PAGE_SIZE = 24

interface RawgGenre {
  name?: string
  slug?: string
}

interface RawgGame {
  id: number
  name: string
  background_image?: string
  released?: string
  rating?: number
  metacritic?: number
  genres?: RawgGenre[]
}

interface RawgDetails extends RawgGame {
  description_raw?: string
  website?: string
  screenshots?: Array<{ image?: string }>
}

interface RawgList {
  results?: RawgGame[]
  /** Total matches across all pages */
  count?: number
  /** RAWG returns null on the last page */
  next?: string | null
}

/* ---------- low-level plumbing ---------- */

/** Tiny in-memory TTL cache so switching tabs never hammers the rate limit */
const cache = new Map<string, { at: number; data: unknown }>()
const CACHE_MAX_ENTRIES = 300

function cacheSet(url: string, data: unknown): void {
  // prune expired entries first, then evict the oldest ones (Map keeps insertion order)
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const now = Date.now()
    for (const [key, entry] of cache) {
      if (now - entry.at >= CACHE_TTL_MS) cache.delete(key)
    }
  }
  while (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  cache.set(url, { at: Date.now(), data })
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await net.fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} от api.rawg.io`)
  return (await res.json()) as T
}

function apiKey(): string {
  return loadSettings().store.rawgApiKey.trim()
}

async function rawg<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = apiKey()
  if (!key) throw new Error('NO_KEY')
  const url = `${RAWG_BASE}${path}?${new URLSearchParams({ ...params, key }).toString()}`
  const cached = cache.get(url)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data as T
  const data = await fetchJson<T>(url)
  cacheSet(url, data)
  return data
}

function fail<T>(e: unknown): StoreResult<T> {
  const message = e instanceof Error ? e.message : String(e)
  return message === 'NO_KEY'
    ? { ok: false, error: 'Сначала укажите ключ RAWG API в настройках витрины', needKey: true }
    : { ok: false, error: `Ошибка сети: ${message}` }
}

/* ---------- normalization & library analysis ---------- */

function toStoreGame(g: RawgGame): StoreGame {
  return {
    id: g.id,
    name: g.name,
    coverUrl: g.background_image,
    released: g.released || undefined,
    rating: g.rating,
    metacritic: g.metacritic,
    genres: (g.genres ?? []).map((x) => x.name ?? '').filter(Boolean)
  }
}

function toStoreList(data: RawgList): StoreList<StoreGame> {
  const items = (data.results ?? []).map(toStoreGame)
  return {
    items,
    total: data.count ?? items.length,
    hasMore: Boolean(data.next) && items.length > 0
  }
}

/**
 * Steam genre names (as stored in library metadata, Russian) → RAWG genre
 * slugs. Substring matching keeps it robust against naming variants
 * («Экшен», «Экшен-игры», «Ролевые игры», …).
 */
const GENRE_MATCHERS: Array<[RegExp, string]> = [
  [/экшен|action/i, 'action'],
  [/шутер|shooter/i, 'shooter'],
  [/стратег|strategy/i, 'strategy'],
  [/ролев|rpg/i, 'role-playing-games-rpg'],
  [/головолом|puzzle/i, 'puzzle'],
  [/платформ/i, 'platformer'],
  [/симулятор|simulation/i, 'simulation'],
  [/спорт|sports/i, 'sports'],
  [/гонк|racing/i, 'racing'],
  [/приключ|adventure/i, 'adventure'],
  [/инди|indie/i, 'indie'],
  [/казуал|casual/i, 'casual'],
  [/файтинг|fighting/i, 'fighting'],
  [/многопользоват|multiplayer/i, 'massively-multiplayer'],
  [/музык|music/i, 'music']
]

function matchGenre(name: string): string | null {
  for (const [pattern, slug] of GENRE_MATCHERS) {
    if (pattern.test(name)) return slug
  }
  return null
}

/**
 * The user's top-3 genres, weighted by actual activity: total playtime counts
 * far more than how many owned games merely mention the genre, so "who plays
 * shooters for 200 hours" gets shooter suggestions even with 20 RPGs owned.
 */
function libraryGenreSlugs(): string[] {
  const stats = new Map<string, { count: number; playtime: number }>()
  for (const game of getGames()) {
    for (const name of game.metadata?.genres ?? []) {
      const slug = matchGenre(name)
      if (!slug) continue
      const s = stats.get(slug) ?? { count: 0, playtime: 0 }
      s.count += 1
      s.playtime += game.playtimeSeconds ?? 0
      stats.set(slug, s)
    }
  }
  return [...stats.entries()]
    .sort(
      (a, b) =>
        b[1].playtime / 3600 + b[1].count * 0.5 - (a[1].playtime / 3600 + a[1].count * 0.5)
    )
    .slice(0, 3)
    .map(([slug]) => slug)
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '')
}

/** Drops owned/wishlisted games, keeps the first occurrence of each id */
function filterOwned(games: StoreGame[], excludeIds: number[] = []): StoreGame[] {
  const owned = new Set(getGames().map((g) => normalizeName(g.name)))
  const wished = new Set(getWishlist().map((w) => w.id))
  const seen = new Set<number>(excludeIds)
  return games.filter((g) => {
    if (seen.has(g.id)) return false
    seen.add(g.id)
    return !owned.has(normalizeName(g.name)) && !wished.has(g.id)
  })
}

/** Rawg "dates" range for the last 60 days, e.g. "2026-09-14|2026-11-13" */
function dateRange(): string {
  const fmt = (d: Date): string => d.toISOString().slice(0, 10)
  const now = new Date()
  const past = new Date(now.getTime() - 60 * 24 * 3600 * 1000)
  return `${fmt(past)}|${fmt(now)}`
}

/* ---------- public API (called over IPC) ---------- */

/** Similar games: RAWG "suggested" when available, genre match as fallback */
export async function storeSimilar(rawgId: number): Promise<StoreResult<StoreGame[]>> {
  if (!apiKey()) return fail(new Error('NO_KEY'))
  try {
    try {
      const data = await rawg<{ results?: RawgGame[] }>(`/games/${rawgId}/suggested`, {
        page_size: String(PAGE_SIZE)
      })
      if (data.results && data.results.length > 0) {
        return { ok: true, data: filterOwned(data.results.map(toStoreGame), [rawgId]) }
      }
    } catch {
      // the suggested endpoint may be unavailable — genre matching still works
    }
    const source = await rawg<RawgGame>(`/games/${rawgId}`, {})
    const slugs = (source.genres ?? []).map((x) => x.slug ?? '').filter(Boolean).slice(0, 3)
    if (slugs.length === 0) return { ok: true, data: [] }
    const data = await rawg<{ results?: RawgGame[] }>('/games', {
      genres: slugs.join(','),
      ordering: '-added',
      page_size: String(PAGE_SIZE)
    })
    return { ok: true, data: filterOwned((data.results ?? []).map(toStoreGame), [rawgId]) }
  } catch (e) {
    return fail(e)
  }
}

/**
 * "Similar" for a library game: resolves its name against the RAWG catalogue
 * (exact match preferred, first hit otherwise) and runs storeSimilar on it.
 */
export async function storeSimilarForLibraryGame(
  gameId: string
): Promise<StoreResult<{ games: StoreGame[]; source?: string }>> {
  if (!apiKey()) return fail(new Error('NO_KEY'))
  const game = getGames().find((g) => g.id === gameId)
  if (!game) return { ok: false, error: 'Игра не найдена в библиотеке' }
  try {
    const hits = await rawg<{ results?: RawgGame[] }>('/games', {
      search: game.name,
      page_size: '3'
    })
    const results = hits.results ?? []
    const hit =
      results.find((h) => normalizeName(h.name) === normalizeName(game.name)) ?? results[0]
    if (!hit) return { ok: true, data: { games: [] } }
    const similar = await storeSimilar(hit.id)
    if (!similar.ok) return { ok: false, error: similar.error }
    return { ok: true, data: { games: similar.data ?? [], source: hit.name } }
  } catch (e) {
    return fail(e)
  }
}

/** New releases from the last 60 days, optionally filtered by one genre */
export async function storeNewReleases(
  genreSlug?: string,
  page = 1
): Promise<StoreResult<StoreList<StoreGame>>> {
  if (!apiKey()) return fail(new Error('NO_KEY'))
  try {
    const params: Record<string, string> = {
      dates: dateRange(),
      ordering: '-released',
      page_size: String(PAGE_SIZE),
      page: String(Math.max(1, Math.trunc(page)))
    }
    if (genreSlug) params.genres = genreSlug
    const data = await rawg<RawgList>('/games', params)
    return { ok: true, data: toStoreList(data) }
  } catch (e) {
    return fail(e)
  }
}

/**
 * "Recommended for you": a batch picked by the library's top genres
 * (comma-separated slugs act as OR on the RAWG side), minus everything the
 * user already owns. Without genres in the library it falls back to the
 * most-popular feed and says so via an empty basisSlugs list.
 */
export async function storeRecommendations(): Promise<StoreResult<StoreRecommendation>> {
  if (!apiKey()) return fail(new Error('NO_KEY'))
  try {
    const slugs = libraryGenreSlugs()
    const params: Record<string, string> =
      slugs.length > 0
        ? { genres: slugs.join(','), ordering: '-added', page_size: String(PAGE_SIZE) }
        : { ordering: '-added', page_size: String(PAGE_SIZE) }
    const data = await rawg<{ results?: RawgGame[] }>('/games', params)
    return {
      ok: true,
      data: { games: filterOwned((data.results ?? []).map(toStoreGame)), basisSlugs: slugs }
    }
  } catch (e) {
    return fail(e)
  }
}

/** One store game's details: description, screenshots, website */
export async function storeDetails(id: number): Promise<StoreResult<StoreGameDetails>> {
  if (!apiKey()) return fail(new Error('NO_KEY'))
  try {
    const g = await rawg<RawgDetails>(`/games/${id}`, {})
    if (!g?.id) return { ok: false, error: 'RAWG не вернул данные для этой игры' }
    const screenshots: GameScreenshot[] = (g.screenshots ?? [])
      .filter((s) => s.image)
      .map((s) => ({ url: s.image as string }))
    return {
      ok: true,
      data: {
        ...toStoreGame(g),
        description: g.description_raw,
        website: g.website || undefined,
        screenshots
      }
    }
  } catch (e) {
    return fail(e)
  }
}

/** Catalogue search (used by the storefront search field) */
export async function storeSearch(
  term: string,
  page = 1
): Promise<StoreResult<StoreList<StoreGame>>> {
  if (!apiKey()) return fail(new Error('NO_KEY'))
  const q = term.trim()
  if (q.length < 2) return { ok: true, data: { items: [], total: 0, hasMore: false } }
  try {
    const data = await rawg<RawgList>('/games', {
      search: q,
      page_size: String(PAGE_SIZE),
      page: String(Math.max(1, Math.trunc(page)))
    })
    return { ok: true, data: toStoreList(data) }
  } catch (e) {
    return fail(e)
  }
}

/* ---------- IPC ---------- */

export function registerStoreIpc(ipc: typeof ipcMain): void {
  ipc.handle('store:getKey', () => loadSettings().store.rawgApiKey)

  ipc.handle('store:setKey', (_event, key: string) => {
    const next = saveSettingsPatch({ store: { rawgApiKey: key.trim() } })
    return next.store.rawgApiKey
  })

  /** Optional SteamGridDB key (empty → the launcher uses its bundled public key). */
  ipc.handle('store:getSteamGridDbKey', () => loadSettings().store.steamGridDbApiKey)
  ipc.handle('store:setSteamGridDbKey', (_event, key: string) => {
    const next = saveSettingsPatch({ store: { steamGridDbApiKey: key.trim() } })
    return next.store.steamGridDbApiKey
  })

  ipc.handle('store:newReleases', (_event, genre?: string, page?: number) =>
    storeNewReleases(genre || undefined, page ?? 1)
  )

  ipc.handle('store:recommend', () => storeRecommendations())

  ipc.handle('store:details', (_event, id: number) => storeDetails(id))

  ipc.handle('store:search', (_event, term: string, page?: number) =>
    storeSearch(term, page ?? 1)
  )

  ipc.handle('store:similar', (_event, id: number) => storeSimilar(id))

  ipc.handle('store:similarForGame', (_event, gameId: string) => storeSimilarForLibraryGame(gameId))

  /* wishlist: persisted in library.json next to the games */
  ipc.handle('store:wishlist:get', () => getWishlist())
  ipc.handle('store:wishlist:add', (_event, entry: WishlistEntry) => addToWishlist(entry))
  ipc.handle('store:wishlist:remove', (_event, id: number) => removeFromWishlist(id))
}
