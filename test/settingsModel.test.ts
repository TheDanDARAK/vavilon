import { describe, expect, it } from 'vitest'
import type { LauncherSettings } from '../src/main/saves/settingsModel'
import { normalizeSettings, SETTINGS_DEFAULTS } from '../src/main/saves/settingsModel'

describe('normalizeSettings', () => {
  it('keeps valid settings intact', () => {
    const input: LauncherSettings = {
      general: {
        startWithWindows: true,
        closeToTray: true,
        confirmDelete: false,
        autoUpdateCheck: true
      },
      achievements: { notifications: false, toasts: false, pollIntervalMs: 10000 },
      saves: { enabled: true, ludusaviPath: 'C:\\tools\\ludusavi.exe', backupPath: 'D:\\saves' },
      store: { rawgApiKey: 'abc123', steamGridDbApiKey: 'sgdb' }
    }
    expect(normalizeSettings(input)).toEqual(input)
  })

  it('replaces invalid booleans with defaults', () => {
    const input = {
      general: { startWithWindows: 'yes', closeToTray: 1, confirmDelete: null },
      achievements: { notifications: 'true', toasts: 0, pollIntervalMs: 4000 },
      saves: { enabled: 'on', ludusaviPath: '', backupPath: '' },
      store: { rawgApiKey: '' }
    } as unknown as LauncherSettings

    const result = normalizeSettings(input)
    expect(result.general).toEqual(SETTINGS_DEFAULTS.general)
    expect(result.achievements.notifications).toBe(true)
    expect(result.achievements.toasts).toBe(true)
    expect(result.saves.enabled).toBe(false)
  })

  it('clamps the poll interval to 1..60 seconds and rounds it', () => {
    const base = structuredClone(SETTINGS_DEFAULTS)
    const poll = (value: unknown): number =>
      normalizeSettings({
        ...base,
        achievements: { ...base.achievements, pollIntervalMs: value as number }
      }).achievements.pollIntervalMs

    expect(poll(0)).toBe(4000)
    expect(poll(999)).toBe(4000)
    expect(poll(1000)).toBe(1000)
    expect(poll(2500.6)).toBe(2501)
    expect(poll(60000)).toBe(60000)
    expect(poll(60001)).toBe(4000)
    expect(poll('abc')).toBe(4000)
  })

  it('trims strings and tolerates wholly missing sections', () => {
    const partial = normalizeSettings({} as LauncherSettings)
    expect(partial).toEqual(SETTINGS_DEFAULTS)

    const spaced = structuredClone(SETTINGS_DEFAULTS)
    spaced.saves.ludusaviPath = '  C:\\ludusavi.exe  '
    spaced.saves.backupPath = ' D:\\saves '
    spaced.store.rawgApiKey = ' key '
    const result = normalizeSettings(spaced)
    expect(result.saves.ludusaviPath).toBe('C:\\ludusavi.exe')
    expect(result.saves.backupPath).toBe('D:\\saves')
    expect(result.store.rawgApiKey).toBe('key')
  })
})
