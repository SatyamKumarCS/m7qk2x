// Calendar dates are `YYYY-MM-DD` strings and are never turned into local-time Date objects,
// so a browser in any time zone (e.g. IST) cannot shift them (ADR 0005, E-19). Instants are
// ISO-8601 UTC strings and are always displayed in UK time.

import { UK_TIME_ZONE } from '../constants.ts'

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
export const CUTOFF_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30). */
export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toISOString().slice(0, 10) === value
}

/** Shift a YYYY-MM-DD date by whole days using UTC arithmetic (no DST, no local zone). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Inclusive number of days from `start` to `end` (1 when equal). */
export function daysInclusive(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 864e5) + 1
}

export function isWithin(date: string, min: string, max: string): boolean {
  return isIsoDate(date) && date >= min && date <= max // ISO strings sort chronologically
}

/** "HH:MM", 00:00–23:59, zero-padded (same rule as the API). */
export function isValidCutoff(value: string): boolean {
  return CUTOFF_PATTERN.test(value)
}

const ukTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const ukDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK_TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const calendarDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', // a calendar date is anchored at UTC midnight, so format it in UTC
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const ukDay = new Intl.DateTimeFormat('en-CA', { timeZone: UK_TIME_ZONE }) // en-CA → YYYY-MM-DD

/** "09:30": the UK clock time of a UTC instant. */
export function formatUkTime(isoUtc: string): string {
  return ukTime.format(new Date(isoUtc))
}

/** "Wed 14 Jan, 07:30": UK date and clock time of a UTC instant. */
export function formatUkDateTime(isoUtc: string): string {
  return ukDateTime.format(new Date(isoUtc))
}

/** "Thu 15 Jan 2026" for a YYYY-MM-DD calendar date. */
export function formatDate(date: string): string {
  return calendarDate.format(new Date(`${date}T00:00:00Z`))
}

/** The UK calendar date (YYYY-MM-DD) of a UTC instant, e.g. its delivery day. */
export function ukDateOf(isoUtc: string): string {
  return ukDay.format(new Date(isoUtc))
}
