import { test, expect } from './authenticated';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

function file(name: string, lat: number) {
  const xml = `<gpx><trk><name>${name}</name><trkseg><trkpt lat="${lat}" lon="44.507"/><trkpt lat="${lat}" lon="44.513"/></trkseg></trk></gpx>`;
  return { name: `${name}.gpx`, mimeType: 'application/gpx+xml', buffer: Buffer.from(xml) };
}

for (const workspace of ['Mountain', 'City']) test(`${workspace}: select, append, drop and remove GPX files without losing existing routes`, async ({ page }) => {
  await page.goto('/');
  if (workspace === 'City') await page.getByRole('button', { name: 'City', exact: true }).click();
  const picker = page.locator('input[type=file]');
  const list = page.getByRole('list', { name: 'GPX files in this model' });
  await picker.setInputFiles([file('North', 40.182), file('South', 40.178)]);
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(page.locator('.gpx-files__total')).toContainText('2 GPX files ·');
  await expect(page.getByRole('button', { name: 'Add GPX files', exact: true })).toBeEnabled();
  const route = page.locator('.leaflet-overlay-pane path[stroke="#e84335"]');
  await expect(route).toHaveCount(1);
  await expect.poll(async () => ((await route.getAttribute('d'))?.match(/M/g) ?? []).length).toBe(2);
  await expect.poll(async () => {
    const track = await route.boundingBox(), shape = await page.locator('.crop-shape-outline, .mask-hole').boundingBox();
    if (!track || !shape) return Infinity;
    const cx = shape.x + shape.width / 2, cy = shape.y + shape.height / 2;
    return Math.max(...[track.x, track.x + track.width].flatMap(x =>
      [track.y, track.y + track.height].map(y => Math.hypot(x - cx, y - cy) / (shape.width / 2))));
  }).toBeLessThan(1);
  await picker.setInputFiles(file('Middle', 40.18));
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await picker.setInputFiles([file('Uncommitted', 40.18), { name: 'invalid.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from('bad XML') }]);
  await expect(page.locator(workspace === 'City' ? '.city-status' : '.sidebar__status')).toContainText('invalid.gpx');
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list).not.toContainText('Uncommitted');
  await page.getByRole('button', { name: 'Remove Middle.gpx', exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  const dropped = [file('East', 40.179), file('West', 40.181)].map(f => ({ name: f.name, text: f.buffer.toString() }));
  await page.locator(workspace === 'City' ? '.city-map' : '.preview').evaluate((element, files) => {
    const dataTransfer = new DataTransfer();
    for (const file of files) dataTransfer.items.add(new File([file.text], file.name, { type: 'application/gpx+xml' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, dropped);
  await expect(list.getByRole('listitem')).toHaveCount(4);
  await page.getByRole('button', { name: 'Remove all GPX files', exact: true }).click();
  await expect(list).toHaveCount(0);
  await expect(route).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Import GPX', exact: true })).toBeEnabled();
});

test('multiple GPX files appear in the terrain preview and download as one model archive', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/elevation', async route => {
    const { cols, rows } = route.request().postDataJSON();
    const values = Buffer.alloc(cols * rows * 4);
    for (let i = 0; i < cols * rows; i++) values.writeFloatLE(500 + 20 * Math.sin((i % cols) / cols * Math.PI), i * 4);
    await route.fulfill({ contentType: 'application/octet-stream', body: values });
  });
  await page.goto('/');
  await page.getByPlaceholder('Paste your API key').fill('multiple-gpx-test');
  await page.getByRole('button', { name: 'Standard', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles([file('North', 40.182), file('South', 40.178)]);
  await expect(page.getByRole('list', { name: 'GPX files in this model' }).getByRole('listitem')).toHaveCount(2);
  await page.screenshot({ path: '.context/multiple-gpx-map.png', fullPage: true });
  await page.getByRole('button', { name: 'Preview & export STL', exact: true }).click();
  const download = page.getByRole('button', { name: 'Download', exact: true });
  await expect(download).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator('.terrain-modal__loading')).toBeHidden();
  await page.screenshot({ path: '.context/multiple-gpx-preview.png', fullPage: true });
  const event = page.waitForEvent('download'); await download.click();
  const archive = await event;
  const files = unzipSync(await readFile((await archive.path())!));
  expect(Object.keys(files).filter(name => name.endsWith('.stl'))).toHaveLength(2);
  expect(Object.keys(files).some(name => name.endsWith('_Terrain_Main.stl'))).toBe(true);
  expect(Object.keys(files).some(name => name.endsWith('_Trail_Line.stl'))).toBe(true);
  expect(errors).toEqual([]);
});
