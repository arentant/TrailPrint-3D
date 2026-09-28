import type { MapCropConfig } from '@shared/types/config'
import type { DemFetchOptions } from '@shared/types/dem'
import type { TerrainCropRegion } from '@shared/types/terrain'
import type { DemGrid } from '../../electron/main/terrain/dem-provider'
import { IpcException } from '@shared/ipc/types'

let cached: { key: string; values: Float64Array } | undefined

export async function sampleDemGrid(crop: TerrainCropRegion, cols: number, rows: number, mapCrop: MapCropConfig, viewportWidth: number, viewportHeight: number, options: DemFetchOptions & { fetchTimeoutMs?: number }): Promise<DemGrid> {
  const apiKey = options.openTopographyApiKey.trim()
  if (!apiKey) throw new Error('Enter your OpenTopography API key at the top of the sidebar')
  const request = { crop, cols, rows, mapCrop, viewportWidth, viewportHeight, dataset: options.dataset, apiKey }
  const key = JSON.stringify(request)
  if (cached?.key === key) return { cols, rows, elevations: cached.values.slice(), source: 'opentopography' }
  const response = await fetch('/api/elevation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: key,
    signal: AbortSignal.timeout(250_000),
  })
  if (!response.ok) {
    if (response.status === 401) throw new IpcException('UNAUTHENTICATED', 'Your session has ended. Sign in again to continue.')
    const error = await response.json().catch(() => null)
    throw new Error(error?.error ?? `Elevation request failed (${response.status}). Try a smaller area.`)
  }
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength !== cols * rows * 4) throw new Error('The elevation response is incomplete. Try again.')
  const view = new DataView(buffer)
  const values = new Float64Array(cols * rows)
  let valid = 0
  for (let i = 0; i < values.length; i++) {
    values[i] = view.getFloat32(i * 4, true)
    if (Number.isFinite(values[i])) valid++
  }
  if (!valid) throw new Error('No elevation data was found. Choose another area or DEM source.')
  cached = { key, values }
  return { cols, rows, elevations: values.slice(), source: 'opentopography' }
}
