import { describe, expect, it } from 'vitest'
import {
  addDays,
  daysInclusive,
  formatDate,
  formatUkDateTime,
  formatUkTime,
  isIsoDate,
  isValidCutoff,
  isWithin,
  ukDateOf,
} from './time.ts'

describe('test environment', () => {
  it('runs in Asia/Kolkata (UTC+5:30), so these tests prove there is no local-zone shift', () => {
    expect(new Date('2026-01-15T00:00:00Z').getTimezoneOffset()).toBe(-330)
  })
})

describe('calendar dates stay YYYY-MM-DD strings (E-19)', () => {
  it('validates real calendar dates only', () => {
    expect(isIsoDate('2026-01-15')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-1-5')).toBe(false)
    expect(isIsoDate('')).toBe(false)
  })

  it('adds days across month, year and UK clock-change boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29') // BST starts 29 Mar
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30')
  })

  it('counts days inclusively', () => {
    expect(daysInclusive('2026-01-02', '2026-02-01')).toBe(31)
    expect(daysInclusive('2026-01-15', '2026-01-15')).toBe(1)
  })

  it('checks scope bounds inclusively', () => {
    expect(isWithin('2026-01-02', '2026-01-02', '2026-02-01')).toBe(true)
    expect(isWithin('2026-02-01', '2026-01-02', '2026-02-01')).toBe(true)
    expect(isWithin('2026-01-01', '2026-01-02', '2026-02-01')).toBe(false)
    expect(isWithin('2026-02-30', '2026-01-02', '2026-03-31')).toBe(false)
  })

  it('formats a calendar date without shifting it in IST', () => {
    expect(formatDate('2026-01-15')).toMatch(/^Thu,? 15 Jan 2026$/)
    expect(formatDate('2026-02-01')).toMatch(/^Sun,? 1 Feb 2026$/)
  })
})

describe('instants are shown in UK time (FR-3.14)', () => {
  it('uses GMT in January and BST in summer, regardless of the browser zone', () => {
    expect(formatUkTime('2026-01-15T07:30:00Z')).toBe('07:30')
    expect(formatUkTime('2026-04-15T07:30:00Z')).toBe('08:30')
    expect(formatUkDateTime('2026-01-14T07:30:00Z')).toMatch(/^Wed,? 14 Jan,? 07:30$/)
  })

  it('finds the UK delivery day of an instant', () => {
    expect(ukDateOf('2026-01-15T23:30:00Z')).toBe('2026-01-15') // IST would say the 16th
    expect(ukDateOf('2026-04-15T23:30:00Z')).toBe('2026-04-16') // 00:30 BST
  })
})

describe('cutoff validation', () => {
  it.each(['09:20', '00:00', '23:59'])('accepts %s', (v) => expect(isValidCutoff(v)).toBe(true))
  it.each(['25:00', '9:20', '09:60', '0920', '', '09:20 '])('rejects %j', (v) =>
    expect(isValidCutoff(v)).toBe(false),
  )
})
