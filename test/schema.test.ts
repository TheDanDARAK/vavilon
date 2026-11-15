import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { loadSchema } from '../src/main/achievements/schema'

let dir: string | null = null

function makeGame(files: Record<string, string>): string {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = mkdtempSync(join(tmpdir(), 'vavilon-schema-'))
  for (const [relative, content] of Object.entries(files)) {
    const file = join(dir, relative)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, content, 'utf-8')
  }
  return dir
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe('loadSchema', () => {
  it('reads names, localized text, rarity, hidden flag and icons', () => {
    const gameDir = makeGame({
      'steam_settings/achievements.json': JSON.stringify([
        {
          name: 'ACH_WIN',
          displayName: { english: 'Winner', russian: 'Победитель' },
          description: { english: 'Win a game', russian: 'Выиграйте игру' },
          hidden: '1',
          unlock_percentage: 12.5,
          icon: 'achievement_images/icon_win.png',
          icon_gray: 'achievement_images/icon_win_gray.png'
        }
      ]),
      'steam_settings/achievement_images/icon_win.png': 'png',
      'steam_settings/achievement_images/icon_win_gray.png': 'png'
    })

    const schema = loadSchema(gameDir)
    expect(schema).not.toBeNull()
    const ach = schema!.achievements[0]
    expect(ach).toMatchObject({
      name: 'ACH_WIN',
      displayName: 'Победитель',
      description: 'Выиграйте игру',
      hidden: true,
      rarity: 12.5
    })
    expect(ach.iconPath).toContain('icon_win.png')
    expect(ach.iconGrayPath).toContain('icon_win_gray.png')
  })

  it('falls back to English and plain strings when Russian is absent', () => {
    const gameDir = makeGame({
      'steam_settings/achievements.json': JSON.stringify([
        { name: 'ACH_A', displayName: { english: 'First' }, description: 'Plain text' },
        { name: 'ACH_B', displayName: 'Plain name', hidden: 0 }
      ])
    })

    const schema = loadSchema(gameDir)
    expect(schema!.achievements[0].displayName).toBe('First')
    expect(schema!.achievements[0].description).toBe('Plain text')
    expect(schema!.achievements[1].displayName).toBe('Plain name')
    expect(schema!.achievements[1].hidden).toBe(false)
    expect(schema!.achievements[1].rarity).toBeUndefined()
  })

  it('returns null when there is no schema or it is invalid', () => {
    expect(loadSchema(makeGame({}))).toBeNull()
    const invalid = makeGame({ 'steam_settings/achievements.json': '[1, 2, 3]' })
    expect(loadSchema(invalid)).toBeNull()
  })
})
