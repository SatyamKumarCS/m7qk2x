// Health ping on load (E-25): free hosting can sleep, so after 3 s of waiting the user is told
// the server is waking up; on failure they get a retry.

import { useEffect, useState } from 'react'
import type { HealthResponse } from '../api/types.ts'
import type { AsyncState } from '../hooks/useAsync.ts'

export const WAKE_NOTICE_MS = 3000

export function ServerStatus({
  health,
  onRetry,
}: {
  health: AsyncState<HealthResponse>
  onRetry: () => void
}) {
  const [slow, setSlow] = useState(false)
  const loading = health.status === 'loading'

  useEffect(() => {
    if (!loading) return
    const timer = setTimeout(() => setSlow(true), WAKE_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [loading])

  if (loading && slow) {
    return (
      <div className="banner banner--info" role="status" aria-live="polite">
        Waking up the server… Free hosting sleeps when idle, so the first load can take up to a
        minute.
      </div>
    )
  }
  if (health.status === 'error') {
    return (
      <div className="banner banner--error" role="alert">
        <span>Can’t reach the server: {health.error}</span>
        <button type="button" className="button button--small" onClick={onRetry}>
          Retry
        </button>
      </div>
    )
  }
  return null
}
