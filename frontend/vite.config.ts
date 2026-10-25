import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    port: 5173,
    strictPort: true,
    // With VITE_API_URL empty, the app calls /api on its own origin; forward that to FastAPI.
    proxy: { '/api': 'http://localhost:8000' },
  },
})
