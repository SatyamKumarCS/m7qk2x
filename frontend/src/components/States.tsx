import type { ReactNode } from 'react'

/** Placeholder blocks shown while data loads (FR-3.13). */
export function LoadingState({
  label = 'Loading…',
  lines = 3,
}: {
  label?: string
  lines?: number
}) {
  return (
    <div className="state state--loading" role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </div>
  )
}

/** A failed load with a retry button (FR-3.13). */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state state--error" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

/** Nothing to show for the current selection (FR-3.13). */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state state--empty">
      <p className="state__title">{title}</p>
      {children}
    </div>
  )
}
