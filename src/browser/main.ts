import { createBrowserApi } from './client'

window.trailPrint = createBrowserApi()
await import('../main')
