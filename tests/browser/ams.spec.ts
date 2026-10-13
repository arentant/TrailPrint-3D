import { test, expect } from './authenticated'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'

test('text has an independent preview color and AMS download preserves the latest edit', async ({ page }) => {
  const errors: string[] = []
  let elevationRequests = 0
  page.on('pageerror', error => errors.push(error.message))
  await page.route(/arcgisonline\.com|autonavi\.com/, route => route.fulfill({
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64'),
  }))
  await page.route('**/api/elevation', async route => {
    elevationRequests++
    const { cols, rows } = route.request().postDataJSON()
    const values = Buffer.alloc(cols * rows * 4)
    for (let i = 0; i < cols * rows; i++) values.writeFloatLE(500 + (i % cols) * 0.5, i * 4)
    await route.fulfill({ contentType: 'application/octet-stream', body: values })
  })
  await page.goto('/')
  await page.getByPlaceholder('Paste your API key').fill('ams-test-key')
  await page.getByRole('button', { name: 'Standard', exact: true }).click()
  await page.getByRole('switch', { name: 'Text on base', exact: true }).click()
  await page.getByRole('textbox', { name: 'Base label 1', exact: true }).fill('Արագած 4090մ ↑')
  await page.getByRole('combobox', { name: 'Label 1 position', exact: true }).selectOption('2')
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'))
  await expect(page.locator('.sidebar__status')).toContainText('Imported')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Preview & export STL', exact: true }).click()
  const dialog = page.getByRole('dialog'), download = dialog.getByRole('button', { name: 'Download base for AMS', exact: true })
  await expect(download).toBeEnabled({ timeout: 60_000 })
  await page.evaluate(() => {
    const terrain = window.trailPrint.generateTerrain, tray = window.trailPrint.generateTray
    Object.assign(window, { amsGenerations: 0 })
    window.trailPrint.generateTerrain = request => { (window as any).amsGenerations++; return terrain(request) }
    window.trailPrint.generateTray = request => { (window as any).amsGenerations++; return tray(request) }
  })
  const canvas = await dialog.locator('canvas').elementHandle()
  await dialog.getByRole('textbox', { name: 'Tray color', exact: true }).fill('#202020')
  await dialog.getByRole('textbox', { name: 'Text color', exact: true }).fill('#ffcc00')
  await expect(dialog.getByLabel('Text color picker', { exact: true })).toHaveValue('#ffcc00')
  await expect(dialog.locator('.model-colors__delay')).toHaveAttribute('aria-busy', 'false')
  expect(await page.evaluate(() => (window as any).amsGenerations)).toBe(0)
  expect(await canvas!.evaluate(node => node.isConnected)).toBe(true)
  await page.screenshot({ path: 'test-results/ams-text-colors.png', fullPage: true })

  // Export immediately, before the usual one-second color debounce.
  const beforeElevation = elevationRequests
  await dialog.getByRole('textbox', { name: 'Text color', exact: true }).fill('#ff8800')
  const event = page.waitForEvent('download', { timeout: 90_000 })
  await download.click()
  const file = await event
  expect(file.suggestedFilename()).toMatch(/_Tray_AMS\.3mf$/)
  const files = unzipSync(await readFile((await file.path())!))
  const model = strFromU8(files['3D/3dmodel.model']!), settings = strFromU8(files['Metadata/model_settings.config']!)
  expect(model).toContain('color="#202020FF"')
  expect(model).toContain('color="#FF8800FF"')
  expect(model).toContain('<item objectid="4"/>')
  expect(settings).toContain('name" value="Base"/><metadata key="extruder" value="1"')
  expect(settings).toContain('name" value="Text"/><metadata key="extruder" value="2"')
  expect(elevationRequests).toBe(beforeElevation)
  expect(await page.evaluate(() => (window as any).amsGenerations)).toBe(0)
  expect(errors).toEqual([])
})
