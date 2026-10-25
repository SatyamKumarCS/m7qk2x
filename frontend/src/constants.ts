// Fallbacks that mirror backend/app/config.py. `/api/meta` is authoritative once it loads;
// these only keep the controls usable (and bounded) before that or if it fails.

export interface CutoffPreset {
  label: string
  value: string
}

export const SCOPE = { start: '2026-01-02', end: '2026-02-01' } as const

export const DEFAULT_CUTOFF = '09:20'

export const CUTOFF_PRESETS: CutoffPreset[] = [
  { label: 'EPEX GB', value: '09:20' },
  { label: 'N2EX', value: '09:50' },
  { label: 'Early', value: '06:00' },
]

export const BAND_LEVELS = [80, 90] as const
export type BandLevel = (typeof BAND_LEVELS)[number]
export const DEFAULT_BAND: BandLevel = 80

export const UK_TIME_ZONE = 'Europe/London'

export const APP_VERSION = __APP_VERSION__
export const REPO_URL = 'https://github.com/SatyamKumarCS/m7qk2x'

export const DATA_SCOPE_NOTE =
  'Operationally metered GB wind only (about 82% of GB wind); embedded generation is excluded.'

export const ELEXON_SOURCES = [
  {
    short: 'FUELHH',
    name: 'Elexon BMRS – FUELHH (actual generation by fuel type)',
    url: 'https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream',
  },
  {
    short: 'WINDFOR',
    name: 'Elexon BMRS – WINDFOR (wind generation forecast)',
    url: 'https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream',
  },
]
