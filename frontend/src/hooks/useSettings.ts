// Display settings (theme, density, motion), kept in localStorage and applied as data attributes
// on <html>. Pure helpers are exported for tests; storage and matchMedia are always guarded
// because either can be missing or blocked (private windows, jsdom).

import { useCallback, useEffect, useState } from 'react'

export type ThemePref = 'light' | 'dark' | 'system'
export type Density = 'comfortable' | 'compact'
export type Motion = 'full' | 'reduced'

export interface Settings {
  theme: ThemePref
  density: Density
  motion: Motion
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  density: 'comfortable',
  motion: 'full',
}
export const STORAGE_KEY = 'wfm-settings'

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

/** Reads stored JSON defensively: anything unknown or malformed falls back to the default. */
export function parseSettings(raw: string | null): Settings {
  let data: Partial<Record<keyof Settings, unknown>> = {}
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (parsed && typeof parsed === 'object') data = parsed
  } catch {
    // keep defaults
  }
  return {
    theme: oneOf(data.theme, ['light', 'dark', 'system'], DEFAULT_SETTINGS.theme),
    density: oneOf(data.density, ['comfortable', 'compact'], DEFAULT_SETTINGS.density),
    motion: oneOf(data.motion, ['full', 'reduced'], DEFAULT_SETTINGS.motion),
  }
}

export const resolveTheme = (pref: ThemePref, systemDark: boolean): 'light' | 'dark' =>
  pref === 'system' ? (systemDark ? 'dark' : 'light') : pref

const prefersDark = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches

function load(): Settings {
  try {
    return parseSettings(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load)
  const [systemDark, setSystemDark] = useState(prefersDark)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const theme = resolveTheme(settings.theme, systemDark)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.dataset.density = settings.density
    root.dataset.motion = settings.motion
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // storage unavailable: the settings still apply for this visit
    }
  }, [theme, settings])

  const update = useCallback(
    (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })),
    [],
  )
  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), [])
  const toggleTheme = useCallback(
    () =>
      setSettings((s) => ({
        ...s,
        theme: resolveTheme(s.theme, prefersDark()) === 'dark' ? 'light' : 'dark',
      })),
    [],
  )

  return { settings, theme, update, reset, toggleTheme }
}
