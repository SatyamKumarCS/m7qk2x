// A tiny History-API router: the spec has only three routes, so no router library is needed.
// Components re-render when the path or query string changes (navigation, back/forward).

import { useSyncExternalStore } from 'react'

const CHANGE = 'wfm:locationchange'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange)
  window.addEventListener(CHANGE, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(CHANGE, onChange)
  }
}

const snapshot = () => window.location.pathname + window.location.search

export interface Location {
  pathname: string
  search: string
}

export function useLocation(): Location {
  const href = useSyncExternalStore(subscribe, snapshot)
  const i = href.indexOf('?')
  return i < 0
    ? { pathname: href, search: '' }
    : { pathname: href.slice(0, i), search: href.slice(i) }
}

/** Go to `pathname` with `search` (default: keep the current query, so filters survive tabs). */
export function navigate(
  pathname: string,
  search: string = window.location.search,
  { replace = false }: { replace?: boolean } = {},
): void {
  const url = pathname + search
  if (url === snapshot()) return
  if (replace) window.history.replaceState(null, '', url)
  else window.history.pushState(null, '', url)
  window.dispatchEvent(new Event(CHANGE))
}
