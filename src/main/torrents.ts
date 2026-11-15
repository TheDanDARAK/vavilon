import { clipboard, ipcMain, net, shell } from 'electron'
import type { TorrentResultEnvelope, TorrentSearchPage } from '../shared/types'
import { parseMagnetPage, parseSearchPage } from './torrentParsing'

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
