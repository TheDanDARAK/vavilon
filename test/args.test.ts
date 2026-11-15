import { describe, expect, it } from 'vitest'
import { formatArgs, parseArgs } from '../src/shared/args'

describe('parseArgs', () => {
  it('splits plain arguments on whitespace', () => {
    expect(parseArgs('--windowed   -novid\t-skipintro')).toEqual([
      '--windowed',
      '-novid',
      '-skipintro'
    ])
  })

  it('keeps quoted paths with spaces as one argument', () => {
    expect(parseArgs('--path="C:\\Program Files\\Game" -lang ru')).toEqual([
      '--path=C:\\Program Files\\Game',
      '-lang',
      'ru'
    ])
  })

  it('supports quoted arguments and empty quoted values', () => {
    expect(parseArgs('"" "hello world"')).toEqual(['', 'hello world'])
  })

  it('preserves UNC paths and trailing backslashes', () => {
    expect(parseArgs('"\\\\server\\share\\game.exe" C:\\path\\')).toEqual([
      '\\\\server\\share\\game.exe',
      'C:\\path\\'
    ])
  })

  it('decodes an escaped literal quote', () => {
    expect(parseArgs('"say \\"hi\\""')).toEqual(['say "hi"'])
  })
})

describe('formatArgs', () => {
  it('leaves simple arguments untouched', () => {
    expect(formatArgs(['--windowed', '-novid'])).toBe('--windowed -novid')
  })

  it('quotes paths with spaces', () => {
    expect(formatArgs(['--path=C:\\Program Files\\Game'])).toBe(
      '"--path=C:\\Program Files\\Game"'
    )
  })

  it('round-trips values with spaces, quotes and trailing backslashes', () => {
    const input = ['--path=C:\\Program Files\\Game', 'say "hi"', 'C:\\trailing\\', '']
    expect(parseArgs(formatArgs(input))).toEqual(input)
  })
})
