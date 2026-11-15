import type { TorrentResult, TorrentSearchPage } from '../shared/types'

/**
 * Pure HTML parsing for the [Ex]Freedomist aggregator. Kept separate from the
 * network layer so it can be unit-tested without Electron.
 */

/** HTML entity decoder for the handful of entities the aggregator emits */
export function decodeEntities(value: string): string {
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

export function parseSearchPage(html: string): TorrentSearchPage {
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

export function parseMagnetPage(html: string): string | null {
  // <code onclick="copy(this)" id="magnet-link">magnet:?xt=…</code>
  const byId = html.match(/id="magnet-link"[^>]*>\s*(magnet:\?[\s\S]*?)<\/code>/i)
  if (byId) return decodeEntities(byId[1]).trim()
  const generic = html.match(/magnet:\?[^"'<>\s]+/i)
  return generic ? decodeEntities(generic[0]).trim() : null
}
