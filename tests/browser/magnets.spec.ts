import { test, expect } from './authenticated'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { unzipSync } from 'fflate'
import { computeTrayFootprint } from '../../shared/utils/tray-footprint'
import { computeTrayBottomMagnetHoles } from '../../shared/utils/magnet-hole-layout'
import type { AppConfig } from '../../shared/types/config'
import type { TrayGenerateResponse } from '../../shared/types/tray'

test('magnet shape and sizes reach preview and the downloaded STL with clearance', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/elevation', async route => {
    const { cols, rows } = route.request().postDataJSON()
    const values = Buffer.alloc(cols * rows * 4)
    for (let i = 0; i < cols * rows; i++) values.writeFloatLE(500 + i % cols, i * 4)
    await route.fulfill({ contentType: 'application/octet-stream', body: values })
  })
  await page.goto('/')
  await page.getByPlaceholder('Paste your API key').fill('browser-test-key')
  await page.getByRole('button', { name: 'Standard', exact: true }).click()
  await page.getByRole('switch', { name: 'Underside magnet holes', exact: true }).click()
  const shapes = page.getByRole('group', { name: 'Magnet hole shape', exact: true })
  await expect(shapes.getByRole('button', { name: 'Round', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await shapes.getByRole('button', { name: 'Rectangle', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Magnet length', exact: true }).fill('8')
  await page.getByRole('spinbutton', { name: 'Magnet width', exact: true }).fill('4')
  await page.getByRole('spinbutton', { name: 'Magnet thickness', exact: true }).fill('1.5')
  await page.getByRole('spinbutton', { name: 'Magnet hole clearance', exact: true }).fill('0.2')
  for (const guide of ['magnetShape', 'magnetLength', 'magnetWidth']) {
    await page.locator(`[data-setting-guide="${guide}"] button`).click()
    await expect(page.getByRole('tooltip').getByRole('img')).toBeVisible()
    await page.keyboard.press('Escape')
  }
  await page.screenshot({ path: 'test-results/magnet-rectangle-settings.png', fullPage: true })
  await page.evaluate(() => {
    const generate = window.trailPrint.generateTray
    window.trailPrint.generateTray = async request => {
      const response = await generate(request)
      Object.assign(window, { magnetPreview: { config: request.config, response } })
      return response
    }
  })
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'))
  await expect(page.locator('.sidebar__status')).toContainText('Imported')

  for (const [shape, expectedX, expectedY, depth, shapeName, size] of [
    ['rectangle', 8.4, 4.4, 1.7, 'rectangle', '8x4x1.5'],
    ['hexagon', 10.2, 10.2 / Math.cos(Math.PI / 6), 1.1, 'hexagon', '10x1'],
  ] as const) {
    if (shape === 'hexagon') {
      await shapes.getByRole('button', { name: 'Hexagon', exact: true }).click()
      await page.getByRole('spinbutton', { name: 'Magnet width across flats', exact: true }).fill('10')
      await page.getByRole('spinbutton', { name: 'Magnet thickness', exact: true }).fill('1')
      await page.getByRole('spinbutton', { name: 'Magnet hole clearance', exact: true }).fill('0.1')
      await expect(page.getByRole('spinbutton', { name: 'Magnet length', exact: true })).toHaveCount(0)
      await page.locator('[data-setting-guide="magnetAcrossFlats"] button').click()
      await expect(page.getByRole('tooltip')).toContainText('Measure between two opposite flat faces.')
      expect(await page.locator('.sidebar').evaluate(el => ({
        scrollLeft: el.scrollLeft, overflow: el.scrollWidth - el.clientWidth,
      }))).toEqual({ scrollLeft: 0, overflow: 0 })
      await page.screenshot({ path: 'test-results/magnet-hexagon-guide.png', fullPage: true })
      await page.keyboard.press('Escape')
    }
    await page.getByRole('button', { name: 'Preview & export STL' }).click()
    const downloadButton = page.getByRole('button', { name: 'Download', exact: true })
    await expect(downloadButton).toBeEnabled({ timeout: 60_000 })
    const preview = await page.evaluate(() => (window as unknown as {
      magnetPreview: { config: AppConfig; response: TrayGenerateResponse }
    }).magnetPreview)
    expect(preview.config.assembly.magnet.shape).toBe(shape)
    const holes = computeTrayBottomMagnetHoles(preview.config, computeTrayFootprint(preview.config))
    expect(holes).toHaveLength(3)
    const event = page.waitForEvent('download', { timeout: 90_000 })
    await downloadButton.click()
    const download = await event
    const stem = `sample-trail_circle_R60mm_mesh-standard_magnets-on-${shapeName}-${size}mm`
    expect(download.suggestedFilename()).toBe(`${stem}.zip`)
    const files = unzipSync(await readFile((await download.path())!))
    expect(Object.keys(files)).toHaveLength(3)
    const bytes = files[`${stem}_Tray_Base.stl`]!
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const exported: number[][] = []
    for (let t = 0; t < view.getUint32(80, true); t++) for (let v = 0; v < 3; v++) {
      const offset = 84 + t * 50 + 12 + v * 12
      exported.push([view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)])
    }
    for (const hole of holes) {
      const nearHole = (p: number[]) => Math.abs(p[2] - depth) < 1e-5 && Math.hypot(p[0] - hole.x, p[1] - hole.y) < 10
      const previewPoints: number[][] = []
      const positions = preview.response.mesh.positions
      for (let i = 0; i < positions.length; i += 3) previewPoints.push(positions.slice(i, i + 3))
      for (const points of [previewPoints.filter(nearHole), exported.filter(nearHole)]) {
        expect(points.length).toBeGreaterThan(3)
        const span = (axis: number) => Math.max(...points.map(p => p[axis])) - Math.min(...points.map(p => p[axis]))
        expect(span(0)).toBeCloseTo(expectedX, 4)
        expect(span(1)).toBeCloseTo(expectedY, 4)
      }
    }
    await expect(downloadButton).toBeEnabled()
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
  }
  expect(errors).toEqual([])
})

test('presets retain magnet shape and size; older presets load as round pockets', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('switch', { name: 'Underside magnet holes', exact: true }).click()
  const shapes = page.getByRole('group', { name: 'Magnet hole shape', exact: true })
  await shapes.getByRole('button', { name: 'Rectangle', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Magnet length', exact: true }).fill('9')
  await page.getByRole('spinbutton', { name: 'Magnet width', exact: true }).fill('5')
  await page.getByRole('button', { name: 'Save preset', exact: true }).click()
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Rectangular magnets')
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
  await page.reload()
  await page.getByTitle('Apply a saved preset', { exact: true }).click()
  await page.getByRole('button', { name: /Rectangular magnets/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(shapes.getByRole('button', { name: 'Rectangle', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('spinbutton', { name: 'Magnet length', exact: true })).toHaveValue('9')
  await expect(page.getByRole('spinbutton', { name: 'Magnet width', exact: true })).toHaveValue('5')

  await page.evaluate(() => {
    const presets = JSON.parse(localStorage.getItem('trailprint.configSchemes')!)
    delete presets[0].payload.assembly.magnet.shape
    delete presets[0].payload.assembly.magnet.lengthMm
    delete presets[0].payload.assembly.magnet.widthMm
    presets[0].payload.assembly.magnet.diameterMm = 8
    localStorage.setItem('trailprint.configSchemes', JSON.stringify(presets))
  })
  await page.reload()
  await page.getByTitle('Apply a saved preset', { exact: true }).click()
  await page.getByRole('button', { name: /Rectangular magnets/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(shapes.getByRole('button', { name: 'Round', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('spinbutton', { name: 'Magnet diameter', exact: true })).toHaveValue('8')
  await shapes.getByRole('button', { name: 'Rectangle', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'Magnet length', exact: true })).toHaveValue('6')
  await expect(page.getByRole('spinbutton', { name: 'Magnet width', exact: true })).toHaveValue('4')
})
