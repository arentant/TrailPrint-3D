import { test, expect } from './authenticated';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMILU/6DwAEgQIuIhp1GQAAAABJRU5ErkJggg==', 'base64');
// Opt into the multi-GB regression with TRAILPRINT_STRESS_TEST=1.
const highResolution = process.env.TRAILPRINT_STRESS_TEST === '1';
test('natural snow preview controls download black and white printable terrain', async ({ page }) => {
  if (highResolution) test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/MapServer/tile/**', route => route.fulfill({ contentType: 'image/png', body: tile }));
  await page.route('**/api/elevation', async route => {
    const { cols, rows, sampleWindow } = route.request().postDataJSON();
    const rowCount = sampleWindow?.rowCount ?? rows, rowStart = sampleWindow?.rowStart ?? 0;
    const values = Buffer.alloc(cols * rowCount * 4);
    for (let i = 0; i < cols * rowCount; i++) {
      const x = (i % cols) / (cols - 1) * 2 - 1, y = (Math.floor(i / cols) + rowStart) / (rows - 1) * 2 - 1;
      values.writeFloatLE(500 + 3000 * Math.exp(-3 * (x * x + y * y)), i * 4);
    }
    await route.fulfill({ contentType: 'application/octet-stream', body: values });
  });
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await page.getByPlaceholder('Paste your API key').fill('browser-test-key');
  await page.getByRole('button', { name: highResolution ? 'Custom' : 'Standard', exact: true }).click();
  if (highResolution) await page.getByRole('spinbutton', { name: 'DEM grid limit per side', exact: true }).fill('1536');
  await page.getByRole('spinbutton', { name: 'Base thickness', exact: true }).fill('3');
  await page.getByRole('button', { name: 'Preview & export STL', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const download = dialog.getByRole('button', { name: 'Download model 3MF', exact: true });
  await expect(download).toBeEnabled({ timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Natural snow', exact: true }).click();
  const snowline = dialog.getByRole('slider', { name: 'Snowline height' });
  await expect(snowline).toHaveValue('50');
  await snowline.fill('60');
  await expect(dialog.getByText('Snow starts at 60% height')).toBeVisible();
  await dialog.getByRole('button', { name: 'Reset regions', exact: true }).click();
  await expect(snowline).toHaveValue('60');
  await page.screenshot({ path: '.context/natural-snow-preview.png', fullPage: true });
  const event = page.waitForEvent('download', { timeout: highResolution ? 180_000 : 30_000 });
  await download.click();
  const file = await event;
  expect(file.suggestedFilename()).toMatch(/_Model\.3mf$/);
  if (highResolution) expect(file.suggestedFilename()).toContain('mesh-custom1536');
  const files = unzipSync(await readFile((await file.path())!));
  const xml = strFromU8(files['3D/3dmodel.model']!);
  expect(xml).toContain('#000000FF'); expect(xml).toContain('#FFFFFFFF');
  expect(xml).toContain('Terrain — black rock'); expect(xml).toContain('Terrain — snow');
  const objects = [...xml.matchAll(/<object[^>]*name="Terrain — [^"]*"[^>]*>([\s\S]*?)<\/object>/g)];
  expect(objects).toHaveLength(2);
  for (const object of objects) expect(object[1]).toContain('<triangle ');
  await expect(download).toBeEnabled();
  expect(errors).toEqual([]);
});
