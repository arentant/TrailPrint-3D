import { test, expect } from './authenticated'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { unzipSync } from 'fflate'
import { computeTrayFootprint } from '../../shared/utils/tray-footprint'
import { computeTrayKeychainHole } from '../../shared/utils/tray-keychain-layout'
import { analyzeMesh } from '../../shared/utils/mesh-manifold'
import type { AppConfig } from '../../shared/types/config'
import type { TrayGenerateResponse } from '../../shared/types/tray'

type Preview = { config: AppConfig; response: TrayGenerateResponse }

function verticalRayHits(positions: number[], indices: number[], x: number, y: number): number {
  let hits = 0
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = indices.slice(t, t + 3).map(i => positions.slice(i * 3, i * 3 + 3))
    const area = (b![0]! - a![0]!) * (c![1]! - a![1]!) - (b![1]! - a![1]!) * (c![0]! - a![0]!)
    if (Math.abs(area) < 1e-8) continue
    const u = ((x - a![0]!) * (c![1]! - a![1]!) - (y - a![1]!) * (c![0]! - a![0]!)) / area
    const v = ((b![0]! - a![0]!) * (y - a![1]!) - (b![1]! - a![1]!) * (x - a![0]!)) / area
    if (u >= 0 && v >= 0 && u + v <= 1) hits++
  }
  return hits
}

test('keychain hole opens through the rim in the preview and STL and updates on edits', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/elevation', async route => {
    const { cols, rows } = route.request().postDataJSON()
    const values = Buffer.alloc(cols * rows * 4)
    for (let i = 0; i < cols * rows; i++) values.writeFloatLE(500 + 1500 * Math.sin(i % cols / cols * Math.PI), i * 4)
    await route.fulfill({ contentType: 'application/octet-stream', body: values })
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByPlaceholder('Paste your API key').fill('browser-test-key')
  await page.getByRole('button', { name: 'Standard', exact: true }).click()
  await page.getByRole('button', { name: 'Polygon', exact: true }).click()
  await page.getByRole('switch', { name: 'Text on base', exact: true }).click()
  await page.getByRole('textbox', { name: 'Base label 1', exact: true }).fill('B8O TRAIL')
  await page.getByRole('switch', { name: 'Keychain hole', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Keychain hole diameter', exact: true }).fill('4.5')
  await page.getByRole('combobox', { name: 'Keychain hole edge', exact: true }).selectOption('3')
  await page.getByRole('spinbutton', { name: 'Keychain hole offset', exact: true }).fill('6')
  await page.evaluate(() => {
    const generate = window.trailPrint.generateTray
    window.trailPrint.generateTray = async request => {
      const response = await generate(request)
      Object.assign(window, { keychainPreview: { config: request.config, response } })
      return response
    }
  })
  const preview = () => page.evaluate(() => (window as unknown as { keychainPreview: Preview }).keychainPreview)
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'))
  await expect(page.locator('.sidebar__status')).toContainText('Imported')
  await page.getByRole('button', { name: 'Preview & export STL' }).click()
  const downloadButton = page.getByRole('button', { name: 'Download', exact: true })
  await expect(downloadButton).toBeEnabled({ timeout: 60_000 })
  await expect(page.locator('.terrain-modal__loading')).toBeHidden()
  await page.screenshot({ path: 'test-results/keychain-preview.png', fullPage: true })
  const generated = await preview(), mesh = generated.response.mesh
  expect(generated.config.tray.keychain).toEqual({ enabled: true, diameterMm: 4.5, edge: 3, offsetMm: 6 })
  expect(analyzeMesh(mesh).boundaryEdges).toBe(0)
  const hole = computeTrayKeychainHole(computeTrayFootprint(generated.config), generated.config.tray)!
  expect(verticalRayHits(mesh.positions, mesh.indices, hole.center.x, hole.center.y)).toBe(0)
  const event = page.waitForEvent('download', { timeout: 90_000 })
  await downloadButton.click()
  const files = unzipSync(await readFile((await (await event).path())!))
  const bytes = files[Object.keys(files).find(name => name.endsWith('_Tray_Base.stl'))!]!
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), exported: number[] = []
  expect(view.getUint32(80, true)).toBe(mesh.baseMesh!.indices.length / 3)
  for (let t = 0; t < view.getUint32(80, true); t++) for (let v = 0; v < 3; v++) {
    const at = 84 + t * 50 + 12 + v * 12
    exported.push(view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true))
  }
  expect(verticalRayHits(exported, Array.from({ length: exported.length / 3 }, (_, i) => i), hole.center.x, hole.center.y)).toBe(0)
  for (const z of [0, generated.config.tray.totalThicknessMm]) {
    const ring: number[] = []
    for (let i = 0; i < exported.length; i += 3) {
      const radius = Math.hypot(exported[i]! - hole.center.x, exported[i + 1]! - hole.center.y)
      if (Math.abs(exported[i + 2]! - z) < 1e-5 && Math.abs(radius - hole.cutRadiusMm) < 1e-4) ring.push(radius)
    }
    expect(ring.length).toBeGreaterThanOrEqual(32)
  }
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Keychain hole diameter', exact: true }).fill('4')
  await page.getByRole('spinbutton', { name: 'Keychain hole offset', exact: true }).fill('-6')
  await expect.poll(async () => (await preview()).config.tray.keychain).toEqual({ enabled: true, diameterMm: 4, edge: 3, offsetMm: -6 })
  await page.getByRole('switch', { name: 'Keychain hole', exact: true }).click()
  await expect.poll(async () => (await preview()).config.tray.keychain.enabled).toBe(false)
  const disabled = await preview()
  const oldHole = computeTrayKeychainHole(computeTrayFootprint(generated.config), generated.config.tray)!
  expect(verticalRayHits(disabled.response.mesh.positions, disabled.response.mesh.indices, oldHole.center.x, oldHole.center.y)).toBeGreaterThanOrEqual(2)
  expect(errors).toEqual([])
})

