import { clipboard, ipcMain, net, shell } from 'electron'
import type {
  TorrentResult,
  TorrentResultEnvelope,
  TorrentSearchPage
} from '../shared/types'

/**
 * Torrent release search through the [Ex]Freedomist aggregator
 * (https://search.exfreedomist.com).
 *
 * The site is a plain server-rendered HTML app:
 *  - POST / with form fields query, offset, order_by → results page;
 *  - every result links to /magnet?key=…&token=… — a *one-time* page that
 *    contains the actual magnet: URI. Because the token is consumed on the
 *    first request, the magnet is fetched lazily (when the user asks for it)
 *    and the renderer caches the resulting URI.
 *
 * Nothing torrent-related is persisted: only parsed JSON crosses the bridge.
 */

const BASE = 'https://search.exfreedomist.com'
const TIMEOUT_MS = 15000

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Vavilon/1.0'

/** HTML entity decoder for the handful of entities the aggregator emits */
function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCharCode(parseInt(code, 16)))
}

/** Strips inline tags (the site highlights matches with <mark>) and normalizes space */
function textOf(htmlFragment: string): string {
  return decodeEntities(htmlFragment.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function toInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function parseSearchPage(html: string): TorrentSearchPage {
  const total = toInt(html.match(/<h4[^>]*>\s*<b>(\d+)<\/b>/i)?.[1]) ?? 0
  const results: TorrentResult[] = []

  // Each result is a <p>…</p> block separated by <hr>. Splitting on <hr> keeps
  // the parser independent of whitespace/attribute order changes.
  for (const block of html.split(/<hr\s*\/?>/i)) {
    if (!block.includes('/magnet?')) continue

    const link = block.match(
      /<a[^>]*href="([^"]*\/magnet\?[^"]*)"[^>]*>([\s\S]*?)<\/a>/i
    )
    if (!link) continue

    const href = link[1]
    const title = textOf(link[2])
    if (!title) continue

    const tracker = textOf(block.match(/<b>\s*\[([^\]]+)\]\s*<\/b>/i)?.[1] ?? '')
    const category = textOf(block.match(/<i[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/i>/i)?.[1] ?? '')

    // "<b>148.88 GB</b> | 2026-05-17"
    const sizeDate = block.match(
      /<b>\s*([\d.,]+\s*(?:B|KB|MB|GB|TB|PB))\s*<\/b>\s*\|\s*(\d{4}-\d{2}-\d{2})/i
    )
    const seeds = block.match(/S\.:\s*(\d+)/i)?.[1]
    const leechers = block.match(/L\.:\s*(\d+)/i)?.[1]
    const verified = /✅/.test(block) && !/не проверено/i.test(block)

    results.push({
      key: href,
      title,
      tracker: tracker || undefined,
      category: category || undefined,
      size: sizeDate?.[1]?.replace(/\s+/g, ' ') || undefined,
      date: sizeDate?.[2],
      seeds: toInt(seeds),
      leechers: toInt(leechers),
      verified
    })
  }

  return { total, results }
}

function parseMagnetPage(html: string): string | null {
  // <code onclick="copy(this)" id="magnet-link">magnet:?xt=…</code>
  const byId = html.match(/id="magnet-link"[^>]*>\s*(magnet:\?[\s\S]*?)<\/code>/i)
  if (byId) return decodeEntities(byId[1]).trim()
  const generic = html.match(/magnet:\?[^"'<>\s]+/i)
  return generic ? decodeEntities(generic[0]).trim() : null
}

export async function searchTorrents(
  query: string,
  options: { orderBy?: string; offset?: number } = {}
): Promise<TorrentResultEnvelope<TorrentSearchPage>> {
  const q = query.trim()
  if (q.length < 2) return { ok: true, data: { total: 0, results: [] } }

  const orderBy = ['d', 's', 'z', 'r', 't', 'l'].includes(options.orderBy ?? '')
    ? (options.orderBy as string)
    : 'd'
  const offset = Math.max(0, Math.trunc(options.offset ?? 0))

  try {
    const res = await net.fetch(`${BASE}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html',
        'User-Agent': USER_AGENT
      },
      body: new URLSearchParams({
        query: q,
        offset: String(offset),
        order_by: orderBy
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} от search.exfreedomist.com` }
    return { ok: true, data: parseSearchPage(await res.text()) }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Ошибка сети: ${message}` }
  }
}

export async function fetchMagnet(key: string): Promise<TorrentResultEnvelope<string>> {
  // Only relative /magnet paths from our own results are allowed
  let url: URL
  try {
    url = new URL(key, BASE)
  } catch {
    return { ok: false, error: 'Некорректная ссылка на раздачу' }
  }
  if (url.hostname !== new URL(BASE).hostname || !url.pathname.startsWith('/magnet')) {
    return { ok: false, error: 'Некорректная ссылка на раздачу' }
  }

  try {
    const res = await net.fetch(url.toString(), {
      headers: { Accept: 'text/html', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} при получении magnet-ссылки` }
    const magnet = parseMagnetPage(await res.text())
    if (!magnet) {
      return {
        ok: false,
        error: 'Ссылка на раздачу устарела — обновите поиск и попробуйте снова'
      }
    }
    return { ok: true, data: magnet }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Ошибка сети: ${message}` }
  }
}

/* ---------- IPC ---------- */

export function registerTorrentsIpc(ipc: typeof ipcMain): void {
  ipc.handle('torrents:search', (_event, query: string, options?: { orderBy?: string; offset?: number }) =>
    searchTorrents(query, options ?? {})
  )
  ipc.handle('torrents:magnet', (_event, key: string) => fetchMagnet(key))

  /** Copy a magnet URI to the clipboard (renderer may not be a secure context) */
  ipc.handle('torrents:copy', (_event, text: string) => {
    clipboard.writeText(String(text))
    return true
  })

  /** Hand a magnet URI to the system torrent client */
  ipc.handle('torrents:open', async (_event, uri: string) => {
    const magnet = String(uri).trim()
    if (!magnet.startsWith('magnet:?')) return false
    await shell.openExternal(magnet)
    return true
  })
}
