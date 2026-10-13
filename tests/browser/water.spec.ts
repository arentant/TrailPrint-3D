import { test, expect } from './authenticated'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'

test('water controls, preview and ZIP provide separate inserts with printable alignment pins', async ({ page }) => {
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
  const waterToggle = page.getByRole('switch', { name: 'Print water separately' })
  await expect(waterToggle).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('spinbutton', { name: 'Alignment pin diameter' })).toHaveCount(0)
  await waterToggle.click()
  await expect(page.getByRole('spinbutton', { name: 'Alignment pin diameter' })).toHaveValue('2')
  await page.getByRole('spinbutton', { name: 'Water thickness' }).fill('1.2')
  await page.getByRole('spinbutton', { name: 'Base thickness' }).fill('3')
  await page.getByPlaceholder('Paste your API key').fill('browser-water-test-key')
  await page.getByRole('button', { name: 'Standard', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'))
  await expect(page.locator('.sidebar__status')).toContainText('Imported')
  await page.getByRole('button', { name: 'Preview & export STL' }).click()
  const downloadButton = page.getByRole('button', { name: 'Download', exact: true })
  await expect(downloadButton).toBeEnabled({ timeout: 60_000 })
  await expect(page.locator('.terrain-preview__water')).toContainText('Alignment pins', { timeout: 60_000 })
  await page.screenshot({ path: 'test-results/water-preview.png' })
  const downloadEvent = page.waitForEvent('download', { timeout: 90_000 })
  await downloadButton.click()
  const files = unzipSync(await readFile((await (await downloadEvent).path())!))
  expect(Object.keys(files).filter(name => /Water_Insert.*\.stl$/.test(name)).length).toBeGreaterThan(0)
  const pinName = Object.keys(files).find(name => /Water_Pins\.stl$/.test(name))!
  const pinBytes = files[pinName]
  const pins = new DataView(pinBytes.buffer, pinBytes.byteOffset, pinBytes.byteLength)
  expect(pins.getUint32(80, true)).toBeGreaterThan(0)
  expect(pinBytes.length).toBe(84 + pins.getUint32(80, true) * 50)
  for (let face = 0; face < pins.getUint32(80, true); face++) for (let v = 0; v < 3; v++) {
    expect(pins.getFloat32(84 + face * 50 + 12 + v * 12 + 8, true)).toBeGreaterThanOrEqual(-1e-5)
  }
  const guideName = Object.keys(files).find(name => /Water_Assembly\.txt$/.test(name))!
  expect(new TextDecoder().decode(files[guideName])).toContain('underside sockets')
  expect(waterRequests).toBeGreaterThanOrEqual(2)
  await expect(downloadButton).toBeEnabled()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await waterToggle.click()
  await page.getByRole('button', { name: 'Preview & export STL' }).click()
  await expect(downloadButton).toBeEnabled({ timeout: 60_000 })
  await expect(page.locator('.terrain-preview__water')).toHaveCount(0)
  expect(errors).toEqual([])
})
