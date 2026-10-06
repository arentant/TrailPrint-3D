import type { Page } from '@playwright/test'
import type { ConfigScheme } from '../../shared/types/config'
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
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 75, box.y + box.height / 2 + 40, { steps: 12 })
  await page.mouse.up()
  // Leaflet finishes pan inertia after pointer release.
  await page.waitForTimeout(600)
}

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
  expect(original.payload.mapView!.mapBearingDeg).toBeGreaterThan(20)
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

test('rotation controls wrap angles, keep framing fixed, and follow saved presets', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'))
  await expect(page.locator('.leaflet-interactive')).toBeVisible()
  const controls = page.getByRole('group', { name: 'Map rotation controls' })
  const slider = controls.getByRole('slider', { name: 'Map rotation', exact: true })
  await expect(slider).toBeEnabled()
  const legendBox = (await page.locator('.mask-legend').boundingBox())!
  const controlsBox = (await controls.boundingBox())!
  expect(controlsBox.y).toBeGreaterThan(legendBox.y + legendBox.height)
  const before = await savePreset(page, 'Before rotation')
  const mask = await page.locator('.mask-hole').getAttribute('style')
  const pane = page.locator('.leaflet-rotate-pane')
  const initialTransform = await pane.getAttribute('style')

  await controls.getByRole('button', { name: 'Rotate map counterclockwise', exact: true }).click()
  await expect(controls.locator('output')).toHaveText('345°')
  await expect(pane).not.toHaveAttribute('style', initialTransform!)
  await expect(page.locator('.mask-hole')).toHaveAttribute('style', mask!)
  const rotated = await savePreset(page, 'Rotated framing')
  expect(rotated.payload.mapView!.mapBearingDeg).toBeCloseTo(345, 6)
  for (const field of ['mapCenterLat', 'mapCenterLon', 'mapZoom'] as const) {
    expect(rotated.payload.mapView![field], field).toBeCloseTo(before.payload.mapView![field], 6)
  }

  await controls.getByRole('button', { name: 'Rotate map clockwise', exact: true }).click()
  await expect(controls.locator('output')).toHaveText('0°')
  await slider.focus()
  await slider.press('Home')
  for (let i = 0; i < 3; i++) await slider.press('ArrowRight')
  await expect(controls.locator('output')).toHaveText('3°')
  await expect(slider).toHaveAttribute('aria-valuetext', '3 degrees clockwise from north')
  await controls.getByRole('button', { name: 'Reset map rotation to north' }).click()
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
  const controls = page.getByRole('group', { name: 'Map rotation controls' })
  const clockwise = controls.getByRole('button', { name: 'Rotate map clockwise', exact: true })
  await expect(clockwise).toBeEnabled()
  await clockwise.click()
  await clockwise.click()
  await expect(controls.locator('output')).toHaveText('30°')

  await page.getByRole('button', { name: 'City', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/city-run.gpx'))
  await expect(page.locator('.leaflet-interactive')).toBeVisible()
  await expect(controls.locator('output')).toHaveText('0°')
  await controls.getByRole('button', { name: 'Rotate map counterclockwise', exact: true }).click()
  await expect(controls.locator('output')).toHaveText('345°')
  await page.getByRole('button', { name: 'Mountain', exact: true }).click()
  await expect(clockwise).toBeEnabled()
  await expect(controls.locator('output')).toHaveText('30°')
  await page.getByRole('button', { name: 'City', exact: true }).click()
  await expect(clockwise).toBeEnabled()
  await expect(controls.locator('output')).toHaveText('345°')
  await page.getByRole('button', { name: 'Fit track', exact: true }).click()
  await expect(controls.locator('output')).toHaveText('0°')
  expect(errors).toEqual([])
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
  await page.getByRole('spinbutton', { name: 'Total thickness' }).fill('0.1')
  const event = page.waitForEvent('download')
  await trailButton.click()
  const download = await event
  expect(download.suggestedFilename()).toBe('sample-trail_Trail_Line.stl')
  const bytes = await readFile((await download.path())!)
  const triangles = bytes.readUInt32LE(80)
  expect(triangles).toBeGreaterThan(0)
  expect(bytes.length).toBe(84 + triangles * 50)
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.locator('.sidebar__status')).toContainText('sample-trail_Trail_Line.stl')
})
