import type { MapCropConfig } from '@shared/types/config'
import type { DemFetchOptions } from '@shared/types/dem'
import type { TerrainCropRegion } from '@shared/types/terrain'
import type { DemGrid } from '../../electron/main/terrain/dem-provider'
import { IpcException } from '@shared/ipc/types'
import { MAX_ELEVATION_RESPONSE_SAMPLES } from '@shared/types/elevation'

let cached: { key: string; values: Float64Array } | undefined

export async function sampleDemGrid(crop: TerrainCropRegion, cols: number, rows: number, mapCrop: MapCropConfig, viewportWidth: number, viewportHeight: number, options: DemFetchOptions & { fetchTimeoutMs?: number }): Promise<DemGrid> {
  const apiKey = options.openTopographyApiKey.trim()
  if (!apiKey) throw new Error('Enter your OpenTopography API key at the top of the sidebar')
  const request = { crop, cols, rows, mapCrop, viewportWidth, viewportHeight, dataset: options.dataset, apiKey }
  const key = JSON.stringify(request)
  if (cached?.key === key) return { cols, rows, elevations: cached.values.slice(), source: 'opentopography' }
  const values = new Float64Array(cols * rows)
  let valid = 0
  const chunkRows = Math.max(1, Math.floor(MAX_ELEVATION_RESPONSE_SAMPLES / cols))
  for (let rowStart = 0; rowStart < rows; rowStart += chunkRows) {
    const rowCount = Math.min(chunkRows, rows - rowStart)
    const body = cols * rows > MAX_ELEVATION_RESPONSE_SAMPLES
      ? JSON.stringify({ ...request, sampleWindow: { rowStart, rowCount } }) : key
    const response = await fetch('/api/elevation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(250_000),
    })
    if (!response.ok) {
      if (response.status === 401) throw new IpcException('UNAUTHENTICATED', 'Your session has ended. Sign in again to continue.')
      const error = await response.json().catch(() => null)
      throw new Error(error?.error ?? `Elevation request failed (${response.status}). Try a smaller area.`)
    }
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength !== cols * rowCount * 4) throw new Error('The elevation response is incomplete. Try again.')
    const view = new DataView(buffer)
    const offset = rowStart * cols
    for (let i = 0; i < cols * rowCount; i++) {
      values[offset + i] = view.getFloat32(i * 4, true)
      if (Number.isFinite(values[offset + i])) valid++
    }
  }
  if (!valid) throw new Error('No elevation data was found. Choose another area or DEM source.')
  cached = { key, values }
  return { cols, rows, elevations: values.slice(), source: 'opentopography' }
}
