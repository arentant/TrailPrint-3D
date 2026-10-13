import { test, expect } from './authenticated'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { unzipSync } from 'fflate'
import { analyzeMesh } from '../../shared/utils/mesh-manifold'
import { computeTerrainAssemblyOffsetZMm } from '../../shared/utils/assembly-layout'
import type { AppConfig } from '../../shared/types/config'
import type { TrayGenerateResponse } from '../../shared/types/tray'

test('base text reaches the preview and downloaded STL, and updates when edited', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/elevation', async route => {
    const { cols, rows } = route.request().postDataJSON()
    const values = Buffer.alloc(cols * rows * 4)
    for (let i = 0; i < cols * rows; i++) values.writeFloatLE(500 + 20 * Math.sin(i % cols / cols * Math.PI), i * 4)
    await route.fulfill({ contentType: 'application/octet-stream', body: values })
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page.getByLabel('Terrain and base fit')).toContainText('0.20 mm')
  await expect(page.getByLabel('Terrain and base fit')).toContainText('flush with the rim')
  await page.getByPlaceholder('Paste your API key').fill('browser-test-key')
  await page.getByRole('button', { name: 'Standard', exact: true }).click()
  await page.getByRole('switch', { name: 'Text on base', exact: true }).click()
  await page.getByRole('textbox', { name: 'Base label 1', exact: true }).fill('SNOWDON')
  await page.getByRole('button', { name: '+ Add label', exact: true }).click()
  await page.getByRole('textbox', { name: 'Base label 2', exact: true }).fill('154.80 km')
  await page.getByRole('combobox', { name: 'Label 2 position', exact: true }).selectOption('2')
  await page.getByRole('spinbutton', { name: 'Text relief', exact: true }).fill('0.8')
  await page.evaluate(() => {
    const generate = window.trailPrint.generateTray
    window.trailPrint.generateTray = async request => {
      const response = await generate(request)
      Object.assign(window, { textPreview: { config: request.config, response } })
      return response
    }
  })
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'))
  await expect(page.locator('.sidebar__status')).toContainText('Imported')
  await page.getByRole('button', { name: 'Preview & export STL' }).click()
  const downloadButton = page.getByRole('button', { name: 'Download', exact: true })
  await expect(downloadButton).toBeEnabled({ timeout: 60_000 })
  await page.screenshot({ path: 'test-results/base-text-preview.png', fullPage: true })
  const preview = await page.evaluate(() => (window as unknown as {
    textPreview: { config: AppConfig; response: TrayGenerateResponse }
  }).textPreview)
  expect(preview.config.tray.text.labels).toEqual([{ text: 'SNOWDON', edge: 0 }, { text: '154.80 km', edge: 2 }])
  expect(analyzeMesh(preview.response.mesh).boundaryEdges).toBe(0)
  const z = preview.response.mesh.positions.filter((_, i) => i % 3 === 2)
  expect(Math.max(...z)).toBe(5.8)
  expect(-preview.config.terrain.baseSolidThicknessMm + computeTerrainAssemblyOffsetZMm(preview.config)).toBe(3)
  const event = page.waitForEvent('download', { timeout: 90_000 })
  await downloadButton.click()
  const files = unzipSync(await readFile((await (await event).path())!))
  const baseName = Object.keys(files).find(name => name.endsWith('_Tray_Base.stl'))!
  const bytes = files[baseName]!, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let top = -Infinity
  for (let t = 0; t < view.getUint32(80, true); t++) for (let v = 0; v < 3; v++) {
    top = Math.max(top, view.getFloat32(84 + t * 50 + 12 + v * 12 + 8, true))
  }
  expect(top).toBeCloseTo(5, 5)
  expect(view.getUint32(80, true)).toBe(preview.response.mesh.baseMesh!.indices.length / 3)
  expect(Object.keys(files).some(name => name.endsWith('_Tray_Text.stl'))).toBe(true)
  expect(Object.keys(files).some(name => name.endsWith('_Tray_AMS.3mf'))).toBe(true)
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('textbox', { name: 'Base label 1', exact: true }).fill('RIDGE')
  await expect.poll(() => page.evaluate(() => (window as unknown as {
    textPreview: { config: AppConfig }
  }).textPreview.config.tray.text.labels[0]!.text)).toBe('RIDGE')
  expect(errors).toEqual([])
})

test('text presets persist, old presets load, and invalid labels give useful errors', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByRole('switch', { name: 'Text on base', exact: true }).click()
  await page.getByRole('textbox', { name: 'Base label 1', exact: true }).fill('Արագած և Արարատ')
  await page.getByRole('spinbutton', { name: 'Text size', exact: true }).fill('6')
  await page.getByRole('button', { name: 'Save preset', exact: true }).click()
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Labelled base')
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
  await page.reload()
  async function applyPreset() {
    await page.getByTitle('Apply a saved preset', { exact: true }).click()
    await page.getByRole('button', { name: /Labelled base/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click()
  }
  await applyPreset()
  await expect(page.getByRole('textbox', { name: 'Base label 1', exact: true })).toHaveValue('Արագած և Արարատ')
  await expect(page.getByRole('spinbutton', { name: 'Text size', exact: true })).toHaveValue('6')
  await page.getByRole('textbox', { name: 'Base label 1', exact: true }).fill('TRAIL 🏔')
  await expect(page.locator('.error').filter({ hasText: 'font does not support' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Base label 1', exact: true }).fill('Արագած և Արարատ')
  await page.getByRole('button', { name: '+ Add label', exact: true }).click()
  await page.getByRole('textbox', { name: 'Base label 2', exact: true }).fill('42 km')
  await page.getByRole('combobox', { name: 'Label 2 position', exact: true }).selectOption('0')
  await expect(page.locator('.error').filter({ hasText: 'different edge' })).toBeVisible()
  await page.getByRole('button', { name: 'Remove label 2', exact: true }).click()
  await page.screenshot({ path: 'test-results/base-text-settings.png', fullPage: true })
  await page.evaluate(() => {
    const presets = JSON.parse(localStorage.getItem('trailprint.configSchemes')!)
    delete presets[0].payload.tray.text
    localStorage.setItem('trailprint.configSchemes', JSON.stringify(presets))
  })
  await page.reload()
  await applyPreset()
  await expect(page.getByRole('switch', { name: 'Text on base', exact: true })).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('switch', { name: 'Text on base', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Base label 1', exact: true })).toHaveValue('')
  expect(await page.locator('.sidebar').evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0)
})
