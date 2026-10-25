// Single delivery-day picker with previous/next arrows that stop at the scope edges (FR-3.1).

import { useId, useState } from 'react'
import { addDays, formatDate, isWithin } from '../utils/time.ts'

interface Props {
  value: string
  min: string
  max: string
  onChange: (date: string) => void
}

export function DayPicker({ value, min, max, onChange }: Props) {
  const id = useId()
  const [error, setError] = useState<string | null>(null)

  const go = (date: string) => {
    if (!isWithin(date, min, max)) {
      setError(`Pick a delivery day between ${formatDate(min)} and ${formatDate(max)}.`)
      return
    }
    setError(null)
    onChange(date)
  }

  return (
    <div className="day-picker">
      <button
        type="button"
        className="button button--ghost"
        onClick={() => go(addDays(value, -1))}
        disabled={value <= min}
        aria-label="Previous delivery day"
      >
        ‹ Prev
      </button>
      <label htmlFor={id} className="visually-hidden">
        Delivery day
      </label>
      <input
        id={id}
        type="date"
        min={min}
        max={max}
        value={value}
        onChange={(e) => go(e.target.value)}
      />
      <button
        type="button"
        className="button button--ghost"
        onClick={() => go(addDays(value, 1))}
        disabled={value >= max}
        aria-label="Next delivery day"
      >
        Next ›
      </button>
      <p className="controls__error" role="alert">
        {error}
      </p>
    </div>
  )
}
