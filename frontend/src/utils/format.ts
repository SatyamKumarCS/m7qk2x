// Every number shown to the user carries its unit (FR-3.15). Missing values render as an en dash.

export const MISSING = '–'

type Maybe = number | null | undefined

const isNumber = (v: Maybe): v is number => typeof v === 'number' && Number.isFinite(v)

function fixed(value: number, digits: number): string {
  return value.toLocaleString('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** Power: GW to 1 dp from 1,000 MW up, otherwise whole MW. "12.3 GW", "845 MW". */
export function formatPower(mw: Maybe): string {
  if (!isNumber(mw)) return MISSING
  return Math.abs(mw) >= 1000 ? `${fixed(mw / 1000, 1)} GW` : `${fixed(mw, 0)} MW`
}

/** Signed power for bias and errors: "+1.7 GW", "−420 MW". */
export function formatSignedPower(mw: Maybe): string {
  if (!isNumber(mw)) return MISSING
  const sign = mw > 0 ? '+' : mw < 0 ? '−' : ''
  return sign + formatPower(Math.abs(mw))
}

/** Energy: GWh to 1 dp from 1,000 MWh up, otherwise whole MWh. */
export function formatEnergy(mwh: Maybe): string {
  if (!isNumber(mwh)) return MISSING
  return Math.abs(mwh) >= 1000 ? `${fixed(mwh / 1000, 1)} GWh` : `${fixed(mwh, 0)} MWh`
}

/** Hours ahead: "16.5 h". */
export function formatHours(hours: Maybe): string {
  return isNumber(hours) ? `${fixed(hours, 1)} h` : MISSING
}

/** A 0–1 share as a percentage: 0.784 → "78.4 %". */
export function formatShare(fraction: Maybe, digits = 1): string {
  return isNumber(fraction) ? `${fixed(fraction * 100, digits)} %` : MISSING
}

/** A value that is already a percentage (e.g. nMAE, WAPE): 17.9 → "17.9 %". */
export function formatPercent(percent: Maybe, digits = 1): string {
  return isNumber(percent) ? `${fixed(percent, digits)} %` : MISSING
}

/** Plain counts with thousands separators: 15775 → "15,775". */
export function formatCount(n: Maybe): string {
  return isNumber(n) ? fixed(n, 0) : MISSING
}
