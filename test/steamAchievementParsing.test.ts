import { describe, expect, it } from 'vitest'
import { parseAchievementsPage } from '../src/main/steamAchievementParsing'

const ssr = (items: Array<Record<string, unknown>>): string =>
  `<script>window.__SSR = ${JSON.stringify(items).replace(/"/g, '\\"')}</script>`

describe('parseAchievementsPage', () => {
  it('parses the SSR achievement blob and unescapes quotes', () => {
    const html = ssr([
      {
        internal_key: 1,
        api_name: 'ACH_WIN',
        name: 'Победитель',
        description: 'Выиграйте игру',
        hidden: false,
        archived: false,
        icon_achieved: 'hash-a',
        icon_unachieved: 'hash-b'
      },
      {
        internal_key: 2,
        api_name: 'ACH_SECRET',
        name: 'Секрет',
        description: '',
        hidden: true,
        archived: false,
        icon_achieved: 'hash-c',
        icon_unachieved: 'hash-d'
      }
    ])

    expect(parseAchievementsPage(html)).toEqual([
      {
        api: 'ACH_WIN',
        name: 'Победитель',
        description: 'Выиграйте игру',
        hidden: false,
        iconHash: 'hash-a',
        iconGrayHash: 'hash-b'
      },
      {
        api: 'ACH_SECRET',
        name: 'Секрет',
        description: '',
        hidden: true,
        iconHash: 'hash-c',
        iconGrayHash: 'hash-d'
      }
    ])
  })

  it('returns an empty list when the page has no achievements', () => {
    expect(parseAchievementsPage('<html><body>no achievements</body></html>')).toEqual([])
  })
})
