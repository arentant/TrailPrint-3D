import { test, expect } from './authenticated'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'

test('preview can be closed, adjusted, reopened, and exported repeatedly', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/elevation', async (route) => {
    const { cols, rows } = route.request().postDataJSON()
    const values = Buffer.alloc(cols * rows * 4)
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      values.writeFloatLE(500 + row * 0.5 + 30 * Math.sin(col / cols * Math.PI), (row * cols + col) * 4)
    }
    await route.fulfill({ contentType: 'application/octet-stream', body: values })
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByPlaceholder('Paste your API key').fill('browser-test-key')
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'))
  await expect(page.locator('.sidebar__status')).toContainText('Imported')
  const open = page.getByRole('button', { name: 'Preview & export STL' })
  const download = page.getByRole('button', { name: 'Download', exact: true })
  for (const [index, smoothing] of ['Light', 'Medium', 'Raw'].entries()) {
    await open.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(download).toBeEnabled({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.getByRole('button', { name: smoothing, exact: true }).click()
    await page.getByRole('spinbutton', { name: 'Base thickness' }).fill(String(3 + index))
    // Closing during a rebuild used to resume against disposed Three.js roots.
    await open.click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    expect(errors).toEqual([])
  }
  await open.click()
  await expect(download).toBeEnabled({ timeout: 30_000 })
  const downloadEvent = page.waitForEvent('download')
  await download.click()
  const firstDownload = await downloadEvent
  expect(firstDownload.suggestedFilename()).toBe('sample-trail.zip')
  const firstZip = await readFile((await firstDownload.path())!)
  await expect(download).toBeEnabled()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('spinbutton', { name: 'Base thickness' }).fill('6')
  await open.click()
  await expect(download).toBeEnabled({ timeout: 30_000 })
  const nextDownload = page.waitForEvent('download')
  await download.click()
  const secondZip = await readFile((await (await nextDownload).path())!)
  expect(unzipSync(secondZip)['sample-trail_Terrain_Main.stl']).not.toEqual(unzipSync(firstZip)['sample-trail_Terrain_Main.stl'])
  await expect(download).toBeEnabled()
  expect(errors).toEqual([])
})
