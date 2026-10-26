import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, parseSettings, resolveTheme } from './useSettings.ts'

describe('parseSettings', () => {
  it('returns defaults for missing, malformed or non-object input', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('{oops')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('42')).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid values and replaces unknown ones one field at a time', () => {
    const raw = JSON.stringify({ theme: 'dark', density: 'huge', motion: 'reduced' })
    expect(parseSettings(raw)).toEqual({ theme: 'dark', density: 'comfortable', motion: 'reduced' })
  })
})

describe('resolveTheme', () => {
  it('follows the system only for the system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})
