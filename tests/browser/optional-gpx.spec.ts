import { test, expect } from './authenticated';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { compactCityMap } from '../city-fixture.mjs';

const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMILU/6DwAEgQIuIhp1GQAAAABJRU5ErkJggg==', 'base64');
test.beforeEach(async ({ page }) => {
  await page.route('**/MapServer/tile/**', route => route.fulfill({ contentType: 'image/png', body: tile }));
});

test('base toggle persists in presets and legacy presets default to off', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('switch', { name: 'Generate base', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  async function save(name: string) {
    await page.getByRole('button', { name: 'Save preset', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Preset name', exact: true }).fill(name);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  async function apply(name: string) {
    await page.getByTitle('Apply a saved preset', { exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: new RegExp(name) }).click();
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  await save('Without base');
  await toggle.click();
  await page.getByRole('spinbutton', { name: 'Total thickness', exact: true }).fill('6');
  await save('With base');
  await apply('Without base');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await apply('With base');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('spinbutton', { name: 'Total thickness', exact: true })).toHaveValue('6');
  await page.evaluate(() => {
    const presets = JSON.parse(localStorage.getItem('trailprint.configSchemes')!);
    delete presets.find((preset: { name: string }) => preset.name === 'With base').payload.tray.enabled;
    localStorage.setItem('trailprint.configSchemes', JSON.stringify(presets));
  });
  await page.reload();
  await apply('With base');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(page.getByRole('spinbutton', { name: 'Total thickness', exact: true })).toHaveValue('6');
});

test('Mountain previews and exports the selected area without GPX, then allows adding and removing a track', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/elevation', async route => {
    const { cols, rows } = route.request().postDataJSON();
    const values = Buffer.alloc(cols * rows * 4);
    for (let i = 0; i < cols * rows; i++) values.writeFloatLE(500 + i % cols, i * 4);
    await route.fulfill({ contentType: 'application/octet-stream', body: values });
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('switch', { name: 'Generate base', exact: true })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('Choose a place on the map', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Grid off', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const generate = window.trailPrint.generateTray;
    Object.assign(window, { baseGenerations: 0 });
    window.trailPrint.generateTray = request => {
      (window as unknown as { baseGenerations: number }).baseGenerations++;
      return generate(request);
    };
  });
  await page.getByPlaceholder('Paste your API key').fill('test-key');
  await page.getByRole('button', { name: 'Standard', exact: true }).click();
  await page.getByRole('button', { name: 'Preview & export STL', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const download = dialog.getByRole('button', { name: 'Download', exact: true });
  await expect(download).toBeEnabled({ timeout: 60_000 });
  await expect(dialog.getByRole('button', { name: 'Download trail STL', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'test-results/terrain-without-gpx.png', fullPage: true });
  const event = page.waitForEvent('download');
  await download.click();
  const artifact = await event;
  expect(artifact.suggestedFilename()).toMatch(/^TrailPrint_.*\.zip$/);
  const files = unzipSync(await readFile((await artifact.path())!));
  const stls = Object.keys(files).filter(name => name.endsWith('.stl'));
  expect(stls.some(name => name.endsWith('_Terrain_Main.stl'))).toBe(true);
  expect(stls.some(name => name.endsWith('_Tray_Base.stl'))).toBe(false);
  expect(stls.some(name => name.endsWith('_Trail_Line.stl'))).toBe(false);
  expect(await page.evaluate(() => (window as unknown as { baseGenerations: number }).baseGenerations)).toBe(0);
  await expect(download).toBeEnabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('switch', { name: 'Generate base', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Total thickness', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preview & export STL', exact: true }).click();
  await expect(download).toBeEnabled({ timeout: 60_000 });
  await expect(dialog.getByText('With tray', { exact: true })).toBeVisible();
  const baseEvent = page.waitForEvent('download');
  await download.click();
  const baseArtifact = await baseEvent;
  const baseFiles = unzipSync(await readFile((await baseArtifact.path())!));
  expect(Object.keys(baseFiles).some(name => name.endsWith('_Tray_Base.stl'))).toBe(true);
  await expect(download).toBeEnabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('switch', { name: 'Generate base', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Total thickness', exact: true })).toBeHidden();
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'));
  await expect(page.locator('.gpx-summary__title')).not.toHaveText('Choose a place on the map');
  await expect(page.locator('.sidebar').getByRole('button', { name: 'Download trail STL', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Remove GPX', exact: true }).click();
  await expect(page.locator('.sidebar').getByRole('button', { name: 'Download trail STL', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Preview & export STL', exact: true }).click();
  await expect(download).toBeEnabled({ timeout: 60_000 });
  await expect(dialog.getByText('With tray', { exact: true })).toBeHidden();
  expect(errors).toEqual([]);
});

test('City previews and exports without GPX and offers map pictures while trail download is disabled', async ({ page }) => {
  const data = compactCityMap(JSON.parse(await readFile('fixtures/city-map.osm.json', 'utf8')));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let elevations = 0;
  await page.route('**/api/city', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) }));
  await page.route('**/api/elevation', route => { elevations++; return route.fulfill({ status: 502 }); });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'City', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview & export map picture', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Download trail STL', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Preview & export City STL', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Your city, in 3D' });
  const download = dialog.getByRole('button', { name: 'Download City ZIP', exact: true });
  await expect(download).toBeEnabled({ timeout: 60_000 });
  await expect(dialog.getByRole('button', { name: 'Download trail STL', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'test-results/city-without-gpx.png', fullPage: true });
  const event = page.waitForEvent('download');
  await download.click();
  const artifact = await event;
  const files = unzipSync(await readFile((await artifact.path())!));
  expect(Object.keys(files).filter(name => name.endsWith('.stl'))).toHaveLength(1);
  expect(Object.keys(files).some(name => name.endsWith('_City_Main.stl'))).toBe(true);
  await expect(download).toBeEnabled();
  await dialog.getByRole('button', { name: 'Preview map picture', exact: true }).click();
  const picture = page.getByRole('dialog', { name: 'Your run. On paper.' });
  await picture.getByRole('button', { name: 'Map only', exact: true }).click();
  const pictureEvent = page.waitForEvent('download');
  await picture.getByRole('button', { name: 'Download SVG', exact: true }).click();
  const svg = await readFile((await (await pictureEvent).path())!, 'utf8');
  expect(svg).toContain('id="street-map"');
  expect(svg).not.toMatch(/id="running-route"[^>]*><path/);
  await picture.getByRole('button', { name: 'Close picture preview', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/city-run.gpx'));
  await expect(page.getByRole('button', { name: 'Download trail STL', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Remove GPX', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download trail STL', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Preview & export City STL', exact: true }).click();
  await expect(download).toBeEnabled({ timeout: 60_000 });
  expect(elevations).toBe(0);
  expect(errors).toEqual([]);
});
