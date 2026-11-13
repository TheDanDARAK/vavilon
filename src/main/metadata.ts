import { ipcMain, net } from 'electron'
import type { GameMetadata, SteamSearchHit } from '../shared/types'
import { getGames, updateGame } from './library'

/**
 * Internet metadata provider (Steam store).
 * Only text + CDN URLs are persisted — the renderer streams images and
 * videos directly from the CDN, so no media is ever cached on disk.
 */

const TIMEOUT_MS = 12000

async function fetchJson<T>(url: string): Promise<T> {
  const res = await net.fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} от ${new URL(url).host}`)
  return (await res.json()) as T
}

/** Normalizes a name for the "no AppID" auto-match check */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '')
}

/**
 * Name search through the unofficial (but stable, keyless) Steam community
 * endpoint. Returns a flat list of suggestions.
 */
export async function searchSteam(term: string): Promise<SteamSearchHit[]> {
  const q = term.trim()
  if (q.length < 2) return []
  const hits = await fetchJson<Array<{ appid: number; name: string; icon?: string }>>(
    `https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(q)}`
  )
  return hits.map((h) => ({
    appId: h.appid,
    name: h.name,
    iconUrl: h.icon
  }))
}

interface SteamAppData {
  type?: string
  name?: string
  short_description?: string
  detailed_description?: string
  header_image?: string
  release_date?: { coming_soon?: boolean; date?: string }
  developers?: string[]
  publishers?: string[]
  genres?: Array<{ description?: string }>
  screenshots?: Array<{ path_thumbnail?: string; path_full?: string }>
  movies?: Array<{
    thumbnail?: string
    mp4?: { max?: string; '480'?: string }
  }>
}

interface SteamAppDetails {
  [appId: string]: {
    success: boolean
    data?: SteamAppData
  }
}

/** Builds the store CDN URLs for the vertical cover / hero images */
function cdnApp(appId: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}`
}

/** Review summary (best-effort, may fail without breaking the rest) */
async function fetchRating(appId: number): Promise<Pick<GameMetadata, 'ratingPct' | 'ratingLabel'>> {
  try {
    const r = await fetchJson<{
      query_summary?: { review_score_desc?: string; total_positive?: number; total_reviews?: number }
    }>(`https://store.steampowered.com/appreviews/${appId}?json=1&language=russian&purchase_type=all`)
    const q = r.query_summary
    if (q && (q.total_reviews ?? 0) > 0) {
      return {
        ratingPct: Math.round(((q.total_positive ?? 0) / q.total_reviews!) * 100),
        ratingLabel: q.review_score_desc
      }
    }
  } catch {
    // rating is optional
  }
  return {}
}

/** Downloads and assembles full metadata for one Steam AppID. */
export async function fetchMetadata(appId: number): Promise<GameMetadata | null> {
  const details = await fetchJson<SteamAppDetails>(
    `https://store.steampowered.com/api/appdetails?appids=${appId}&l=russian`
  )
  const entry = details[String(appId)]
  if (!entry?.success || !entry.data) return null
  const data = entry.data

  const trailer = data.movies?.[0]?.mp4
  const meta: GameMetadata = {
    appId,
    shortDescription: data.short_description,
    fullDescription: data.detailed_description,
    coverUrl: `${cdnApp(appId)}/library_600x900.jpg`,
    headerUrl: data.header_image,
    heroUrl: `${cdnApp(appId)}/library_hero.jpg`,
    trailerUrl: trailer?.max ?? trailer?.['480'],
    trailerThumbUrl: data.movies?.[0]?.thumbnail,
    screenshots: (data.screenshots ?? [])
      .filter((s) => s.path_full)
      .map((s) => ({ url: s.path_full!, thumbUrl: s.path_thumbnail })),
    developer: data.developers,
    publisher: data.publishers,
    genres: (data.genres ?? []).map((g) => g.description ?? '').filter(Boolean),
    releaseDate: data.release_date?.coming_soon
      ? 'Скоро выйдет'
      : data.release_date?.date || undefined,
    storeUrl: `https://store.steampowered.com/app/${appId}/`,
    fetchedAt: Date.now()
  }

  // enrich with the rating; appdetails itself doesn't include review stats
  Object.assign(meta, await fetchRating(appId))
  return meta
}

/** Result of a metadata sync shown to the user */
interface SyncResult {
  ok: boolean
  message?: string
}

/**
 * Fetches metadata for a library game and stores it on the record.
 * If the game has no AppID, a name search is tried first and accepted
 * only on an exact (normalized) match — no guessing for similar names.
 */
export async function syncGame(gameId: string): Promise<SyncResult> {
  const game = getGames().find((g) => g.id === gameId)
  if (!game) return { ok: false, message: 'Игра не найдена в библиотеке' }

  let appId = game.appId
  if (!appId) {
    try {
      const hits = await searchSteam(game.name)
      const exact = hits.find((h) => normalizeName(h.name) === normalizeName(game.name))
      if (exact) {
        appId = exact.appId
        updateGame(gameId, { appId })
      }
    } catch {
      // offline — fall through to the error below
    }
    if (!appId) {
      return { ok: false, message: `Не удалось определить Steam AppID для «${game.name}» — укажите его вручную в редакторе игры` }
    }
  }

  try {
    const metadata = await fetchMetadata(appId)
    if (!metadata) return { ok: false, message: 'Steam не вернул данные для этого AppID' }
    updateGame(gameId, { metadata })
    return { ok: true }
  } catch (e) {
    return { ok: false, message: `Ошибка сети: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export function registerMetadataIpc(ipc: typeof ipcMain): void {
  ipc.handle('metadata:search', (_event, term: string) => searchSteam(term))

  ipc.handle('metadata:fetch', (_event, appId: number) => fetchMetadata(appId))

  ipc.handle('metadata:apply', (_event, gameId: string, metadata: GameMetadata) => {
    updateGame(gameId, { metadata })
    return true
  })

  ipc.handle('metadata:sync', (_event, gameId: string) => syncGame(gameId))
}
