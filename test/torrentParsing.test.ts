import { describe, expect, it } from 'vitest'
import { decodeEntities, parseMagnetPage, parseSearchPage } from '../src/main/torrentParsing'

describe('parseSearchPage', () => {
  const html = [
    '<h4><b>2</b> раздачи</h4>',
    '<p><b>[rutracker]</b> <i class="result-cat">RPG</i> ',
    '<a href="/magnet?key=abc&token=def"><mark>Game</mark> &amp; <b>Title</b></a> ',
    '<b>148.88 GB</b> | 2026-05-17 S.: 123 L.: 4 ✅</p>',
    '<hr>',
    '<p><a href="/magnet?key=2">Second</a> <b>1.5 GB</b> | 2026-04-01 ',
    'S.: 0 L.: 10 ✅ не проверено</p>'
  ].join('')

  it('parses total, tracker, category, title, size/date and peers', () => {
    const page = parseSearchPage(html)
    expect(page.total).toBe(2)
    expect(page.results).toHaveLength(2)
    expect(page.results[0]).toEqual({
      key: '/magnet?key=abc&token=def',
      title: 'Game & Title',
      tracker: 'rutracker',
      category: 'RPG',
      size: '148.88 GB',
      date: '2026-05-17',
      seeds: 123,
      leechers: 4,
      verified: true
    })
  })

  it('marks a release with "не проверено" as unverified', () => {
    expect(parseSearchPage(html).results[1].verified).toBe(false)
  })

  it('ignores blocks without a magnet link', () => {
    const noResults = '<h4><b>0</b></h4><p>Nothing here</p><hr>'
    expect(parseSearchPage(noResults)).toEqual({ total: 0, results: [] })
  })
})

describe('parseMagnetPage', () => {
  it('extracts and decodes the one-time magnet link by id', () => {
    const html =
      '<code onclick="copy(this)" id="magnet-link">magnet:?xt=urn:btih:ABC&amp;dn=Game</code>'
    expect(parseMagnetPage(html)).toBe('magnet:?xt=urn:btih:ABC&dn=Game')
  })

  it('falls back to any magnet URI on the page', () => {
    const html = '<a href="magnet:?xt=urn:btih:XYZ&dn=Test">download</a>'
    expect(parseMagnetPage(html)).toBe('magnet:?xt=urn:btih:XYZ&dn=Test')
  })

  it('returns null when no magnet is present', () => {
    expect(parseMagnetPage('<p>expired</p>')).toBeNull()
  })
})

describe('decodeEntities', () => {
  it('decodes the entities the aggregator emits', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &#39;d&#39; &#x27;e&#x27;')).toBe(
      "a & b <c> 'd' 'e'"
    )
  })
})
