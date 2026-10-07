import { test, expect } from './authenticated'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { unzipSync } from 'fflate'

test('GPX import, terrain preview, validated STL ZIP, and repeat download', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let elevationRequests = 0
  await page.route('**/api/elevation', async (route) => {
    elevationRequests++
    const { cols, rows, apiKey } = route.request().postDataJSON()
    expect(apiKey).toBe('browser-test-key')
    const values = Buffer.alloc(cols * rows * 4)
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      values.writeFloatLE(500 + row * 0.5 + 30 * Math.sin(col / cols * Math.PI), (row * cols + col) * 4)
    }
    await route.fulfill({ contentType: 'application/octet-stream', body: values })
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { name: 'TrailPrint', exact: true })).toBeVisible()
  await page.getByPlaceholder('Paste your API key').fill('browser-test-key')
  await page.getByRole('button', { name: 'Standard', exact: true }).click()
  await page.getByRole('switch', { name: 'Underside magnet holes', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'))
  await expect(page.getByText('Drop a GPX track to get started')).toBeHidden()
  await expect(page.locator('.sidebar__status')).toContainText('Imported')
  await page.getByRole('button', { name: 'Preview & export STL' }).click()
  const downloadButton = page.getByRole('button', { name: 'Download', exact: true })
  await expect(downloadButton).toBeEnabled({ timeout: 60_000 })
  await expect(page.locator('canvas').first()).toBeVisible()
  const previewDialog = page.getByRole('dialog')
  await previewDialog.locator('[data-setting-guide="paintMasks"] button').click()
  await expect(page.getByRole('tooltip').getByRole('img')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await expect(previewDialog).toBeVisible()
  const downloadEvent = page.waitForEvent('download', { timeout: 90_000 })
  await downloadButton.click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('sample-trail_circle_R60mm_mesh-standard_magnets-on-circle-6x2mm.zip')
  const files = unzipSync(await readFile((await download.path())!))
  expect(Object.keys(files).sort()).toEqual(['sample-trail_circle_R60mm_mesh-standard_magnets-on-circle-6x2mm_Terrain_Main.stl', 'sample-trail_circle_R60mm_mesh-standard_magnets-on-circle-6x2mm_Trail_Line.stl', 'sample-trail_circle_R60mm_mesh-standard_magnets-on-circle-6x2mm_Tray_Base.stl'])
  for (const [name, bytes] of Object.entries(files)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const triangles = view.getUint32(80, true)
    expect(triangles, name).toBeGreaterThan(0)
    expect(bytes.byteLength, name).toBe(84 + triangles * 50)
    expect(new TextDecoder().decode(bytes.subarray(0, 80)).replace(/\0+$/, ''), name).toBe(name.replace(/\.stl$/, ''))
    let invalidCoordinates = 0
    for (let t = 0; t < triangles; t++) for (let coordinate = 0; coordinate < 12; coordinate++) {
      if (!Number.isFinite(view.getFloat32(84 + t * 50 + coordinate * 4, true))) invalidCoordinates++
    }
    expect(invalidCoordinates, name).toBe(0)
  }
  expect(elevationRequests).toBeGreaterThan(0)
  expect(errors).toEqual([])
  await expect(downloadButton).toBeEnabled()
  await expect(page.locator('.terrain-modal__loading')).toBeHidden()
  await page.screenshot({ path: 'test-results/browser-export.png', fullPage: true })
  // The browser adapter retains the ZIP for a repeat download, without recomputing.
  const again = page.waitForEvent('download')
  await page.evaluate(() => window.trailPrint.revealExport('last-export'))
  expect((await again).suggestedFilename()).toBe(download.suggestedFilename())

  // A direct trail STL must preserve the assembly coordinates of the ZIP part.
  const trailEvent = page.waitForEvent('download', { timeout: 90_000 })
  await page.getByRole('dialog').getByRole('button', { name: 'Download trail STL' }).click()
  const trail = await trailEvent
  expect(trail.suggestedFilename()).toBe('sample-trail_circle_R60mm_mesh-standard_magnets-on-circle-6x2mm_Trail_Line.stl')
  expect(await readFile((await trail.path())!)).toEqual(Buffer.from(files['sample-trail_circle_R60mm_mesh-standard_magnets-on-circle-6x2mm_Trail_Line.stl']!))
  await expect(downloadButton).toBeEnabled()
  const repeatTrail = page.waitForEvent('download')
  await page.evaluate(() => window.trailPrint.revealExport('last-export'))
  expect((await repeatTrail).suggestedFilename()).toBe('sample-trail_circle_R60mm_mesh-standard_magnets-on-circle-6x2mm_Trail_Line.stl')
  expect(errors).toEqual([])
})

test('invalid GPX and missing API key give actionable errors', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({ name: 'invalid.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from('not XML') })
  await expect(page.locator('.sidebar__status')).toContainText('not a valid GPX')
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'))
  await page.getByRole('button', { name: 'Preview & export STL' }).click()
  await expect(page.getByText(/Enter your OpenTopography API key/).first()).toBeVisible()
})

test('elevation endpoint rejects invalid input without contacting the provider', async ({ page }) => {
  const request = page.request
  const get = await request.get('/api/elevation')
  expect(get.status()).toBe(405)
  const missingKey = await request.post('/api/elevation', { data: {} })
  expect(missingKey.status()).toBe(400)
  expect(await missingKey.json()).toEqual({ error: 'Enter a valid OpenTopography API key' })
  const unsupported = await request.post('/api/elevation', { data: { apiKey: 'test', dataset: 'https://example.com' } })
  expect(unsupported.status()).toBe(400)
  expect(unsupported.headers()['cache-control']).toBe('private, no-store')
})
