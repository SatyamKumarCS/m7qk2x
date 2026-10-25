interface ImportMetaEnv {
  /** Backend origin, e.g. https://api.example.com. Empty = same origin (dev proxy to :8000). */
  readonly VITE_API_URL?: string
  /** "1" serves /api/health and /api/meta from local fixtures (until the Backend API exists). */
  readonly VITE_API_MOCK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** package.json version, injected by vite.config.ts. */
declare const __APP_VERSION__: string
