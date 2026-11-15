import { describe, expect, it } from 'vitest'
import { sanitizeGamePatch } from '../src/main/gamePatch'

describe('sanitizeGamePatch', () => {
  it('keeps whitelisted fields and drops id / unknown keys', () => {
    const patch = sanitizeGamePatch({
      id: 'hacked',
      name: '  New Name  ',
      exePath: ' D:\\Game\\game.exe ',
      appId: 1091500,
      playtimeSeconds: 120,
      evil: true
    })

    expect(patch).toEqual({
      name: 'New Name',
      exePath: 'D:\\Game\\game.exe',
      appId: 1091500,
      playtimeSeconds: 120
    })
  })

  it('preserves explicit undefined to allow clearing optional fields', () => {
    expect(sanitizeGamePatch({ appId: undefined, coverPath: undefined, workDir: undefined })).toEqual({
      appId: undefined,
      coverPath: undefined,
      workDir: undefined
    })
  })

  it('rejects wrong types instead of writing them into the library', () => {
    expect(
      sanitizeGamePatch({
        name: 42,
        exePath: '',
        appId: '123',
        playtimeSeconds: '999',
        args: 'not-an-array',
        metadata: []
      })
    ).toEqual({})
  })

  it('accepts only positive integers for appId and positive timestamps', () => {
    expect(sanitizeGamePatch({ appId: 0 })).toEqual({})
    expect(sanitizeGamePatch({ appId: -5 })).toEqual({})
    expect(sanitizeGamePatch({ appId: 1.5 })).toEqual({})
    expect(sanitizeGamePatch({ lastPlayedAt: 0 })).toEqual({})
    expect(sanitizeGamePatch({ lastPlayedAt: 1700000000000 })).toEqual({
      lastPlayedAt: 1700000000000
    })
  })

  it('filters non-string args and malformed achievement records', () => {
    expect(
      sanitizeGamePatch({
        args: ['-windowed', 42, '--lang=ru'],
        achievements: [
          { api: 'ACH_A', unlockedAt: 1 },
          { noApi: true },
          null
        ]
      })
    ).toEqual({
      args: ['-windowed', '--lang=ru'],
      achievements: [{ api: 'ACH_A', unlockedAt: 1 }]
    })
  })

  it('returns an empty patch for null/array input', () => {
    expect(sanitizeGamePatch(null)).toEqual({})
    expect(sanitizeGamePatch([1, 2])).toEqual({})
    expect(sanitizeGamePatch('nope')).toEqual({})
  })
})
