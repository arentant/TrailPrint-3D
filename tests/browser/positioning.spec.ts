import type { Page } from '@playwright/test'
import type { ConfigScheme, MapCropConfig } from '../../shared/types/config'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { test, expect } from './authenticated'

test.beforeEach(async ({ page }) => {
  // Keep the map interactive even when external tile services are offline.
  await page.route(/arcgisonline\.com|autonavi\.com/, (route) => route.fulfill({
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64'),
  }))
})

async function savePreset(page: Page, name: string, coordinates = true): Promise<ConfigScheme> {
  await page.getByRole('button', { name: 'Save preset', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Preset name', exact: true }).fill(name)
  await dialog.getByRole('checkbox', { name: 'Save map coordinates and framing' }).setChecked(coordinates)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toBeHidden()
  return page.evaluate((presetName) => {
    const schemes = JSON.parse(localStorage.getItem('trailprint.configSchemes')!) as ConfigScheme[]
    return schemes.find((scheme) => scheme.name === presetName)!
  }, name)
}

async function applyPreset(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /^Presets/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: new RegExp(`^${name}`) }).click()
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog).toBeHidden()
}

async function panMap(page: Page): Promise<void> {
  const box = (await page.locator('.leaflet-map').boundingBox())!
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 50)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 145, box.y + box.height / 2 + 90, { steps: 12 })
  await page.mouse.up()
  // Leaflet finishes pan inertia after pointer release.
  await page.waitForTimeout(600)
}

test('geographic crop stays unchanged during zoom, pan and viewport resize, and its handles edit the selection independently', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'))
  const move = page.getByRole('button', { name: 'Move crop shape', exact: true })
  await expect(move).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Place shape here', exact: true }).click()
  const before = await savePreset(page, 'Anchored area')
  expect(before.payload.mapView!.selection).toBeTruthy()
  const outline = page.locator('.crop-shape-outline')
  const originalBox = (await outline.boundingBox())!
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
  await expect.poll(async () => (await outline.boundingBox())!.width).toBeLessThan(originalBox.width * .8)
  await panMap(page)
  const navigated = await savePreset(page, 'Independent camera')
  expect(navigated.payload.mapView!.selection).toEqual(before.payload.mapView!.selection)
  expect(navigated.payload.mapView!.mapZoom).toBeLessThan(before.payload.mapView!.mapZoom)
  expect(navigated.payload.mapView!.mapCenterLon).not.toBeCloseTo(before.payload.mapView!.mapCenterLon, 6)
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.setViewportSize({ width: 1100, height: 850 })
  const resizedWindow = await savePreset(page, 'Same area after resize')
  expect(resizedWindow.payload.mapView!.selection).toEqual(before.payload.mapView!.selection)
  await page.getByRole('button', { name: 'Show shape', exact: true }).click()
  const cameraBeforeMove = await savePreset(page, 'Camera before shape edit')
  const handle = (await move.boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + handle.height / 2 + 30, { steps: 8 })
  await page.mouse.up()
  const movedShape = await savePreset(page, 'Moved shape')
  expect(movedShape.payload.mapView!.selection!.mapCenterLon).not.toBeCloseTo(before.payload.mapView!.selection!.mapCenterLon, 6)
  for (const field of ['mapCenterLat', 'mapCenterLon', 'mapZoom', 'mapBearingDeg'] as const) {
    expect(movedShape.payload.mapView![field]).toBeCloseTo(cameraBeforeMove.payload.mapView![field], 6)
  }
  await page.getByRole('button', { name: 'Show shape', exact: true }).click()
  const cameraBeforeResize = await savePreset(page, 'Camera before resize')
  const resize = (await page.getByRole('button', { name: 'Resize crop shape', exact: true }).boundingBox())!
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2)
  await page.mouse.down()
  await page.mouse.move(resize.x + resize.width / 2 + 45, resize.y + resize.height / 2, { steps: 8 })
  await page.mouse.up()
  const larger = await savePreset(page, 'Larger selected area')
  expect(larger.payload.mapView!.selection!.mapZoom).toBeLessThan(movedShape.payload.mapView!.selection!.mapZoom)
  expect(larger.payload.mapView!.mapZoom).toBe(cameraBeforeResize.payload.mapView!.mapZoom)
  await applyPreset(page, 'Anchored area')
  const restored = await savePreset(page, 'Restored selected area')
  expect(restored.payload.mapView).toEqual(before.payload.mapView)
  await page.screenshot({ path: 'test-results/geographic-crop.png', fullPage: true })
})

