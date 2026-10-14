import { test, expect } from './authenticated'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'

test('water controls, preview and ZIP provide inserts that sit in terrain recesses', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let waterRequests = 0
  await page.route('**/api/elevation', async route => {
    const { cols, rows } = route.request().postDataJSON()
    const values = Buffer.alloc(cols * rows * 4)
    for (let i = 0; i < cols * rows; i++) values.writeFloatLE(500, i * 4)
    await route.fulfill({ contentType: 'application/octet-stream', body: values })
  })
  await page.route('**/api/city', async route => {
    const request = route.request().postDataJSON()
    expect(request.water).toBe(true)
    expect(request.buildings).toBe(false); expect(request.roads).toBe(false)
    waterRequests++
    const b = request.bounds
    const minLat = b.minLat + (b.maxLat - b.minLat) * 0.25
    const maxLat = b.maxLat - (b.maxLat - b.minLat) * 0.25
    const minLon = b.minLon + (b.maxLon - b.minLon) * 0.25
    const maxLon = b.maxLon - (b.maxLon - b.minLon) * 0.25
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: [{
      type: 'way', id: 1, tags: { natural: 'water', water: 'lake' }, nodes: [1, 2, 3, 4, 1],
      geometry: [{ lat: minLat, lon: minLon }, { lat: minLat, lon: maxLon },
        { lat: maxLat, lon: maxLon }, { lat: maxLat, lon: minLon }, { lat: minLat, lon: minLon }],
    }] }) })
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const waterToggle = page.getByRole('switch', { name: 'Include water' })
  await expect(waterToggle).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('spinbutton', { name: 'Alignment pin diameter' })).toHaveCount(0)
  await waterToggle.click()
  await expect(page.getByRole('spinbutton', { name: 'Alignment pin diameter' })).toHaveCount(0)
  await expect(page.getByRole('spinbutton', { name: 'Pin socket depth' })).toHaveCount(0)
  await expect(page.getByRole('spinbutton', { name: 'Fitting clearance' })).toHaveValue('0.15')
  await page.getByRole('spinbutton', { name: 'Fitting clearance' }).fill('0.2')
  await page.getByRole('spinbutton', { name: 'Water thickness' }).fill('1.2')
  await page.getByRole('spinbutton', { name: 'Base thickness' }).fill('3')
  await page.getByPlaceholder('Paste your API key').fill('browser-water-test-key')
  await page.getByRole('button', { name: 'Standard', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'))
  await expect(page.locator('.sidebar__status')).toContainText('Imported')
  await page.getByRole('button', { name: 'Preview & export STL' }).click()
  const downloadButton = page.getByRole('button', { name: 'Download', exact: true })
  await expect(downloadButton).toBeEnabled({ timeout: 60_000 })
  await expect(page.locator('.terrain-preview__water')).toContainText('Place or glue into terrain', { timeout: 60_000 })
  await page.screenshot({ path: 'test-results/water-preview.png' })
  // Export errors previously appeared only in the sidebar behind this dialog,
  // making a failed Download click look as if it had done nothing.
  await page.evaluate(() => {
    const generate = window.trailPrint.generateExport
    window.trailPrint.generateExport = async (...args) => {
      window.trailPrint.generateExport = generate
      throw new Error('Terrain_Main is not watertight (open edges 0, non-manifold edges 1)')
    }
  })
  await downloadButton.click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Terrain_Main is not watertight')
  await expect(downloadButton).toBeEnabled()
  const downloadEvent = page.waitForEvent('download', { timeout: 90_000 })
  await downloadButton.click()
  await expect(page.locator('.terrain-modal__export-status')).not.toContainText('not watertight')
  const files = unzipSync(await readFile((await (await downloadEvent).path())!))
  expect(Object.keys(files).filter(name => /Water_Insert.*\.stl$/.test(name)).length).toBeGreaterThan(0)
  expect(Object.keys(files).some(name => /Water_Pins\.stl$/.test(name))).toBe(false)
  const guideName = Object.keys(files).find(name => /Water_Assembly\.txt$/.test(name))!
  expect(new TextDecoder().decode(files[guideName])).toContain('flat pocket floor')
  expect(new TextDecoder().decode(files[guideName])).toContain('Fitting clearance: 0.2 mm per side')
  expect(new TextDecoder().decode(files[guideName])).not.toMatch(/pin|socket/i)
  expect(waterRequests).toBeGreaterThanOrEqual(2)
  await expect(page.locator('.terrain-modal__export-status')).toContainText('Download ready:')
  await expect(downloadButton).toBeEnabled()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await waterToggle.click()
  await page.getByRole('button', { name: 'Preview & export STL' }).click()
  await expect(downloadButton).toBeEnabled({ timeout: 60_000 })
  await expect(page.locator('.terrain-preview__water')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('legacy water presets preserve thickness and clearance while dropping pin settings', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('switch', { name: 'Include water' }).click()
  await page.getByRole('spinbutton', { name: 'Water thickness' }).fill('0.6')
  await page.getByRole('spinbutton', { name: 'Fitting clearance' }).fill('0.25')
  await page.getByRole('button', { name: 'Save preset', exact: true }).click()
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Legacy water')
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
  await page.evaluate(() => {
    const presets = JSON.parse(localStorage.getItem('trailprint.configSchemes')!)
    presets[0].payload.water.pinDiameterMm = 5
    presets[0].payload.water.pinDepthMm = 2
    localStorage.setItem('trailprint.configSchemes', JSON.stringify(presets))
  })
  await page.reload()
  await page.getByTitle('Apply a saved preset', { exact: true }).click()
  await page.getByRole('button', { name: /Legacy water/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'Water thickness' })).toHaveValue('0.6')
  await expect(page.getByRole('spinbutton', { name: 'Fitting clearance' })).toHaveValue('0.25')
  await expect(page.getByRole('spinbutton', { name: /pin|socket/i })).toHaveCount(0)
  await page.getByRole('button', { name: 'Save preset', exact: true }).click()
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Water fit')
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
  const water = await page.evaluate(() => JSON.parse(localStorage.getItem('trailprint.configSchemes')!)
    .find((preset: { name: string }) => preset.name === 'Water fit').payload.water)
  expect(water).toMatchObject({ enabled: true, thicknessMm: 0.6, clearanceMm: 0.25, minimumAreaMm2: 0.16, minimumRiverWidthMm: 0.8, riverWidthMultiplier: 1 })
  expect(water).not.toHaveProperty('pinDiameterMm')
  expect(water).not.toHaveProperty('pinDepthMm')
  await page.evaluate(() => {
    const presets = JSON.parse(localStorage.getItem('trailprint.configSchemes')!)
    delete presets.find((preset: { name: string }) => preset.name === 'Legacy water').payload.water
    localStorage.setItem('trailprint.configSchemes', JSON.stringify(presets))
  })
  await page.reload()
  await page.getByTitle('Apply a saved preset', { exact: true }).click()
  await page.getByRole('button', { name: /Legacy water/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page.getByRole('switch', { name: 'Include water' })).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('switch', { name: 'Include water' }).click()
  await expect(page.getByRole('spinbutton', { name: 'Fitting clearance' })).toHaveValue('0.15')
})

test('water can be reviewed without terrain, excluded on the map and filtered by category', async ({ page }) => {
  let elevationRequests = 0
  let waterRequests = 0
  await page.route('**/api/elevation', route => { elevationRequests++; return route.abort() })
  await page.route('**/api/city', async route => {
    waterRequests++
    const { bounds: b } = route.request().postDataJSON()
    const ring = [
      { lat: b.minLat + (b.maxLat - b.minLat) * .46, lon: b.minLon + (b.maxLon - b.minLon) * .46 },
      { lat: b.minLat + (b.maxLat - b.minLat) * .46, lon: b.minLon + (b.maxLon - b.minLon) * .54 },
      { lat: b.minLat + (b.maxLat - b.minLat) * .54, lon: b.minLon + (b.maxLon - b.minLon) * .54 },
      { lat: b.minLat + (b.maxLat - b.minLat) * .54, lon: b.minLon + (b.maxLon - b.minLon) * .46 },
    ]; ring.push(ring[0])
    const otherRing = ring.map(point => ({ lat: point.lat + (b.maxLat - b.minLat) * .09, lon: point.lon + (b.maxLon - b.minLon) * .09 }))
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: [{ type: 'way', id: 77,
      tags: { natural: 'water', water: 'lake', name: 'Review lake' }, nodes: [1, 2, 3, 4, 1], geometry: ring }, {
      type: 'way', id: 78, tags: { natural: 'water', water: 'lake', name: 'Another lake' }, nodes: [5, 6, 7, 8, 5], geometry: otherRing,
    }] }) })
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('switch', { name: 'Include water' }).click()
  const lake = page.getByRole('checkbox', { name: 'Keep Review lake', exact: true })
  const otherLake = page.getByRole('checkbox', { name: 'Keep Another lake', exact: true })
  const lakeRow = page.locator('.water-review__feature').filter({ has: lake })
  await expect(lake).toBeChecked()
  await expect(otherLake).toBeChecked()
  await expect(lakeRow).toContainText('Kept')
  const fetched = waterRequests
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.waitForTimeout(700)
  expect(waterRequests).toBe(fetched)
  const polygon = page.locator('.leaflet-overlay-pane path[stroke="#268fbc"]')
  await expect(polygon).toHaveCount(2)
  await polygon.first().click({ position: { x: 5, y: 5 } })
  await expect(lake).not.toBeChecked()
  await expect(lakeRow).toContainText('Hidden')
  await expect(otherLake).toBeChecked()
  await lake.check()
  await expect(lakeRow).toContainText('Kept')
  await otherLake.uncheck()
  await page.getByRole('button', { name: 'Refresh water' }).click()
  await expect(lake).toBeChecked()
  await expect(otherLake).not.toBeChecked()
  await page.screenshot({ path: 'test-results/water-selection.png' })
  const uncheckAll = page.getByRole('button', { name: 'Uncheck all', exact: true })
  await uncheckAll.click()
  await expect(lake).not.toBeChecked()
  await expect(otherLake).not.toBeChecked()
  await expect(page.getByRole('status').filter({ hasText: '0 kept · 2 detected' })).toBeVisible()
  await page.getByRole('button', { name: 'Refresh water' }).click()
  await expect(lake).not.toBeChecked()
  await expect(otherLake).not.toBeChecked()
  await expect(uncheckAll).toBeDisabled()
  await lake.check()
  await expect(lake).toBeChecked()
  await expect(otherLake).not.toBeChecked()
  await page.getByRole('checkbox', { name: 'lake', exact: true }).uncheck()
  await expect(lakeRow).toContainText('Category hidden')
  await expect(lake).toBeDisabled()
  await page.getByRole('checkbox', { name: 'lake', exact: true }).check()
  await page.getByRole('spinbutton', { name: 'Minimum water area' }).fill('100')
  await expect(lakeRow).toContainText('Too small to print')
  expect(elevationRequests).toBe(0)
  await expect(page.getByRole('alert').filter({ hasText: 'coverage is not configured' })).toBeVisible()
  await page.screenshot({ path: 'test-results/water-map-review.png' })
})

