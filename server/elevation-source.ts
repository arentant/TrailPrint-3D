import { createHash } from 'node:crypto'
import { createGeotiffSampler, type GeotiffSampler } from '../electron/main/terrain/geotiff-sampler.js'

const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024
const CACHE_TTL_MS = 10 * 60_000

// Retain one raster per runtime. The hash scopes it to the bounds, dataset and
// API key without retaining the key as cache metadata. Failed loads are evicted.
let cached: { key: string; expiresAt: number; sampler: Promise<GeotiffSampler> } | undefined

export function clearElevationSamplerCache(): void { cached = undefined }

export async function loadElevationSampler(url: URL): Promise<GeotiffSampler> {
  const key = createHash('sha256').update(url.href).digest('hex')
  if (cached?.key === key && Date.now() < cached.expiresAt) return cached.sampler
  const entry = { key, expiresAt: Date.now() + CACHE_TTL_MS, sampler: fetchSampler(url) }
  cached = entry
  try {
    const sampler = await entry.sampler
    entry.expiresAt = Date.now() + CACHE_TTL_MS
    return sampler
  } catch (error) {
    if (cached === entry) cached = undefined
    throw error
  }
}

async function fetchSampler(url: URL): Promise<GeotiffSampler> {
  const response = await fetch(url, { signal: AbortSignal.timeout(230_000), redirect: 'error' })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(response.status === 401 || response.status === 403
      ? 'OpenTopography rejected the API key. Check the key and dataset access.'
      : response.status === 429 ? 'OpenTopography request limit reached. Try again later.'
      : `OpenTopography could not provide elevation data (${response.status}). Check your key or choose a smaller area.`)
  }
  if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) {
    await response.body?.cancel()
    throw new Error('Elevation data is too large. Select a smaller area.')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('OpenTopography returned no elevation data')
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_DOWNLOAD_BYTES) { await reader.cancel(); throw new Error('Elevation data is too large. Select a smaller area.') }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return createGeotiffSampler(bytes.buffer)
}
