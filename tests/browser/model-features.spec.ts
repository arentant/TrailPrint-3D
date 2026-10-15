import { test, expect } from './authenticated';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { analyzeMesh } from '../../shared/utils/mesh-manifold';
import type { AppConfig } from '../../shared/types/config';
import type { TerrainGenerateResponse } from '../../shared/types/terrain';

type Preview = { config: AppConfig; response: TerrainGenerateResponse };
const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMILU/6DwAEgQIuIhp1GQAAAABJRU5ErkJggg==', 'base64');
test.beforeEach(async ({ page }) => {
  await page.route('**/MapServer/tile/**', route => route.fulfill({ contentType: 'image/png', body: tile }));
  await page.route('**/api/elevation', async route => {
    const { cols, rows } = route.request().postDataJSON();
    const values = Buffer.alloc(cols * rows * 4);
    for (let i = 0; i < cols * rows; i++) values.writeFloatLE(500 + 1000 * Math.sin(i % cols / cols * Math.PI), i * 4);
    await route.fulfill({ contentType: 'application/octet-stream', body: values });
  });
});

test('model text and direct hole reach the preview, STL and 3MF and update on edits', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await page.getByPlaceholder('Paste your API key').fill('browser-test-key');
  await page.getByRole('button', { name: 'Standard', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Base thickness', exact: true }).fill('3');
  await page.getByRole('switch', { name: 'Text on model', exact: true }).click();
  await page.getByRole('combobox', { name: 'Model text placement' }).selectOption('both');
  await page.getByRole('textbox', { name: 'Model text title', exact: true }).fill('ARAGATS');
  await page.getByRole('textbox', { name: 'Model text second line', exact: true }).fill('4,090 m · 2026');
  await page.getByRole('switch', { name: 'Keychain hole on model', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Model hole offset', exact: true }).fill('8');
  await page.evaluate(() => {
    const generate = window.trailPrint.generateTerrain;
    window.trailPrint.generateTerrain = async request => {
      const response = await generate(request);
      Object.assign(window, { modelFeaturePreview: { config: request.config, response } });
      return response;
    };
  });
  const preview = () => page.evaluate(() => (window as unknown as { modelFeaturePreview: Preview }).modelFeaturePreview);
  await page.getByRole('button', { name: 'Preview & export STL', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const download = dialog.getByRole('button', { name: 'Download', exact: true });
  await expect(download).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator('.terrain-modal__loading')).toBeHidden();
  const generated = await preview();
  expect(generated.response.modelFeaturesApplied).toBe(true);
  expect(generated.config.tray.enabled).toBe(false);
  expect(analyzeMesh(generated.response.mesh).boundaryEdges).toBe(0);
  expect(Math.min(...generated.response.mesh.positions.filter((_, i) => i % 3 === 1))).toBeLessThan(-60);
  expect(generated.response.mesh.bottomZ).toBeCloseTo(-3.6);
  await page.screenshot({ path: 'test-results/model-personalization-preview.png', fullPage: true });
  await page.getByRole('button', { name: 'View underside', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View underside', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'test-results/model-personalization-underside.png', fullPage: true });
  await page.getByRole('button', { name: 'Model view', exact: true }).click();
  const event = page.waitForEvent('download'); await download.click();
  const files = unzipSync(await readFile((await (await event).path())!));
  const stlName = Object.keys(files).find(name => name.endsWith('_Terrain_Main.stl'))!;
  const bytes = files[stlName]!;
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  expect(view.getUint32(80, true)).toBe(generated.response.mesh.indices.length / 3);
  // A 60 mm circle, 5 mm inset, on the right edge with an 8 mm arc offset.
  const assembly = JSON.parse(strFromU8(files[Object.keys(files).find(name => name.endsWith('_Assembly.json'))!]!));
  const translation = assembly.stlToAssembly.find((part: { file: string }) => part.file === stlName).assemblyTranslationMm;
  const hole = { center: { x: 55 * Math.cos(8 / 55) - translation[0], y: 55 * Math.sin(8 / 55) - translation[1] } };
  // No top or bottom STL triangle covers the bore center.
  let boreHits = 0;
  for (let t = 0; t < view.getUint32(80, true); t++) {
    const [a, b, c] = [0, 1, 2].map(v => [0, 1].map(axis => view.getFloat32(84 + t * 50 + 12 + v * 12 + axis * 4, true)));
    const area = (b![0]! - a![0]!) * (c![1]! - a![1]!) - (b![1]! - a![1]!) * (c![0]! - a![0]!);
    if (Math.abs(area) < 1e-8) continue;
    const u = ((hole.center.x - a![0]!) * (c![1]! - a![1]!) - (hole.center.y - a![1]!) * (c![0]! - a![0]!)) / area;
    const v = ((b![0]! - a![0]!) * (hole.center.y - a![1]!) - (b![1]! - a![1]!) * (hole.center.x - a![0]!)) / area;
    if (u >= 0 && v >= 0 && u + v <= 1) boreHits++;
  }
  expect(boreHits).toBe(0);
  await expect(download).toBeEnabled();
  const colorEvent = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download model 3MF', exact: true }).click();
  const model = unzipSync(await readFile((await (await colorEvent).path())!));
  expect(strFromU8(model['3D/3dmodel.model']!)).toContain('<triangle ');
  await expect(download).toBeEnabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Engraved', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Model hole offset', exact: true }).fill('-8');
  await page.getByRole('button', { name: 'Preview & export STL', exact: true }).click();
  await expect(download).toBeEnabled({ timeout: 60_000 });
  const edited = await preview();
  expect(edited.config.terrain.text.style).toBe('engraved');
  expect(edited.config.terrain.keychain.offsetMm).toBe(-8);
  expect(edited.response.mesh.bottomZ).toBe(-3);
  expect(edited.response.mesh.indices).not.toEqual(generated.response.mesh.indices);
  expect(errors).toEqual([]);
});

test('model personalization persists in presets and legacy presets load disabled', async ({ page }) => {
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await page.getByRole('switch', { name: 'Text on model', exact: true }).click();
  await page.getByRole('combobox', { name: 'Model text placement' }).selectOption('underside');
  await page.getByRole('textbox', { name: 'Model text title', exact: true }).fill('ԱՐԱԳԱԾ');
  await page.getByRole('button', { name: 'Engraved', exact: true }).click();
  await page.getByRole('switch', { name: 'Keychain hole on model', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Model hole diameter', exact: true }).fill('5');
  await page.getByRole('spinbutton', { name: 'Model hole inset', exact: true }).fill('6');
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Aragats keychain');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const apply = async () => {
    await page.getByTitle('Apply a saved preset', { exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Aragats keychain/ }).click();
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  };
  await page.reload(); await apply();
  await expect(page.getByRole('textbox', { name: 'Model text title', exact: true })).toHaveValue('ԱՐԱԳԱԾ');
  await expect(page.getByRole('button', { name: 'Engraved', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'Model hole inset', exact: true })).toHaveValue('6');
  await page.getByRole('spinbutton', { name: 'Model hole inset', exact: true }).fill('1');
  await expect(page.locator('.model-features__error')).toContainText('2 mm of model material');
  await page.getByRole('spinbutton', { name: 'Model hole inset', exact: true }).fill('6');
  await expect(page.locator('.model-features__error')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/model-personalization-settings.png', fullPage: true });
  await page.evaluate(() => {
    const presets = JSON.parse(localStorage.getItem('trailprint.configSchemes')!);
    delete presets[0].payload.terrain.text; delete presets[0].payload.terrain.keychain;
    localStorage.setItem('trailprint.configSchemes', JSON.stringify(presets));
  });
  await page.reload(); await apply();
  await expect(page.getByRole('switch', { name: 'Text on model', exact: true })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('switch', { name: 'Keychain hole on model', exact: true })).toHaveAttribute('aria-checked', 'false');
  expect(await page.locator('.sidebar').evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
});