test('cancelled water fetches do not replace the review, and provider failures remain visible', async ({ page }) => {
  let calls = 0
  await page.route('**/api/city', async route => {
    calls++
    if (calls === 1) {
      await new Promise(resolve => setTimeout(resolve, 1200))
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: [] }) }).catch(() => {})
    } else await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Water provider unavailable' }) })
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('switch', { name: 'Include water' }).click()
  const review = page.getByRole('region', { name: 'Water feature review' })
  await expect.poll(() => calls).toBe(1)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(review).toContainText('Water fetch cancelled')
  await review.getByRole('button', { name: 'Refresh water' }).click()
  await expect(review.getByRole('alert').filter({ hasText: 'Water provider unavailable' })).toBeVisible()
  await expect(review).toContainText('Coverage is incomplete')
  await expect(review).not.toContainText('No water found in this crop.')
})

test('complete multicolor download keeps chosen water and omits hidden water using current fused settings', async ({ page }) => {
  await page.route('**/api/elevation', async route => {
    const { cols, rows } = route.request().postDataJSON()
    const values = Buffer.alloc(cols * rows * 4)
    for (let i = 0; i < cols * rows; i++) values.writeFloatLE(500, i * 4)
    await route.fulfill({ contentType: 'application/octet-stream', body: values })
  })
  await page.route('**/api/city', async route => {
    const { bounds: b } = route.request().postDataJSON()
    const lake = (id: number, name: string, min: number, max: number) => {
      const a = { lat: b.minLat + (b.maxLat - b.minLat) * min, lon: b.minLon + (b.maxLon - b.minLon) * min }
      const c = { lat: b.minLat + (b.maxLat - b.minLat) * max, lon: b.minLon + (b.maxLon - b.minLon) * max }
      return { type: 'way', id, tags: { natural: 'water', water: 'lake', name }, nodes: [id * 4, id * 4 + 1, id * 4 + 2, id * 4 + 3, id * 4],
        geometry: [a, { lat: a.lat, lon: c.lon }, c, { lat: c.lat, lon: a.lon }, a] }
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: [lake(17, 'Export lake', .3, .48), lake(18, 'Hidden lake', .55, .7)] }) })
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('switch', { name: 'Include water' }).click()
  await page.getByLabel('Print mode', { exact: true }).selectOption('fused')
  await page.getByRole('button', { name: 'Standard', exact: true }).click()
  await page.getByPlaceholder('Paste your API key').fill('browser-3mf-test-key')
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'))
  const hiddenLake = page.getByRole('checkbox', { name: 'Keep Hidden lake', exact: true })
  await expect(hiddenLake).toBeChecked()
  await hiddenLake.uncheck()
  await expect(hiddenLake).not.toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Keep Export lake', exact: true })).toBeChecked()
  await page.getByRole('button', { name: 'Preview & export STL' }).click()
  const button = page.getByRole('button', { name: 'Download model 3MF', exact: true })
  await expect(button).toBeEnabled({ timeout: 60000 })
  const waterColor = page.getByRole('dialog').getByRole('textbox', { name: 'Water color', exact: true })
  await waterColor.fill('#125678')
  const event = page.waitForEvent('download')
  await button.click()
  const download = await event
  expect(download.suggestedFilename()).toMatch(/Model\.3mf$/)
  const files = unzipSync(await readFile((await download.path())!))
  const model = new TextDecoder().decode(files['3D/3dmodel.model'])
  expect(model).toContain('color="#125678FF"')
  expect((model.match(/<item /g) ?? []).length).toBe(2)
  const metadata = JSON.parse(new TextDecoder().decode(files['Metadata/trailprint.json']))
  expect(metadata.metadata.printMode).toBe('fused')
  expect(metadata.metadata.sources[0].id).toBe('osm')
  expect(metadata.metadata.partMappings.length).toBeGreaterThan(0)
  const hiddenFeature = metadata.metadata.features.find((feature: { name: string }) => feature.name === 'Hidden lake')
  expect(hiddenFeature).toBeTruthy()
  expect(metadata.metadata.featureStatuses.find((status: { featureId: string }) => status.featureId === hiddenFeature.id).state).toBe('excluded')
  expect(metadata.metadata.partMappings.flatMap((part: { featureIds: string[] }) => part.featureIds)).not.toContain(hiddenFeature.id)
  expect(model).toContain('Export lake')
  expect(model).not.toContain('Hidden lake')
  expect(new TextDecoder().decode(files['Metadata/model_settings.config'])).toContain('key="extruder" value="3"')
})
