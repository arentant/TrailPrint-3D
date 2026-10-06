import { test, expect } from './authenticated'
import { readFile } from 'node:fs/promises'
import { createDefaultConfig } from '../../shared/types/config'

test('Custom 1536 terrain data and trail STL retain full resolution across row chunks', async ({ page }) => {
  const errors: string[] = []
  const chunks: { rowStart: number; rowCount: number }[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/elevation', async route => {
    const { cols, rows, sampleWindow } = route.request().postDataJSON()
    expect(cols).toBe(1536); expect(rows).toBe(1536)
    chunks.push(sampleWindow)
    const values = Buffer.alloc(cols * sampleWindow.rowCount * 4)
    for (let row = 0; row < sampleWindow.rowCount; row++) for (let col = 0; col < cols; col++) {
      values.writeFloatLE(500 + (sampleWindow.rowStart + row) / 100 + col / 100, (row * cols + col) * 4)
    }
    expect(values.length).toBeLessThan(4_400_000)
    await route.fulfill({ contentType: 'application/octet-stream', body: values })
  })
  await page.goto('/')
  const config = createDefaultConfig()
  config.terrain.openTopographyApiKey = 'test-only-custom-grid'
  config.terrain.meshQuality = 'custom'
  config.terrain.meshQualityCustom.maxGrid = 1536
  config.terrain.smoothing = 'raw'
  config.mapCrop.radiusMm = 80
  config.mapCrop.mapZoom = 14
  const xml = await readFile('fixtures/sample-trail.gpx', 'utf8')
  const downloadEvent = page.waitForEvent('download', { timeout: 90_000 })
  const result = await page.evaluate(async ({ config, xml }) => {
    const { result: gpx } = await window.trailPrint.parseGpx({ content: xml, fileName: 'sample-trail.gpx' })
    config.gpx = { ...config.gpx, ...gpx, rawPoints: gpx.points, imported: true, fileName: 'sample-trail.gpx' }
    config.mapCrop.mapCenterLat = gpx.suggestedCenter.lat
    config.mapCrop.mapCenterLon = gpx.suggestedCenter.lon
    const request = { config, viewportWidth: 800, viewportHeight: 600 }
    const terrain = await window.trailPrint.generateTerrain(request)
    const heights = terrain.heightPreview.heights
    const exported = await window.trailPrint.generateExport({ ...request, target: 'trail' })
    return { cols: terrain.heightPreview.cols, rows: terrain.heightPreview.rows, length: heights.length,
      first: heights[0], last: heights[heights.length - 1], exported }
  }, { config, xml })
  expect(result.cols).toBe(1536); expect(result.rows).toBe(1536)
  expect(result.length).toBe(1536 * 1536)
  expect(result.first).toBe(0); expect(result.last).toBeGreaterThan(0)
  expect(result.exported.cancelled).toBe(false)
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('sample-trail_Trail_Line.stl')
  const stl = await readFile((await download.path())!)
  expect(stl.readUInt32LE(80)).toBeGreaterThan(0)
  expect(stl.length).toBe(84 + stl.readUInt32LE(80) * 50)
  // The export reuses the completed grid rather than downloading its rows again.
  expect(chunks).toEqual([{ rowStart: 0, rowCount: 682 }, { rowStart: 682, rowCount: 682 }, { rowStart: 1364, rowCount: 172 }])
  expect(errors).toEqual([])
})
