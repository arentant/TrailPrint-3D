import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import elevation from './api/elevation'

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
  return {
    name: 'trailprint-browser-entry',
    transformIndexHtml: { order: 'pre', handler: (html) => html.replace('/src/main.ts', '/src/browser/main.ts') },
    configureServer(server) { server.middlewares.use('/api/elevation', (req, res) => { void elevation(req, res) }) },
    configurePreviewServer(server) { server.middlewares.use('/api/elevation', (req, res) => { void elevation(req, res) }) },
  }
}

export default defineConfig({
  plugins: [vue(), browserEntry()],
  resolve: { alias: aliases },
  // Never embed a development .env API key in the public browser bundle.
  define: { 'import.meta.env.VITE_OPENTOPOGRAPHY_API_KEY': '""' },
  worker: { format: 'es' },
  build: { outDir: 'dist', target: 'es2022' },
})
