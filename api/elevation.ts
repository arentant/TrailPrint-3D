import type { IncomingMessage, ServerResponse } from 'node:http'
import { gzipSync } from 'node:zlib'
import type { MapCropConfig } from '../shared/types/config.js'
import type { TerrainCropRegion } from '../shared/types/terrain.js'
import { MAX_ELEVATION_RESPONSE_SAMPLES, type ElevationSampleWindow } from '../shared/types/elevation.js'
import { OPEN_TOPO_DEM_OPTIONS } from '../shared/types/dem.js'
import { heightfieldSampleGeo } from '../shared/utils/map-mm-projection.js'
import { loadElevationSampler } from '../server/elevation-source.js'
import { requireSession } from '../server/auth.js'

const MAX_BODY_BYTES = 16 * 1024

export const config = { maxDuration: 300 }

function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function validate(body: any): void {
  if (!body || typeof body.apiKey !== 'string' || !body.apiKey.trim() || body.apiKey.length > 256) throw new Error('Enter a valid OpenTopography API key')
  if (!OPEN_TOPO_DEM_OPTIONS.some((option) => option.value === body.dataset)) throw new Error('Choose a supported elevation dataset')
  if (![body.cols, body.rows].every((n) => Number.isInteger(n) && n >= 2 && n <= 1536)) throw new Error('Invalid elevation grid size')
  const window = body.sampleWindow
  if (window !== undefined && (!window || !Number.isInteger(window.rowStart) || !Number.isInteger(window.rowCount) ||
    window.rowStart < 0 || window.rowCount < 1 || window.rowStart + window.rowCount > body.rows)) {
    throw new Error('Invalid elevation sample window')
  }
  if (body.cols * (window?.rowCount ?? body.rows) > MAX_ELEVATION_RESPONSE_SAMPLES) {
    throw new Error('The elevation grid needs smaller row chunks')
  }
  if (![body.viewportWidth, body.viewportHeight].every((n) => finite(n, 64, 16384))) throw new Error('Invalid map viewport')
  const c = body.crop
  const m = body.mapCrop
  if (!c || !m || !['circle', 'rectangle', 'polygon'].includes(m.shape)) throw new Error('Invalid map crop')
  if (![c.minLat, c.maxLat, m.mapCenterLat].every((n) => finite(n, -85, 85)) ||
      ![c.minLon, c.maxLon, m.mapCenterLon].every((n) => finite(n, -180, 180)) ||
      c.minLat >= c.maxLat || c.minLon >= c.maxLon ||
      !finite(m.mapZoom, 1, 22) || !finite(m.mapBearingDeg ?? 0, -360, 360) ||
      ![c.widthMm, c.heightMm, m.radiusMm, m.lengthMm, m.widthMm, m.polygonSideLengthMm].every((n) => finite(n, 1, 2000)) ||
      !finite(m.polygonSides, 3, 8) || !Number.isInteger(m.polygonSides) ||
      !finite(m.cornerRadiusMm, 0, 1000) || (c.radiusMm !== undefined && !finite(c.radiusMm, 1, 2000))) {
    throw new Error('Invalid map coordinates or dimensions')
  }
}

async function readJson(req: IncomingMessage & { body?: unknown }): Promise<unknown> {
  if (req.body !== undefined) {
    if (JSON.stringify(req.body).length > MAX_BODY_BYTES) throw new Error('Elevation request is too large')
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('Elevation request is too large')
    chunks.push(Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export default async function elevation(req: IncomingMessage & { body?: unknown }, res: ServerResponse): Promise<void> {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.writeHead(405, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Use POST for elevation requests' }))
    return
  }
  if (!await requireSession(req, res)) return
  let body: any
  try {
    body = await readJson(req)
    validate(body)
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid elevation request' }))
    return
  }
  try {
    const { crop, cols, rows, mapCrop, viewportWidth, viewportHeight, sampleWindow } = body as {
      crop: TerrainCropRegion; cols: number; rows: number; mapCrop: MapCropConfig; viewportWidth: number; viewportHeight: number; sampleWindow?: ElevationSampleWindow
    }
    // Projected grid coordinates attain their extrema at the four corners.
    // Use the full grid bounds for every chunk so each samples the same raster.
    const corners = heightfieldSampleGeo(crop, 2, 2, mapCrop, viewportWidth, viewportHeight)
    let south = crop.minLat, north = crop.maxLat, west = crop.minLon, east = crop.maxLon
    for (let i = 0; i < corners.lats.length; i++) {
      south = Math.min(south, corners.lats[i]!); north = Math.max(north, corners.lats[i]!)
      west = Math.min(west, corners.lons[i]!); east = Math.max(east, corners.lons[i]!)
    }
    const padLat = Math.max((north - south) * 0.08, 0.0008)
    const padLon = Math.max((east - west) * 0.08, 0.0008)
    south -= padLat; north += padLat; west -= padLon; east += padLon
    if (![south, north].every((n) => finite(n, -90, 90)) || ![west, east].every((n) => finite(n, -180, 180)) || (north - south) * (east - west) > 1) {
      throw new Error('Select a smaller map area for elevation data')
    }
    const url = new URL('https://portal.opentopography.org/API/globaldem')
    for (const [key, value] of Object.entries({ demtype: body.dataset, south, north, west, east, outputFormat: 'GTiff', API_Key: body.apiKey.trim() })) url.searchParams.set(key, String(value))
    const sampler = await loadElevationSampler(url)
    const { lats, lons } = heightfieldSampleGeo(crop, cols, rows, mapCrop, viewportWidth, viewportHeight, sampleWindow)
    const output = Buffer.alloc(lats.length * 4)
    for (let i = 0; i < lats.length; i++) output.writeFloatLE(sampler.sample(lats[i]!, lons[i]!) ?? NaN, i * 4)
    // Row chunks fit the response limit even when the elevations compress poorly.
    const compressed = gzipSync(output)
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'gzip', 'Content-Length': compressed.length }).end(compressed)
  } catch (error) {
    const message = error instanceof Error && error.name !== 'TimeoutError' && error.message !== 'fetch failed'
      ? error.message : 'The elevation download timed out or could not connect. Try again.'
    res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: message }))
  }
}
