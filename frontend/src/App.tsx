// App frame shared by every view: top bar with tabs, server status, global filters, the active
// page, the "About this data" panel and the footer. URL = state (spec §6).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api/client.ts'
import { AboutPanel } from './components/AboutPanel.tsx'
import { ControlBar } from './components/ControlBar.tsx'
import { Footer } from './components/Footer.tsx'
import { SettingsPanel } from './components/SettingsPanel.tsx'
import { ServerStatus } from './components/ServerStatus.tsx'
import { TopBar, type Tab } from './components/TopBar.tsx'
import { CUTOFF_PRESETS, DEFAULT_CUTOFF, SCOPE } from './constants.ts'
import { useAsync } from './hooks/useAsync.ts'
import { type FilterBounds, useFilters } from './hooks/useFilters.ts'
import { useSettings } from './hooks/useSettings.ts'
import { navigate, useLocation } from './hooks/useLocation.ts'
import { AccuracyPage } from './pages/AccuracyPage.tsx'
import { DecisionPage } from './pages/DecisionPage.tsx'
import { ExplorerPage } from './pages/ExplorerPage.tsx'

const TABS: Tab[] = [
  { path: '/', label: 'Decision', hint: 'Plan tomorrow’s wind' },
  { path: '/explorer', label: 'Forecast vs actual', hint: 'Explore any range' },
  { path: '/accuracy', label: 'Accuracy report', hint: 'How wrong, and when' },
]

export default function App() {
  const { pathname } = useLocation()
  const health = useAsync('health', api.health)
  const meta = useAsync('meta', api.meta)
  const [aboutOpen, setAboutOpen] = useState(false)
  const closeAbout = useCallback(() => setAboutOpen(false), [])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const display = useSettings()

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
      <TopBar
        tabs={TABS}
        activePath={pathname}
        cutoff={filters.cutoff}
        theme={display.theme}
        onToggleTheme={display.toggleTheme}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAbout={() => setAboutOpen(true)}
      />
      <div className="main-col">
        <ServerStatus health={health.state} onRetry={health.retry} />
        <ControlBar filters={filters} bounds={bounds} presets={presets} onChange={setFilters} />
        <main className="content">
          {pathname === '/explorer' ? (
            <ExplorerPage filters={filters} bounds={bounds} onChange={setFilters} />
          ) : pathname === '/accuracy' ? (
            <AccuracyPage filters={filters} meta={meta.state} onRetryMeta={meta.retry} />
          ) : (
            <DecisionPage filters={filters} bounds={bounds} onChange={setFilters} />
          )}
        </main>
        <Footer apiVersion={metaData?.version ?? null} />
      </div>
      {settingsOpen && (
        <SettingsPanel
          settings={display.settings}
          onChange={display.update}
          onReset={display.reset}
          onClose={closeSettings}
        />
      )}
      {aboutOpen && <AboutPanel meta={meta.state} onRetry={meta.retry} onClose={closeAbout} />}
    </div>
  )
}
