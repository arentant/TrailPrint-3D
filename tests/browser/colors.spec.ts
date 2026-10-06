import type { Page } from '@playwright/test';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { ConfigScheme } from '../../shared/types/config';
import { compactCityMap } from '../city-fixture.mjs';
import { test, expect } from './authenticated';

test.beforeEach(async ({ page }) => {
  await page.route(/arcgisonline\.com|autonavi\.com/, route => route.fulfill({
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64'),
  }));
});

async function savePreset(page: Page, name: string): Promise<ConfigScheme> {
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Preset name', exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  return page.evaluate(presetName => {
    const schemes = JSON.parse(localStorage.getItem('trailprint.configSchemes')!) as ConfigScheme[];
    return schemes.find(scheme => scheme.name === presetName)!;
  }, name);
}

async function applyPreset(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /^Presets/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('map colors apply after editing, validate hex input, and restore modern and legacy presets', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'));
  const track = page.locator('.leaflet-interactive');
  await expect(track).toBeVisible();
  const panel = page.locator('.map-colors');
  await panel.locator('summary').click();
  const trail = panel.getByRole('textbox', { name: 'Trail color', exact: true });
  await trail.fill('#1268D2');
  await panel.getByRole('textbox', { name: 'Terrain color', exact: true }).fill('#c6a6ef');
  await panel.getByRole('textbox', { name: 'Tray color', exact: true }).fill('#202020');
  await expect(track).toHaveAttribute('stroke', '#1268d2');
  await expect(panel.getByLabel('Trail color picker', { exact: true })).toHaveValue('#1268d2');
  await trail.fill('invalid');
  await trail.press('Tab');
  await expect(trail).toHaveValue('#1268d2');
  await expect(track).toHaveAttribute('stroke', '#1268d2');
  const saved = await savePreset(page, 'Custom palette');
  expect(saved.payload.colors).toEqual({ terrain: '#c6a6ef', trail: '#1268d2', tray: '#202020' });
  await panel.getByRole('button', { name: 'Reset colors', exact: true }).click();
  await expect(track).toHaveAttribute('stroke', '#e84335');
  await savePreset(page, 'Legacy palette');
  await applyPreset(page, 'Custom palette');
  await expect(track).toHaveAttribute('stroke', '#1268d2');
  await page.screenshot({ path: 'test-results/map-colors.png', fullPage: true });

  await page.evaluate(() => {
    const schemes = JSON.parse(localStorage.getItem('trailprint.configSchemes')!) as ConfigScheme[];
    delete schemes.find(scheme => scheme.name === 'Legacy palette')!.payload.colors;
    localStorage.setItem('trailprint.configSchemes', JSON.stringify(schemes));
  });
  await page.reload();
  await page.locator('.map-colors summary').click();
  await applyPreset(page, 'Custom palette');
  await expect(trail).toHaveValue('#1268d2');
  await applyPreset(page, 'Legacy palette');
  await expect(trail).toHaveValue('#e84335');
  await expect(panel.getByRole('textbox', { name: 'Terrain color', exact: true })).toHaveValue('#f3ead6');
  expect(errors).toEqual([]);
});

test('color edits wait one second after the last input and reset cancels pending changes', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'));
  const track = page.locator('.leaflet-interactive');
  await expect(track).toBeVisible();
  await page.waitForLoadState('networkidle');
  const panel = page.locator('.map-colors');
  await panel.locator('summary').click();
  const trail = panel.getByRole('textbox', { name: 'Trail color', exact: true });
  const picker = panel.getByLabel('Trail color picker', { exact: true });
  // Vue ignores synthetic events timestamped before their listeners were attached.
  const time = new Date(Date.now() + 60_000);
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 1000));

  await trail.fill('#1268d2');
  await expect(trail).toHaveValue('#1268d2');
  await expect(picker).toHaveValue('#1268d2');
  await expect(track).toHaveAttribute('stroke', '#e84335');
  await page.clock.runFor(600);
  await trail.fill('#00cc44');
  await page.clock.runFor(999);
  await expect(track).toHaveAttribute('stroke', '#e84335');
  await page.clock.runFor(1);
  await expect(track).toHaveAttribute('stroke', '#00cc44');

  // Native picker input follows the same delay as the hex field.
  await picker.evaluate((element: HTMLInputElement) => {
    element.value = '#1268d2';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.clock.runFor(999);
  await expect(track).toHaveAttribute('stroke', '#00cc44');
  await page.clock.runFor(1);
  await expect(track).toHaveAttribute('stroke', '#1268d2');
  await trail.fill('#ff00ff');
  await page.clock.runFor(600);
  await panel.getByRole('button', { name: 'Reset colors', exact: true }).click();
  await expect(track).toHaveAttribute('stroke', '#e84335');
  await page.clock.runFor(1000);
  await expect(track).toHaveAttribute('stroke', '#e84335');
});

