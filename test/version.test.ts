import { describe, expect, it } from 'vitest'
import { isNewerVersion } from '../src/shared/version'

describe('isNewerVersion', () => {
  it('detects a newer patch/minor/major version', () => {
    expect(isNewerVersion('0.6.1', '0.6.0')).toBe(true)
    expect(isNewerVersion('0.7.0', '0.6.9')).toBe(true)
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true)
  })

  it('accepts a leading v and ignores trailing zero components', () => {
    expect(isNewerVersion('v0.7.0', '0.6.0')).toBe(true)
    expect(isNewerVersion('0.6', '0.6.0')).toBe(false)
  })

  it('returns false for equal or older versions', () => {
    expect(isNewerVersion('0.6.0', '0.6.0')).toBe(false)
    expect(isNewerVersion('0.5.9', '0.6.0')).toBe(false)
    expect(isNewerVersion('0.6.0', '0.6.1')).toBe(false)
  })
})
