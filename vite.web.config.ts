import { resolve } from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import elevation from './api/elevation'
import auth from './api/auth'
import type { IncomingMessage, ServerResponse } from 'node:http'

// The desktop geometry pipeline stays shared. Only these platform boundaries
// change for the browser worker; the Electron build keeps its original modules.
const aliases = [
  { find: /^\.\/dem-provider$/, replacement: resolve('src/browser/dem-provider.ts') },
  { find: /^\.\.\/gpx\/hydrate-gpx-config$/, replacement: resolve('src/browser/hydrate-gpx-config.ts') },
  { find: /^\.\/satellite-crop$/, replacement: resolve('src/browser/satellite-crop.ts') },
  { find: '@shared', replacement: resolve('shared') },
  { find: '@', replacement: resolve('src') },
]

function browserEntry(): Plugin {
  const api = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split('?')[0]
    const handler = path === '/api/elevation' ? elevation : path?.startsWith('/api/auth/') || path === '/api/auth' ? auth : null
    if (!handler) return next()
    void handler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ error: 'The request could not be completed.' }))
    })
  }
  return {
    name: 'trailprint-browser-entry',
    transformIndexHtml: { order: 'pre', handler: (html) => html.replace('/src/main.ts', '/src/browser/main.ts') },
    configureServer(server) { server.middlewares.use(api) },
    configurePreviewServer(server) { server.middlewares.use(api) },
  }
}

export default defineConfig(({ mode }) => {
  // These settings are used only by the local API handlers, never exposed as VITE_ variables.
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of ['AUTH_URL', 'AUTH_SECRET', 'AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET', 'ALLOWED_EMAILS']) {
    if (process.env[key] === undefined && env[key] !== undefined) process.env[key] = env[key]
  }
  return {
    plugins: [vue(), browserEntry()],
    resolve: { alias: aliases },
    // Never embed a development .env API key in the public browser bundle.
    define: { 'import.meta.env.VITE_OPENTOPOGRAPHY_API_KEY': '""' },
    worker: { format: 'es' },
    build: { outDir: 'dist', target: 'es2022' },
  }
})