test('Mountain and City palettes remain independent when switching workspaces', async ({ page }) => {
  await page.goto('/');
  await page.locator('.map-colors summary').click();
  const panel = page.locator('.map-colors');
  await panel.getByRole('textbox', { name: 'Trail color', exact: true }).fill('#1268d2');
  await panel.getByRole('textbox', { name: 'Terrain color', exact: true }).fill('#c6a6ef');
  await page.getByRole('button', { name: 'City', exact: true }).click();
  await panel.locator('summary').click();
  await expect(panel.getByRole('textbox', { name: 'City base color', exact: true })).toHaveValue('#bfc8bd');
  await expect(panel.getByRole('textbox', { name: 'Tray color', exact: true })).toHaveCount(0);
  await panel.getByRole('textbox', { name: 'Trail color', exact: true }).fill('#00cc44');
  await panel.getByRole('textbox', { name: 'City base color', exact: true }).fill('#7474ee');
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/city-run.gpx'));
  await expect(page.locator('.leaflet-interactive')).toHaveAttribute('stroke', '#00cc44');
  await page.getByRole('button', { name: 'Mountain', exact: true }).click();
  await panel.locator('summary').click();
  await expect(panel.getByRole('textbox', { name: 'Trail color', exact: true })).toHaveValue('#1268d2');
  await expect(panel.getByRole('textbox', { name: 'Terrain color', exact: true })).toHaveValue('#c6a6ef');
  await page.getByRole('button', { name: 'City', exact: true }).click();
  await panel.locator('summary').click();
  await expect(panel.getByRole('textbox', { name: 'Trail color', exact: true })).toHaveValue('#00cc44');
  await panel.getByRole('button', { name: 'Reset colors', exact: true }).click();
  await expect(page.locator('.leaflet-interactive')).toHaveAttribute('stroke', '#e84335');
});

test('Mountain and City preview colors update without regenerating geometry', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/elevation', async route => {
    const { cols, rows } = route.request().postDataJSON();
    const values = Buffer.alloc(cols * rows * 4);
    for (let i = 0; i < cols * rows; i++) values.writeFloatLE(500 + (i % cols) * 0.5, i * 4);
    await route.fulfill({ contentType: 'application/octet-stream', body: values });
  });
  const data = compactCityMap(JSON.parse(await readFile('fixtures/city-map.osm.json', 'utf8')));
  await page.route('**/api/city', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) }));
  await page.goto('/');
  await page.getByPlaceholder('Paste your API key').fill('color-test-key');
  await page.getByRole('button', { name: 'Standard', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'));
  await expect(page.locator('.leaflet-interactive')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Preview & export STL', exact: true }).click();
  const mountainDialog = page.getByRole('dialog');
  const mountainDownload = mountainDialog.getByRole('button', { name: 'Download', exact: true });
  await expect(mountainDownload).toBeEnabled({ timeout: 60_000 });
  await page.evaluate(() => {
    const terrain = window.trailPrint.generateTerrain, city = window.trailPrint.generateCityModel;
    (window as any).__colorGenerations = 0;
    window.trailPrint.generateTerrain = request => { (window as any).__colorGenerations++; return terrain(request); };
    window.trailPrint.generateCityModel = request => { (window as any).__colorGenerations++; return city(request); };
  });
  const mountainCanvas = await mountainDialog.locator('canvas').elementHandle();
  await mountainDialog.getByRole('textbox', { name: 'Terrain color', exact: true }).fill('#7474ee');
  await mountainDialog.getByRole('textbox', { name: 'Trail color', exact: true }).fill('#00ff00');
  await mountainDialog.getByRole('textbox', { name: 'Tray color', exact: true }).fill('#202020');
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => (window as any).__colorGenerations)).toBe(0);
  expect(await mountainCanvas!.evaluate(node => node.isConnected)).toBe(true);
  await expect(mountainDownload).toBeEnabled();
  await page.screenshot({ path: 'test-results/mountain-colors.png', fullPage: true });
  await mountainDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.leaflet-interactive')).toHaveAttribute('stroke', '#00ff00');

  await page.getByRole('button', { name: 'City', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/city-run.gpx'));
  await expect(page.locator('.leaflet-interactive')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Preview & export City STL', exact: true }).click();
  const cityDialog = page.getByRole('dialog', { name: 'Your city run, in 3D' });
  const cityDownload = cityDialog.getByRole('button', { name: 'Download City ZIP', exact: true });
  await expect(cityDownload).toBeEnabled({ timeout: 60_000 });
  await page.evaluate(() => { (window as any).__colorGenerations = 0; });
  const cityCanvas = await cityDialog.locator('canvas').elementHandle();
  await cityDialog.getByRole('textbox', { name: 'City base color', exact: true }).fill('#7474ee');
  await cityDialog.getByRole('textbox', { name: 'Trail color', exact: true }).fill('#00ff00');
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => (window as any).__colorGenerations)).toBe(0);
  expect(await cityCanvas!.evaluate(node => node.isConnected)).toBe(true);
  await expect(cityDownload).toBeEnabled();
  await page.screenshot({ path: 'test-results/city-colors.png', fullPage: true });
  expect(errors).toEqual([]);
});