test('keychain presets persist, old presets load disabled, and conflicts are explained', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByRole('switch', { name: 'Keychain hole', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Keychain hole diameter', exact: true }).fill('10')
  await expect(page.locator('.error').filter({ hasText: '2 mm of base material' })).toBeVisible()
  await page.getByRole('spinbutton', { name: 'Keychain hole diameter', exact: true }).fill('4')
  await page.getByRole('switch', { name: 'Text on base', exact: true }).click()
  await page.getByRole('textbox', { name: 'Base label 1', exact: true }).fill('TRAIL')
  await page.getByRole('combobox', { name: 'Keychain hole edge', exact: true }).selectOption('0')
  await expect(page.locator('.error').filter({ hasText: 'overlaps a base label' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Keychain hole edge', exact: true }).selectOption('1')
  await page.getByRole('spinbutton', { name: 'Keychain hole offset', exact: true }).fill('8')
  await page.screenshot({ path: 'test-results/keychain-settings.png', fullPage: true })
  await page.getByRole('button', { name: 'Save preset', exact: true }).click()
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Keychain base')
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
  await page.reload()
  async function applyPreset() {
    await page.getByTitle('Apply a saved preset', { exact: true }).click()
    await page.getByRole('button', { name: /Keychain base/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click()
  }
  await applyPreset()
  await expect(page.getByRole('switch', { name: 'Keychain hole', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('spinbutton', { name: 'Keychain hole diameter', exact: true })).toHaveValue('4')
  await expect(page.getByRole('spinbutton', { name: 'Keychain hole offset', exact: true })).toHaveValue('8')
  await page.evaluate(() => {
    const presets = JSON.parse(localStorage.getItem('trailprint.configSchemes')!)
    delete presets[0].payload.tray.keychain
    localStorage.setItem('trailprint.configSchemes', JSON.stringify(presets))
  })
  await page.reload()
  await applyPreset()
  await expect(page.getByRole('switch', { name: 'Keychain hole', exact: true })).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('switch', { name: 'Keychain hole', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'Keychain hole diameter', exact: true })).toHaveValue('4')
  await expect(page.getByRole('spinbutton', { name: 'Keychain hole offset', exact: true })).toHaveValue('0')
  expect(await page.locator('.sidebar').evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0)
})
