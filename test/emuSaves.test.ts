import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { readRuntimeAchievements } from '../src/main/achievements/emuSaves'

let dir: string | null = null

function writeSave(name: string, content: string): string {
  dir = mkdtempSync(join(tmpdir(), 'vavilon-emu-'))
  const file = join(dir, name)
  writeFileSync(file, content, 'utf-8')
  return file
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe('readRuntimeAchievements', () => {
  it('parses the common Goldberg JSON shape and lowercases keys', () => {
    const file = writeSave(
      'achievements.json',
      JSON.stringify({
        ACH_WIN_ONE_GAME: {
          earned: true,
          earned_time: 1700000000,
          progress: 3,
          max_progress: 10
        },
        ACH_LOCKED: { earned: false, earned_time: 0 }
      })
    )

    expect(readRuntimeAchievements(file)).toEqual({
      ach_win_one_game: {
        earned: true,
        earnedTime: 1700000000,
        progress: 3,
        maxProgress: 10
      },
      ach_locked: { earned: false, earnedTime: 0, progress: undefined, maxProgress: undefined }
    })
  })

  it('parses the newer { achieved: [...] } variant', () => {
    const file = writeSave(
      'achievements.json',
      JSON.stringify({
        achieved: [
          { name: 'ACH_A', earned: true, earned_time: 42 },
          { name: 'ACH_B', earned: false, earned_time: 0 }
        ]
      })
    )

    expect(readRuntimeAchievements(file)).toEqual({
      ach_a: { earned: true, earnedTime: 42 },
      ach_b: { earned: false, earnedTime: 0 }
    })
  })

  it('parses INI saves, treating non-zero values as unlocks/timestamps', () => {
    const file = writeSave(
      'achievements.ini',
      ['[Achievements]', 'ACH_ZERO=0', 'ACH_ONE=1', 'ACH_TIME=1700000000', 'ACH_TEXT=yes'].join('\n')
    )

    expect(readRuntimeAchievements(file)).toEqual({
      ach_zero: { earned: false, earnedTime: 0 },
      ach_one: { earned: true, earnedTime: 0 },
      ach_time: { earned: true, earnedTime: 1700000000 },
      ach_text: { earned: true, earnedTime: 0 }
    })
  })

  it('returns null for invalid JSON instead of throwing', () => {
    const file = writeSave('achievements.json', '{ not really json')
    expect(readRuntimeAchievements(file)).toBeNull()
  })
})