test('presets restore coordinates, zoom and rotation, while settings-only presets keep the current view', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'))
  await expect(page.locator('.leaflet-interactive')).toBeVisible()
  await page.waitForLoadState('networkidle')

  const box = (await page.locator('.leaflet-map').boundingBox())!
  await page.keyboard.down('Alt')
  await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 100, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  const original = await savePreset(page, 'Saved location')
  expect(original.payload.mapView!.mapBearingDeg).toBe(0)
  expect(original.payload.mapView!.selection!.mapBearingDeg).toBeGreaterThan(270)
  expect(original.payload).not.toHaveProperty('gpx')
  expect(original.payload.terrain).not.toHaveProperty('openTopographyApiKey')
  const settings = await savePreset(page, 'Print settings', false)
  expect(settings.payload.mapView).toBeUndefined()
  await page.getByRole('button', { name: 'Save preset', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1')
  await page.screenshot({ path: 'test-results/save-coordinates.png', fullPage: true, animations: 'disabled' })
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()

  await panMap(page)
  await page.mouse.wheel(0, 5)
  await page.waitForTimeout(400)
  const moved = await savePreset(page, 'Moved location')
  expect(moved.payload.mapView!.mapCenterLat).not.toBeCloseTo(original.payload.mapView!.mapCenterLat, 5)
  expect(moved.payload.mapView!.mapZoom).not.toBe(original.payload.mapView!.mapZoom)

  await applyPreset(page, 'Print settings')
  const kept = await savePreset(page, 'Kept location')
  expect(kept.payload.mapView).toEqual(moved.payload.mapView)

  await page.reload()
  await page.waitForLoadState('networkidle')
  await applyPreset(page, 'Saved location')
  const restored = await savePreset(page, 'Restored location')
  for (const field of ['mapCenterLat', 'mapCenterLon', 'mapZoom', 'mapBearingDeg'] as const) {
    expect(restored.payload.mapView![field], field).toBeCloseTo(original.payload.mapView![field], 6)
  }
  expect(errors).toEqual([])
})

test('positioning grid toggles, follows the crop shape, and allows panning through it', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'))
  await expect(page.locator('.leaflet-interactive')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Grid off' })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Grid off' }).click()
  const grid = page.locator('.map-grid')
  await expect(grid).toBeVisible()
  await expect(page.getByRole('button', { name: 'Grid on' })).toHaveAttribute('aria-pressed', 'true')
  const before = await savePreset(page, 'Before pan')
  await panMap(page)
  const after = await savePreset(page, 'After pan')
  expect(after.payload.mapView).not.toEqual(before.payload.mapView)

  for (const shape of ['Circle', 'Rectangle', 'Polygon']) {
    await page.getByRole('button', { name: shape, exact: true }).click()
    await expect(grid.locator('.map-grid__lines line').first()).toBeAttached()
    await expect(grid.locator('clipPath path')).not.toHaveAttribute('d', '')
  }
  await page.screenshot({ path: 'test-results/positioning-grid.png', fullPage: true })
  await page.getByRole('button', { name: 'Grid on' }).click()
  await expect(grid).toBeHidden()
})

test('rotation controls turn the selected shape clockwise without moving the map, and follow saved presets', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'))
  await expect(page.locator('.leaflet-interactive')).toBeVisible()
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
  const controls = page.getByRole('group', { name: 'Shape rotation controls' })
  const slider = controls.getByRole('slider', { name: 'Shape rotation', exact: true })
  await expect(slider).toBeEnabled()
  const legendBox = (await page.locator('.mask-legend').boundingBox())!
  const controlsBox = (await controls.boundingBox())!
  expect(controlsBox.y).toBeGreaterThan(legendBox.y + legendBox.height)
  const before = await savePreset(page, 'Before rotation')
  const mask = await page.locator('.crop-shape-outline').getAttribute('points')
  const pane = page.locator('.leaflet-rotate-pane')
  const initialTransform = await pane.getAttribute('style')

  await controls.getByRole('button', { name: 'Rotate shape counterclockwise', exact: true }).click()
  await expect(controls.locator('output')).toHaveText('345°')
  await expect(pane).toHaveAttribute('style', initialTransform!)
  await expect(page.locator('.crop-shape-outline')).not.toHaveAttribute('points', mask!)
  const rotated = await savePreset(page, 'Rotated framing')
  expect(rotated.payload.mapView!.selection).toEqual({ ...before.payload.mapView!.selection, mapBearingDeg: 15 })
  for (const field of ['mapCenterLat', 'mapCenterLon', 'mapZoom', 'mapBearingDeg'] as const) {
    expect(rotated.payload.mapView![field], field).toBeCloseTo(before.payload.mapView![field], 6)
  }

  await controls.getByRole('button', { name: 'Rotate shape clockwise', exact: true }).click()
  await expect(controls.locator('output')).toHaveText('0°')
  await slider.focus()
  await slider.press('Home')
  for (let i = 0; i < 3; i++) await slider.press('ArrowRight')
  await expect(controls.locator('output')).toHaveText('3°')
  await expect(slider).toHaveAttribute('aria-valuetext', '3 degrees clockwise from north')
  await controls.getByRole('button', { name: 'Reset shape rotation to north' }).click()
  const reset = await savePreset(page, 'North reset')
  expect(reset.payload.mapView).toEqual(before.payload.mapView)

  await applyPreset(page, 'Rotated framing')
  await expect(controls.locator('output')).toHaveText('345°')
  await page.screenshot({ path: 'test-results/map-rotation.png', fullPage: true })
  await slider.press('End')
  await expect(controls.locator('output')).toHaveText('0°')
  expect(errors).toEqual([])
})

