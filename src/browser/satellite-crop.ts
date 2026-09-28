import type { MapCropConfig } from '@shared/types/config'
import type { TerrainCropRegion } from '@shared/types/terrain'
import { geoToNormalizedUv, heightfieldGeoBounds, heightfieldSampleGeo } from '@shared/utils/map-mm-projection'
import { esriTileUrl, lonLatToTileXY, pickSatelliteZoom, TILE_SIZE, tileRangeGeoBounds } from '@shared/utils/satellite-tiles'

export interface GridRgbSample { r: number; g: number; b: number }

export async function fetchGridSatelliteRgb(crop: TerrainCropRegion, cols: number, rows: number, mapCrop: MapCropConfig, viewportWidth: number, viewportHeight: number): Promise<GridRgbSample[]> {
  const bounds = heightfieldGeoBounds(crop, cols, rows, mapCrop, viewportWidth, viewportHeight)
  const zoom = pickSatelliteZoom(bounds.minLon, bounds.maxLon, bounds.minLat, bounds.maxLat, Math.min(4096, Math.max(cols, rows) * 4))
  const tl = lonLatToTileXY(bounds.minLon, bounds.maxLat, zoom)
  const br = lonLatToTileXY(bounds.maxLon, bounds.minLat, zoom)
  const width = (br.x - tl.x + 1) * TILE_SIZE
  const height = (br.y - tl.y + 1) * TILE_SIZE
  if (width * height > 25_000_000) throw new Error('Select a smaller area for satellite colors')
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('This browser cannot read satellite colors')
  const tiles: Array<{ x: number; y: number }> = []
  for (let y = tl.y; y <= br.y; y++) for (let x = tl.x; x <= br.x; x++) tiles.push({ x, y })
  // Keep image decoding and open connections bounded.
  let next = 0
  await Promise.all(Array.from({ length: Math.min(8, tiles.length) }, async () => {
    while (next < tiles.length) {
      const tile = tiles[next++]!
      const response = await fetch(esriTileUrl(zoom, tile.x, tile.y), { signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error(`Satellite tile request failed (${response.status})`)
      const bitmap = await createImageBitmap(await response.blob())
      context.drawImage(bitmap, (tile.x - tl.x) * TILE_SIZE, (tile.y - tl.y) * TILE_SIZE, TILE_SIZE, TILE_SIZE)
      bitmap.close()
    }
  }))
  const pixels = context.getImageData(0, 0, width, height).data
  const tileBounds = tileRangeGeoBounds(tl.x, tl.y, br.x, br.y, zoom)
  const { lats, lons } = heightfieldSampleGeo(crop, cols, rows, mapCrop, viewportWidth, viewportHeight)
  return lats.map((lat, i) => {
    const { u, v } = geoToNormalizedUv(lat, lons[i]!, tileBounds)
    const x = Math.max(0, Math.min(width - 1, Math.round(u * (width - 1))))
    const y = Math.max(0, Math.min(height - 1, Math.round(v * (height - 1))))
    const offset = (y * width + x) * 4
    return { r: pixels[offset]!, g: pixels[offset + 1]!, b: pixels[offset + 2]! }
  })
}
