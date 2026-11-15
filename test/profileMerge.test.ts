import { describe, expect, it } from 'vitest'
import type { Game } from '../src/shared/types'
import { mergeGames } from '../src/main/profileMerge'

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: 'g_base',
    name: 'Base Game',
    exePath: 'C:\\Games\\Base\\game.exe',
    workDir: 'C:\\Games\\Base',
    args: [],
    playtimeSeconds: 0,
    addedAt: 1,
    achievements: [],
    ...overrides
  }
}

describe('mergeGames', () => {
  it('adds new games and preserves metadata from the profile', () => {
    const metadata = { appId: 42, shortDescription: 'desc', coverUrl: 'https://cdn/cover.jpg' }
    const result = mergeGames([], [
      game({
        name: 'Imported',
        exePath: 'D:\\Imported\\game.exe',
        workDir: undefined,
        metadata
      })
    ])

    expect(result.added).toBe(1)
    expect(result.updated).toBe(0)
    expect(result.games[0].name).toBe('Imported')
    expect(result.games[0].metadata).toEqual(metadata)
    expect(result.games[0].workDir).toBe('D:\\Imported')
    expect(result.games[0].id).not.toBe('g_base')
  })

  it('matches by exe path case-insensitively and merges achievements by latest unlock', () => {
    const base = game({
      achievements: [
        { api: 'ACH_A', unlockedAt: 100 },
        { api: 'ACH_B', unlockedAt: 500 }
      ],
      playtimeSeconds: 1000,
      coverPath: 'C:\\covers\\base.jpg'
    })
    const incoming = game({
      exePath: 'c:\\games\\base\\GAME.EXE',
      playtimeSeconds: 2000,
      achievements: [
        { api: 'ACH_A', unlockedAt: 300 },
        { api: 'ACH_B', unlockedAt: 200 }
      ]
    })

    const result = mergeGames([base], [incoming])
    expect(result.added).toBe(0)
    expect(result.updated).toBe(1)
    const merged = result.games[0]
    expect(merged.playtimeSeconds).toBe(2000)
    expect(merged.coverPath).toBe('C:\\covers\\base.jpg')
    expect(merged.achievements).toEqual([
      { api: 'ACH_A', unlockedAt: 300 },
      { api: 'ACH_B', unlockedAt: 500 }
    ])
  })

  it('matches by Steam appId even when the install path changed', () => {
    const base = game({ appId: 1091500 })
    const incoming = game({
      exePath: 'E:\\New Drive\\Cyberpunk\\bin\\game.exe',
      appId: 1091500
    })

    const result = mergeGames([base], [incoming])
    expect(result.updated).toBe(1)
    expect(result.games).toHaveLength(1)
    expect(result.games[0].exePath).toBe('C:\\Games\\Base\\game.exe')
  })

  it('adopts metadata from the profile when the library record has none', () => {
    const base = game()
    const incoming = game({ metadata: { appId: 7, shortDescription: 'from profile' } })

    const result = mergeGames([base], [incoming])
    expect(result.games[0].metadata).toEqual({ appId: 7, shortDescription: 'from profile' })
  })

  it('skips malformed records and deduplicates repeated entries', () => {
    const result = mergeGames(
      [],
      [
        game({ exePath: 'D:\\Same\\game.exe' }),
        game({ exePath: 'd:\\same\\GAME.exe' }),
        { exePath: '' } as Game,
        null as unknown as Game
      ]
    )

    expect(result.added).toBe(1)
    expect(result.updated).toBe(1)
    expect(result.games).toHaveLength(1)
    expect(result.games[0].exePath).toBe('D:\\Same\\game.exe')
  })
})