test('Mountain and City rotation controls keep separate workspace bearings', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'))
  await expect(page.locator('.leaflet-interactive')).toBeVisible()
  const controls = page.getByRole('group', { name: 'Shape rotation controls' })
  const clockwise = controls.getByRole('button', { name: 'Rotate shape clockwise', exact: true })
  await expect(clockwise).toBeEnabled()
  await clockwise.click()
  await clockwise.click()
  await expect(controls.locator('output')).toHaveText('30°')

  await page.getByRole('button', { name: 'City', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/city-run.gpx'))
  await expect(page.locator('.leaflet-interactive')).toBeVisible()
  await expect(controls.locator('output')).toHaveText('0°')
  await controls.getByRole('button', { name: 'Rotate shape counterclockwise', exact: true }).click()
  await expect(controls.locator('output')).toHaveText('345°')
  await page.getByRole('button', { name: 'Mountain', exact: true }).click()
  await expect(clockwise).toBeEnabled()
  await expect(controls.locator('output')).toHaveText('30°')
  await page.getByRole('button', { name: 'City', exact: true }).click()
  await expect(clockwise).toBeEnabled()
  await expect(controls.locator('output')).toHaveText('345°')
  await page.getByRole('button', { name: 'Fit track', exact: true }).click()
  await expect(controls.locator('output')).toHaveText('345°')
  expect(errors).toEqual([])
})

test('without GPX, place search moves the shape across the world while preserving its size and rotation', async ({ page }) => {
  let searches = 0
  await page.route('https://geocoding-api.open-meteo.com/v1/search**', route => {
    searches++
    expect(new URL(route.request().url()).searchParams.get('name')).toBe('Mount Aragats')
    return route.fulfill({ json: { results: [
      { latitude: 40.523, longitude: 44.194, name: 'Mount Aragats', country: 'Armenia' },
      { latitude: 100, longitude: 200, name: 'Invalid place' },
    ] } })
  })
  await page.goto('/')
  const controls = page.getByRole('group', { name: 'Shape rotation controls' })
  await expect(controls.getByRole('slider')).toBeEnabled()
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
  await controls.getByRole('button', { name: 'Rotate shape clockwise', exact: true }).click()
  await page.getByRole('button', { name: 'Smaller shape', exact: true }).click()
  const before = await savePreset(page, 'Shape before searching')
  const search = page.getByRole('search', { name: 'Find a place' })
  const input = search.getByRole('searchbox', { name: 'Go to a place' })
  await input.fill('Mount Aragats')
  expect(searches).toBe(0)
  await input.press('Enter')
  await search.getByRole('button', { name: 'Mount Aragats, Armenia', exact: true }).click()
  expect(searches).toBe(1)
  await expect(search.getByRole('status')).toContainText('Shape moved to Mount Aragats')
  const after = await savePreset(page, 'Aragats without GPX')
  expect(after.payload.mapView!.selection).toEqual({ ...before.payload.mapView!.selection, mapCenterLat: 40.523, mapCenterLon: 44.194 })
  expect(after.payload.mapView!.mapCenterLat).toBeCloseTo(40.523, 6)
  expect(after.payload.mapView!.mapCenterLon).toBeCloseTo(44.194, 6)
  await expect(page.getByRole('button', { name: 'Move crop shape', exact: true })).toBeVisible()
  await expect(controls.locator('output')).toHaveText('15°')
  await page.screenshot({ path: 'test-results/place-search.png', fullPage: true })

  await input.press('Enter')
  await search.getByRole('button', { name: 'Mount Aragats, Armenia', exact: true }).click()
  expect(searches).toBe(1) // Repeated searches use the session cache.
  await input.fill('-33.8688, 151.2093')
  await input.press('Enter')
  const sydney = await savePreset(page, 'Sydney coordinates')
  expect(sydney.payload.mapView!.selection).toEqual({ ...before.payload.mapView!.selection, mapCenterLat: -33.8688, mapCenterLon: 151.2093 })
  expect(searches).toBe(1)
})

test('search errors and empty results keep the shape in place, and coordinates work offline in City', async ({ page }) => {
  await page.route('https://geocoding-api.open-meteo.com/v1/search**', route => new URL(route.request().url()).searchParams.get('name') === 'missing'
    ? route.fulfill({ json: {} }) : route.abort('failed'))
  await page.goto('/')
  await page.evaluate(() => {
    window.trailPrint.generateCityModel = async request => {
      Object.assign(window, { capturedCityCrop: request.config.mapCrop })
      throw new Error('Captured city framing')
    }
  })
  await page.getByRole('button', { name: 'City', exact: true }).click()
  const controls = page.getByRole('group', { name: 'Shape rotation controls' })
  await expect(controls.getByRole('slider')).toBeEnabled()
  async function cityCrop(): Promise<MapCropConfig> {
    await page.getByRole('button', { name: 'Preview & export City STL', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Captured city framing')
    const crop = await page.evaluate(() => (window as unknown as { capturedCityCrop: MapCropConfig }).capturedCityCrop)
    await page.getByRole('button', { name: 'Close city preview', exact: true }).click()
    return crop
  }
  const before = await cityCrop()
  const search = page.getByRole('search', { name: 'Find a place' })
  const input = search.getByRole('searchbox', { name: 'Go to a place' })
  await input.fill('missing')
  await input.press('Enter')
  await expect(search.getByRole('status')).toContainText('No places found')
  await input.fill('offline')
  await input.press('Enter')
  await expect(search.getByRole('status')).toContainText('Place search is unavailable')
  await input.fill('90, 44.51')
  await input.press('Enter')
  await expect(search.getByRole('status')).toContainText('Enter latitude between')
  const unchanged = await cityCrop()
  expect(unchanged).toEqual(before)
  await input.fill('40.1872, 44.5152')
  await input.press('Enter')
  const placed = await cityCrop()
  expect(placed.selection!.mapCenterLat).toBe(40.1872)
  expect(placed.selection!.mapCenterLon).toBe(44.5152)
  await controls.getByRole('button', { name: 'Rotate shape clockwise', exact: true }).click()
  const rotated = await cityCrop()
  expect(rotated.selection!.mapBearingDeg).toBe(345)
  expect(rotated.mapBearingDeg).toBe(placed.mapBearingDeg)
})

test('the sidebar downloads only the trail, independent of invalid tray settings', async ({ page }) => {
  await page.route('**/api/elevation', async (route) => {
    const { cols, rows } = route.request().postDataJSON()
    const values = Buffer.alloc(cols * rows * 4)
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      values.writeFloatLE(500 + row * 0.5, (row * cols + col) * 4)
    }
    await route.fulfill({ contentType: 'application/octet-stream', body: values })
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const trailButton = page.getByRole('button', { name: 'Download trail STL' })
  await expect(trailButton).toBeDisabled()
  await page.getByPlaceholder('Paste your API key').fill('browser-test-key')
  await page.getByRole('button', { name: 'Standard', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'))
  await expect(page.locator('.leaflet-interactive')).toBeVisible()
  await page.getByRole('switch', { name: 'Generate base', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Total thickness' }).fill('0.1')
  const event = page.waitForEvent('download')
  await trailButton.click()
  const download = await event
  expect(download.suggestedFilename()).toBe('sample-trail_circle_R60mm_mesh-standard_magnets-off_Trail_Line.stl')
  const bytes = await readFile((await download.path())!)
  const triangles = bytes.readUInt32LE(80)
  expect(triangles).toBeGreaterThan(0)
  expect(bytes.length).toBe(84 + triangles * 50)
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.locator('.sidebar__status')).toContainText('sample-trail_circle_R60mm_mesh-standard_magnets-off_Trail_Line.stl')
})
