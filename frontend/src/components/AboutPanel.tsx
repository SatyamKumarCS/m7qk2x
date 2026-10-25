// "About this data" (NFR transparency): scope of the data, the cutoff rule, assumptions and
// data quality from /api/meta, and sources.

import { useEffect, useRef } from 'react'
import type { MetaResponse } from '../api/types.ts'
import { DATA_SCOPE_NOTE, ELEXON_SOURCES } from '../constants.ts'
import type { AsyncState } from '../hooks/useAsync.ts'
import { formatCount, formatHours } from '../utils/format.ts'
import { EmptyState, ErrorState, LoadingState } from './States.tsx'

interface Props {
  meta: AsyncState<MetaResponse>
  onRetry: () => void
  onClose: () => void
}

export function AboutPanel({ meta, onRetry, onClose }: Props) {
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
        aria-labelledby="about-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel__head">
          <h2 id="about-title">About this data</h2>
          <button ref={closeRef} type="button" className="button button--ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <p>{DATA_SCOPE_NOTE}</p>
        <p>
          The forecast for each delivery day is the newest one published at or before the chosen
          cutoff, in UK time, on the day before. Later forecasts are never used. All times are UK
          time.
        </p>

        <h3>Assumptions</h3>
        {meta.status === 'loading' && <LoadingState label="Loading assumptions…" />}
        {meta.status === 'error' && <ErrorState message={meta.error} onRetry={onRetry} />}
        {meta.status === 'success' &&
          (meta.data.assumptions.length ? (
            <ul>
              {meta.data.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No assumptions listed." />
          ))}

        {meta.status === 'success' && <Quality meta={meta.data} />}

        <h3>Sources</h3>
        <ul>
          {(meta.status === 'success' && meta.data.sources.length
            ? meta.data.sources
            : ELEXON_SOURCES
          ).map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.name}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function Quality({ meta }: { meta: MetaResponse }) {
  const { actuals, forecasts } = meta.quality
  return (
    <>
      <h3>Data quality</h3>
      <ul>
        <li>
          Actuals: {formatCount(actuals.rows)} of {formatCount(actuals.expected)} half-hours present
          ({formatCount(actuals.missingSlots.length)} missing).
        </li>
        <li>
          Forecasts: {formatCount(forecasts.rows)} hourly values from {formatCount(forecasts.runs)}{' '}
          runs; {formatCount(forecasts.droppedPublishedAfterTarget)} values for hours that had
          already started were excluded.
        </li>
        <li>
          Forecast horizons: {formatHours(forecasts.horizonRangeH[0])} to{' '}
          {formatHours(forecasts.horizonRangeH[1])} ahead.
        </li>
      </ul>
    </>
  )
}
