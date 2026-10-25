// Global controls (PRD §6.3): delivery-date range, cutoff (presets or custom HH:MM) and an
// explanation of the cutoff rule. Invalid input is rejected with a message, never applied.

import { type FormEvent, useId, useState } from 'react'
import type { CutoffPreset } from '../constants.ts'
import type { FilterBounds, Filters } from '../hooks/useFilters.ts'
import { formatDate, isValidCutoff, isWithin } from '../utils/time.ts'

const CUSTOM = 'custom'

interface Props {
  filters: Filters
  bounds: FilterBounds
  presets: CutoffPreset[]
  onChange: (patch: Partial<Filters>) => void
}

export function ControlBar({ filters, bounds, presets, onChange }: Props) {
  const id = useId()
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [cutoffError, setCutoffError] = useState<string | null>(null)
  const [customChosen, setCustomChosen] = useState(false)
  const [draft, setDraft] = useState(filters.cutoff)
  const [showRule, setShowRule] = useState(false)

  const isPreset = presets.some((p) => p.value === filters.cutoff)
  const customMode = customChosen || !isPreset
  const scopeText = `${formatDate(bounds.start)} – ${formatDate(bounds.end)}`

  const changeRange = (field: 'start' | 'end', value: string) => {
    const next = { start: filters.start, end: filters.end, [field]: value }
    if (!isWithin(value, bounds.start, bounds.end)) {
      setRangeError(`Pick delivery days between ${scopeText}.`)
    } else if (next.start > next.end) {
      setRangeError('The start day must be on or before the end day.')
    } else {
      setRangeError(null)
      onChange({ [field]: value })
    }
  }

  const choosePreset = (value: string) => {
    setCutoffError(null)
    if (value === CUSTOM) {
      setCustomChosen(true)
      setDraft(filters.cutoff)
      return
    }
    setCustomChosen(false)
    onChange({ cutoff: value })
  }

  const applyCustom = (event: FormEvent) => {
    event.preventDefault()
    const value = draft.trim()
    if (!isValidCutoff(value)) {
      setCutoffError('Enter a UK time as HH:MM, from 00:00 to 23:59 (for example 09:20).')
      return
    }
    setCutoffError(null)
    onChange({ cutoff: value })
  }

  return (
    <section className="controls" aria-label="Filters">
      <fieldset className="controls__group">
        <legend>Delivery days</legend>
        <div className="controls__row">
          <label htmlFor={`${id}-start`}>From</label>
          <input
            id={`${id}-start`}
            type="date"
            min={bounds.start}
            max={filters.end}
            value={filters.start}
            onChange={(e) => changeRange('start', e.target.value)}
          />
          <label htmlFor={`${id}-end`}>to</label>
          <input
            id={`${id}-end`}
            type="date"
            min={filters.start}
            max={bounds.end}
            value={filters.end}
            onChange={(e) => changeRange('end', e.target.value)}
          />
        </div>
        <p className="controls__error" role="alert">
          {rangeError}
        </p>
      </fieldset>

      <fieldset className="controls__group">
        <legend>
          Decision cutoff <span className="muted">(UK time, day before delivery)</span>
        </legend>
        <div className="controls__row">
          <select
            aria-label="Cutoff preset"
            value={customMode ? CUSTOM : filters.cutoff}
            onChange={(e) => choosePreset(e.target.value)}
          >
            {presets.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label} {p.value}
              </option>
            ))}
            <option value={CUSTOM}>Custom…</option>
          </select>
          {customMode && (
            <form className="controls__custom" onSubmit={applyCustom} noValidate>
              <label htmlFor={`${id}-cutoff`} className="visually-hidden">
                Custom cutoff, HH:MM UK time
              </label>
              <input
                id={`${id}-cutoff`}
                inputMode="numeric"
                placeholder="HH:MM"
                maxLength={5}
                value={draft}
                aria-invalid={cutoffError ? true : undefined}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button type="submit" className="button button--small">
                Apply
              </button>
            </form>
          )}
          <button
            type="button"
            className="info-button"
            aria-expanded={showRule}
            aria-controls={`${id}-rule`}
            aria-label="How the cutoff works"
            onClick={() => setShowRule((s) => !s)}
          >
            i
          </button>
        </div>
        <p className="controls__error" role="alert">
          {cutoffError}
        </p>
        {showRule && (
          <p id={`${id}-rule`} className="controls__rule">
            For each delivery day we show the newest wind forecast published at or before the cutoff
            (UK time) on the day before, and never a later one. If none exists, the hour is left
            empty. EPEX GB closes at 09:20 and N2EX at 09:50.
          </p>
        )}
      </fieldset>

      <p className="controls__note">
        Applied: {formatDate(filters.start)} – {formatDate(filters.end)} · cutoff {filters.cutoff}{' '}
        UK time
      </p>
    </section>
  )
}
