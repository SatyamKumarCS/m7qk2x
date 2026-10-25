// Loading / error / success state for one request, with retry. A new `key` (or a retry)
// starts a fresh request and aborts the previous one.

import { useCallback, useEffect, useEffectEvent, useState } from 'react'

export type AsyncState<T> =
  { status: 'loading' } | { status: 'error'; error: string } | { status: 'success'; data: T }

export function useAsync<T>(key: string, load: (signal: AbortSignal) => Promise<T>) {
  const [attempt, setAttempt] = useState(0)
  const requestKey = `${key}#${attempt}`
  const [settled, setSettled] = useState<{ key: string; state: AsyncState<T> } | null>(null)
  const run = useEffectEvent((signal: AbortSignal) => load(signal))

  useEffect(() => {
    const controller = new AbortController()
    run(controller.signal).then(
      (data) => setSettled({ key: requestKey, state: { status: 'success', data } }),
      (err: unknown) => {
        if (controller.signal.aborted) return
        const error = err instanceof Error ? err.message : 'Something went wrong.'
        setSettled({ key: requestKey, state: { status: 'error', error } })
      },
    )
    return () => controller.abort()
  }, [requestKey])

  const state: AsyncState<T> = settled?.key === requestKey ? settled.state : { status: 'loading' }
  const retry = useCallback(() => setAttempt((a) => a + 1), [])
  return { state, retry }
}
