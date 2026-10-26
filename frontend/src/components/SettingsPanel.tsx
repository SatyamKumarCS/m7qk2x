// Display settings drawer: theme, density and motion. Changes apply immediately and are saved in
// this browser only; they never change the data or the filters.

import { useEffect, useRef } from 'react'
import type { Settings } from '../hooks/useSettings.ts'

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onReset: () => void
  onClose: () => void
}

interface Choice<T extends string> {
  value: T
  label: string
  hint: string
}

const THEMES: Choice<Settings['theme']>[] = [
  { value: 'light', label: 'Light', hint: 'Bright, paper-like' },
  { value: 'dark', label: 'Dark', hint: 'Easy on the eyes' },
  { value: 'system', label: 'System', hint: 'Match your device' },
]
const DENSITIES: Choice<Settings['density']>[] = [
  { value: 'comfortable', label: 'Comfortable', hint: 'Roomy cards and tables' },
  { value: 'compact', label: 'Compact', hint: 'More on screen at once' },
]
const MOTIONS: Choice<Settings['motion']>[] = [
  { value: 'full', label: 'Full', hint: 'Fades, lifts and the turning logo' },
  { value: 'reduced', label: 'Reduced', hint: 'No animation' },
]

function Group<T extends string>({
  title,
  value,
  choices,
  onPick,
}: {
  title: string
  value: T
  choices: Choice<T>[]
  onPick: (value: T) => void
}) {
  return (
    <section className="setting" aria-label={title}>
      <h3>{title}</h3>
      <div className="setting__choices" role="group" aria-label={title}>
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            className="setting__choice"
            aria-pressed={c.value === value}
            onClick={() => onPick(c.value)}
          >
            <span className="setting__label">{c.label}</span>
            <span className="setting__hint">{c.hint}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export function SettingsPanel({ settings, onChange, onReset, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel__head">
          <h2 id="settings-title">Settings</h2>
          <button ref={closeRef} type="button" className="button button--ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted">Display options only. They are saved in this browser.</p>

        <Group
          title="Theme"
          value={settings.theme}
          choices={THEMES}
          onPick={(theme) => onChange({ theme })}
        />
        <Group
          title="Density"
          value={settings.density}
          choices={DENSITIES}
          onPick={(density) => onChange({ density })}
        />
        <Group
          title="Motion"
          value={settings.motion}
          choices={MOTIONS}
          onPick={(motion) => onChange({ motion })}
        />

        <button type="button" className="button button--ghost" onClick={onReset}>
          Reset to defaults
        </button>
      </div>
    </div>
  )
}
