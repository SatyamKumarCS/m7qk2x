// App frame shared by every view: top bar with tabs, server status, global filters, the active
// page, the "About this data" panel and the footer. URL = state (spec §6).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api/client.ts'
import { AboutPanel } from './components/AboutPanel.tsx'
import { ControlBar } from './components/ControlBar.tsx'
import { Footer } from './components/Footer.tsx'
import { ServerStatus } from './components/ServerStatus.tsx'
import { TopBar, type Tab } from './components/TopBar.tsx'
import { CUTOFF_PRESETS, DEFAULT_CUTOFF, SCOPE } from './constants.ts'
import { useAsync } from './hooks/useAsync.ts'
import { type FilterBounds, useFilters } from './hooks/useFilters.ts'
import { navigate, useLocation } from './hooks/useLocation.ts'
import { AccuracyPage, DecisionPage, ExplorerPage } from './pages/Placeholders.tsx'

const TABS: Tab[] = [
  { path: '/', label: 'Decision' },
  { path: '/explorer', label: 'Forecast vs actual' },
  { path: '/accuracy', label: 'Accuracy report' },
]

export default function App() {
  const { pathname } = useLocation()
  const health = useAsync('health', api.health)
  const meta = useAsync('meta', api.meta)
  const [aboutOpen, setAboutOpen] = useState(false)
  const closeAbout = useCallback(() => setAboutOpen(false), [])

  const metaData = meta.state.status === 'success' ? meta.state.data : null
  const bounds: FilterBounds = useMemo(
    () => ({
      start: metaData?.scope.deliveryStart ?? SCOPE.start,
      end: metaData?.scope.deliveryEnd ?? SCOPE.end,
      defaultCutoff: metaData?.defaultCutoff ?? DEFAULT_CUTOFF,
    }),
    [metaData],
  )
  const presets = metaData?.cutoffPresets.length ? metaData.cutoffPresets : CUTOFF_PRESETS
  const { filters, setFilters, canonical, isCanonical } = useFilters(bounds)
  const knownPath = TABS.some((t) => t.path === pathname)

  // Unknown paths go to the Decision view; invalid or missing params become the canonical URL.
  useEffect(() => {
    if (!knownPath) navigate('/', canonical, { replace: true })
    else if (!isCanonical) navigate(pathname, canonical, { replace: true })
  }, [knownPath, isCanonical, pathname, canonical])

  return (
    <div className="app">
      <TopBar tabs={TABS} activePath={pathname} onOpenAbout={() => setAboutOpen(true)} />
      <ServerStatus health={health.state} onRetry={health.retry} />
      <ControlBar filters={filters} bounds={bounds} presets={presets} onChange={setFilters} />
      <main className="content">
        {pathname === '/explorer' ? (
          <ExplorerPage filters={filters} />
        ) : pathname === '/accuracy' ? (
          <AccuracyPage filters={filters} />
        ) : (
          <DecisionPage filters={filters} />
        )}
      </main>
      <Footer apiVersion={metaData?.version ?? null} />
      {aboutOpen && <AboutPanel meta={meta.state} onRetry={meta.retry} onClose={closeAbout} />}
    </div>
  )
}
