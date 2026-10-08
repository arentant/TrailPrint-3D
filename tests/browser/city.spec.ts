import { test, expect } from './authenticated';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { compactCityMap } from '../city-fixture.mjs';
import { MAX_PICTURE_TILES } from '../../shared/city/map-tiles';
const data = JSON.stringify(compactCityMap(JSON.parse(await readFile('fixtures/city-map.osm.json','utf8'))));
const tilePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMILU/6DwAEgQIuIhp1GQAAAABJRU5ErkJggg==', 'base64');
test.beforeEach(async ({ page }) => {
  await page.route('**/World_Topo_Map/MapServer/tile/**', route => route.fulfill({ contentType: 'image/png', body: tilePng }));
});

test('City import, finalized preview, ZIP, repeat download and independent workspace state', async ({ page }) => {
  const errors: string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  let maps=0, elevations=0;
  await page.route('**/api/city', async route => { maps++; const body=route.request().postDataJSON(); expect(Object.keys(body).sort()).toEqual(['bounds','buildings','roads']); await route.fulfill({contentType:'application/json',body:data}); });
  await page.route('**/api/elevation', async route => { elevations++; await route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'Unexpected elevation request'})}); });
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/sample-trail.gpx'));
  await expect(page.locator('.sidebar__status')).toContainText('Imported');
  const mountainTrack=await page.locator('.gpx-summary__title').textContent();
  const mountainRadius=await page.getByRole('spinbutton',{name:'Print radius'}).inputValue();
  await page.getByRole('button',{name:'City',exact:true}).click();
  await expect(page.getByRole('button',{name:'Flat',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByPlaceholder('Paste your API key')).toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/city-run.gpx'));
  await expect(page.getByText('City fixture run ·', {exact:false})).toBeVisible();
  await page.getByRole('spinbutton',{name:'Print radius'}).fill('70');
  await page.getByRole('button',{name:'Preview & export City STL'}).click();
  const downloadButton=page.getByRole('button',{name:'Download City ZIP'});
  await expect(downloadButton).toBeEnabled({timeout:60000});
  await expect(page.locator('.city-mesh canvas')).toBeVisible();
  const previewDialog = page.getByRole('dialog', { name: 'Your city run, in 3D' });
  await previewDialog.locator('[data-setting-guide="routeClearance"] button').click();
  await expect(page.getByRole('tooltip')).toContainText('Groove width = route width + 2 × clearance.');
  await page.screenshot({ path: 'test-results/settings-guide-city-preview.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(previewDialog).toBeVisible();
  await page.screenshot({path:'test-results/city-preview.png',fullPage:true});
  const event=page.waitForEvent('download'); await downloadButton.click(); const download=await event;
  expect(download.suggestedFilename()).toBe('city-run_circle_R70mm_mesh-high_magnets-off.zip');
  const files=unzipSync(await readFile((await download.path())!));
  expect(Object.keys(files).sort()).toEqual(['city-run_circle_R70mm_mesh-high_magnets-off_Assembly_Instructions.txt','city-run_circle_R70mm_mesh-high_magnets-off_City_Main.stl','city-run_circle_R70mm_mesh-high_magnets-off_Trail_Line.stl']);
  expect(new TextDecoder().decode(files['city-run_circle_R70mm_mesh-high_magnets-off_Assembly_Instructions.txt'])).toContain('OpenStreetMap contributors');
  for (const name of ['city-run_circle_R70mm_mesh-high_magnets-off_City_Main.stl','city-run_circle_R70mm_mesh-high_magnets-off_Trail_Line.stl']) {
    const bytes=files[name]!, view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength); const triangles=view.getUint32(80,true);
    expect(triangles).toBeGreaterThan(0); expect(bytes.length).toBe(84+50*triangles);
    for(let t=0;t<triangles;t++) for(let c=0;c<12;c++) expect(Number.isFinite(view.getFloat32(84+t*50+c*4,true))).toBe(true);
  }
  const trailEvent = page.waitForEvent('download');
  await previewDialog.getByRole('button', { name: 'Download trail STL', exact: true }).click();
  const trailDownload = await trailEvent;
  expect(trailDownload.suggestedFilename()).toBe('city-run_circle_R70mm_mesh-high_magnets-off_Trail_Line.stl');
  expect(await readFile((await trailDownload.path())!)).toEqual(Buffer.from(files['city-run_circle_R70mm_mesh-high_magnets-off_Trail_Line.stl']));
  await previewDialog.getByRole('button', { name: 'Preview map picture', exact: true }).click();
  const pictureDialog = page.getByRole('dialog', { name: 'Your run. On paper.' });
  await pictureDialog.getByRole('button', { name: 'Map only', exact: true }).click();
  const mapEvent = page.waitForEvent('download');
  await pictureDialog.getByRole('button', { name: 'Download SVG', exact: true }).click();
  const mapDownload = await mapEvent;
  expect(mapDownload.suggestedFilename()).toBe('city-run_circle_R70mm_mesh-high_magnets-off_City_Map.svg');
  const svg = await readFile((await mapDownload.path())!, 'utf8');
  expect(svg).toContain('width="140mm" height="140mm"');
  expect(svg).not.toContain('City fixture run');
  expect(svg).toContain('OpenStreetMap contributors');
  expect(maps).toBe(1); expect(elevations).toBe(0);
  await page.getByRole('button',{name:'Close picture preview'}).click();
  const again=page.waitForEvent('download'); await page.getByRole('button',{name:'Download again',exact:true}).click(); expect((await again).suggestedFilename()).toBe(mapDownload.suggestedFilename());
  await page.getByRole('button',{name:'Mountain',exact:true}).click();
  await expect(page.getByRole('spinbutton',{name:'Print radius'})).toHaveValue(mountainRadius);
  await expect(page.locator('.gpx-summary__title')).toHaveText(mountainTrack!);
  await page.getByRole('button',{name:'City',exact:true}).click();
  await expect(page.getByRole('spinbutton',{name:'Print radius'})).toHaveValue('70');
  await expect(page.getByText('City fixture run ·',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Download again',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Real terrain',exact:true}).click();
  await expect(page.getByPlaceholder('Paste your API key')).toBeVisible();
  await page.getByRole('button',{name:'Preview & export City STL'}).click();
  await expect(page.getByRole('alert')).toContainText('OpenTopography API key');
  await page.getByRole('button',{name:'Close city preview'}).click();
  await expect(page.getByRole('button',{name:'Real terrain',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(errors).toEqual([]);
});

test('paper map exports before a 3D preview, needs no elevation key, and renders at physical size', async ({ page, context }) => {
  let maps = 0, elevations = 0;
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/city', route => { maps++; return route.fulfill({ contentType: 'application/json', body: data }); });
  await page.route('**/api/elevation', route => { elevations++; return route.fulfill({ status: 502 }); });
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'City', exact: true }).click();
  const pictureButton = page.getByRole('button', { name: 'Preview & export map picture', exact: true });
  await expect(pictureButton).toBeDisabled();
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/city-run.gpx'));
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Print length', exact: true }).fill('120');
  await page.getByRole('spinbutton', { name: 'Print width', exact: true }).fill('90');
  await page.getByRole('button', { name: 'Real terrain', exact: true }).click();
  await page.getByPlaceholder('Paste your API key').fill('');
  await expect(pictureButton).toBeEnabled();
  await pictureButton.click();
  const pictureDialog = page.getByRole('dialog', { name: 'Your run. On paper.' });
  await expect(pictureDialog.getByLabel('Title', { exact: true })).toHaveValue('City fixture run');
  await expect(pictureDialog.getByLabel('Elapsed time', { exact: true })).toHaveValue('');
  await pictureDialog.getByRole('button', { name: 'Map only', exact: true }).click();
  const event = page.waitForEvent('download'); await pictureDialog.getByRole('button', { name: 'Download SVG' }).click(); const download = await event;
  expect(download.suggestedFilename()).toBe('city-run_rectangle_120x90mm_mesh-high_magnets-off_City_Map.svg');
  const svg = await readFile((await download.path())!, 'utf8');
  const parsed = await page.evaluate(source => {
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
    return {
      errors: doc.querySelectorAll('parsererror').length,
      width: doc.documentElement.getAttribute('width'), height: doc.documentElement.getAttribute('height'),
      route: doc.querySelector('#running-route path')?.getAttribute('d'),
      routeColor: doc.querySelector('#running-route')?.getAttribute('stroke'),
      text: Array.from(doc.querySelectorAll('text')).map(node => node.textContent),
      tiles: doc.querySelectorAll('#street-map image').length,
    };
  }, svg);
  expect(parsed.errors).toBe(0); expect(parsed.width).toBe('120mm'); expect(parsed.height).toBe('90mm');
  expect(parsed.routeColor).toBe('#fc4c02');
  expect(parsed.text).toEqual([]);
  expect(parsed.route).toMatch(/^M/); expect(parsed.tiles).toBeGreaterThan(0); expect(parsed.tiles).toBeLessThanOrEqual(MAX_PICTURE_TILES);
  expect(elevations).toBe(0); expect(maps).toBe(0);
  await pictureDialog.getByRole('button', { name: 'Close picture preview' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.city-status')).toContainText('100% / actual size');
  const image = await context.newPage();
  await image.goto(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  await expect(image.locator('svg')).toBeVisible();
  await image.screenshot({ path: 'test-results/city-paper-map.png' });
  await image.close();
  const repeat = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download again', exact: true }).click();
  expect((await repeat).suggestedFilename()).toBe(download.suggestedFilename());
  expect(maps).toBe(0); expect(errors).toEqual([]);
});

test('marathon trail and map downloads bypass city geometry and work after an oversized city preview', async ({ page }) => {
  let maps = 0, elevations = 0;
  await page.route('**/api/city', route => { maps++; return route.fulfill({ status: 413, contentType: 'application/json', body: JSON.stringify({ error: 'The map download is too large. Choose a smaller selection.' }) }); });
  await page.route('**/api/elevation', route => { elevations++; return route.fulfill({ status: 502 }); });
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'City', exact: true }).click();
  const trailButton = page.getByRole('button', { name: 'Download trail STL', exact: true });
  await expect(trailButton).toBeDisabled();
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/city-marathon.gpx'));
  await expect(trailButton).toBeEnabled();
  const event = page.waitForEvent('download'); await trailButton.click(); const trail = await event;
  expect(trail.suggestedFilename()).toBe('city-marathon_circle_R60mm_mesh-high_magnets-off_Trail_Line.stl');
  expect((await readFile((await trail.path())!)).length).toBeGreaterThan(84);
  expect(maps).toBe(0); expect(elevations).toBe(0);
  await page.getByRole('button', { name: 'Preview & export City STL' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('The map download is too large');
  await expect(dialog.getByRole('button', { name: 'Download City ZIP' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Download trail STL', exact: true })).toBeEnabled();
  const retryTrail = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download trail STL', exact: true }).click();
  expect((await retryTrail).suggestedFilename()).toBe(trail.suggestedFilename());
  await dialog.getByRole('button', { name: 'Preview map picture' }).click();
  const mapEvent = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Download SVG' }).click(); const picture = await mapEvent;
  const svg = await readFile((await picture.path())!, 'utf8');
  expect(svg).toContain('id="street-map"><image'); expect(svg).toContain('id="running-route"');
  expect(maps).toBe(1); expect(elevations).toBe(0);
});

test('Real terrain stays manual, provider failures are shown, and stale previews are discarded', async ({page}) => {
  let maps=0, elevations=0;
  await page.route('**/api/city', async route => { maps++; if(maps===1) await new Promise(resolve=>setTimeout(resolve,300)); await route.fulfill({contentType:'application/json',body:data}); });
  await page.route('**/api/elevation', async route => { elevations++; await route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'Elevation provider unavailable'})}); });
  await page.goto('/'); await page.getByRole('button',{name:'City',exact:true}).click();
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/city-run.gpx'));
  await page.getByRole('button',{name:'Preview & export City STL'}).click();
  await page.getByRole('button',{name:'Close city preview'}).click();
  await page.getByRole('spinbutton',{name:'Route width'}).fill('2');
  await page.getByRole('button',{name:'Preview & export City STL'}).click();
  await expect(page.getByRole('button',{name:'Download City ZIP'})).toBeEnabled({timeout:60000});
  await page.getByRole('button',{name:'Close city preview'}).click();
  await page.getByRole('button',{name:'Real terrain',exact:true}).click();
  await page.getByPlaceholder('Paste your API key').fill('city-test-key');
  await page.getByRole('button',{name:'Preview & export City STL'}).click();
  await expect(page.getByRole('alert')).toContainText('Elevation provider unavailable');
  expect(elevations).toBe(1);
  await page.getByRole('button',{name:'Close city preview'}).click();
  await page.getByRole('button',{name:'Flat',exact:true}).click();
  await page.getByRole('button',{name:'Preview & export City STL'}).click();
  await expect(page.getByRole('button',{name:'Download City ZIP'})).toBeEnabled({timeout:60000});
  expect(elevations).toBe(1);
});

test('Real terrain trail edits in the preview reuse data and export the updated model', async ({page}) => {
  let maps=0,elevations=0;
  await page.route('**/api/city',route=>{maps++;return route.fulfill({contentType:'application/json',body:data});});
  await page.route('**/api/elevation',async route=>{
    elevations++;const {cols,rows,apiKey,dataset}=route.request().postDataJSON();
    expect(apiKey).toBe('city-real-key'); expect(dataset).toBe('COP30');
    const values=Buffer.alloc(cols*rows*4);
    for(let i=0;i<cols*rows;i++)values.writeFloatLE(500+(i%cols)/cols*30+Math.floor(i/cols)/rows*20,i*4);
    await route.fulfill({contentType:'application/octet-stream',body:values});
  });
  await page.goto('/');await page.getByRole('button',{name:'City',exact:true}).click();
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/city-run.gpx'));
  await page.getByRole('button',{name:'Real terrain',exact:true}).click();
  await page.getByPlaceholder('Paste your API key').fill('city-real-key');
  await page.getByRole('button',{name:'Preview & export City STL'}).click();
  const downloadButton=page.getByRole('button',{name:'Download City ZIP'});
  await expect(downloadButton).toBeEnabled({timeout:60000});
  await expect(page.locator('.city-mesh canvas')).toBeVisible();
  const dialog=page.getByRole('dialog',{name:'Your city run, in 3D'});
  const canvas=await dialog.locator('canvas').elementHandle();
  await page.evaluate(()=>{
    const generate=window.trailPrint.generateCityModel;
    (window as any).__cityPreviewRequests=0;
    window.trailPrint.generateCityModel=async request=>{
      (window as any).__cityPreviewRequests++;
      await new Promise(resolve=>setTimeout(resolve,300));
      return generate(request);
    };
  });
  // Vue ignores bubbling events timestamped before their listener was attached.
  const typingStart=new Date(Date.now()+60_000);
  await page.clock.install({time:typingStart});
  await page.clock.pauseAt(new Date(typingStart.getTime()+1000));
  const width=dialog.getByRole('spinbutton',{name:'Route width'});
  await width.fill('3');
  await page.clock.runFor(600);
  await width.fill('3.5');
  await page.clock.runFor(600);
  // Clearing a number does not change the config, but must still restart the typing delay.
  await width.fill('');
  await page.clock.runFor(600);
  expect(await page.evaluate(()=>(window as any).__cityPreviewRequests)).toBe(0);
  await width.fill('2');
  await expect(downloadButton).toBeDisabled();
  await expect(dialog.locator('canvas')).toBeVisible();
  await page.clock.runFor(999);
  expect(await page.evaluate(()=>(window as any).__cityPreviewRequests)).toBe(0);
  await page.clock.runFor(1);
  expect(await page.evaluate(()=>(window as any).__cityPreviewRequests)).toBe(1);
  await page.clock.resume();
  // Edit again during generation: only the latest settings may enable the download.
  await expect.poll(()=>page.evaluate(()=>(window as any).__cityPreviewRequests)).toBe(1);
  await dialog.getByRole('spinbutton',{name:'Visible route relief'}).fill('1.4');
  await dialog.getByRole('spinbutton',{name:'Seating depth'}).fill('0.8');
  await dialog.getByRole('spinbutton',{name:'Clearance per side'}).fill('0.25');
  await expect(downloadButton).toBeEnabled({timeout:60000});
  expect(await page.evaluate(()=>(window as any).__cityPreviewRequests)).toBe(2);
  expect(await canvas!.evaluate(node=>node.isConnected)).toBe(true);
  await page.screenshot({path:'test-results/city-trail-editor.png',fullPage:true});
  const event=page.waitForEvent('download');await downloadButton.click();const download=await event;
  const files=unzipSync(await readFile((await download.path())!));
  const instructions=new TextDecoder().decode(files['city-run_circle_R60mm_mesh-high_magnets-off_Assembly_Instructions.txt']);
  expect(instructions).toContain('Surface mode: real');
  expect(instructions).toContain('2 mm width, 0.8 mm seating depth, 1.4 mm visible relief, 0.25 mm clearance per side');
  expect(maps).toBe(1);expect(elevations).toBe(1);
  // Invalid edits keep the preview visible, block stale exports, and recover without refetching.
  await dialog.getByRole('spinbutton',{name:'Seating depth'}).fill('10');
  await expect(dialog.getByRole('alert')).toContainText('Check route dimensions');
  await expect(dialog.locator('.preview-stage')).toHaveAttribute('aria-busy','false');
  await expect(downloadButton).toBeDisabled();await expect(dialog.locator('canvas')).toBeVisible();
  await dialog.getByRole('spinbutton',{name:'Seating depth'}).fill('0.8');
  await expect(downloadButton).toBeEnabled({timeout:60000});
  await dialog.getByRole('button',{name:'Close city preview'}).click();
  await expect(page.getByRole('spinbutton',{name:'Route width'})).toHaveValue('2');
  await page.getByRole('button',{name:'Preview & export City STL'}).click();
  await expect(downloadButton).toBeEnabled();
  expect(maps).toBe(1);expect(elevations).toBe(1);
});


test('picture editor imports GPX stats, previews edits immediately and exports the same poster', async ({ page }) => {
  let geometry = 0, tileLoads = 0;
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/city', route => { geometry++; return route.fulfill({ status: 500 }); });
  await page.route('**/World_Topo_Map/MapServer/tile/**', route => {
    tileLoads++; return route.fulfill({ contentType: 'image/png', body: tilePng });
  });
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'City', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/city-timed-run.gpx'));
  const opener = page.getByRole('button', { name: 'Preview & export map picture' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Your run. On paper.' });
  const preview = dialog.getByAltText('City map picture preview');
  await expect(preview).toBeVisible();
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Yerevan morning run');
  await expect(dialog.getByLabel('Runner name')).toHaveValue('Narek Margaryan');
  await expect(dialog.getByLabel('Date', { exact: true })).toHaveValue('2023-09-24');
  await expect(dialog.getByLabel('Elapsed time')).toHaveValue('0:16:00');
  await expect(dialog.getByLabel('Average pace')).not.toHaveValue('');
  const initialTileLoads = tileLoads;
  const initialUrl = await preview.getAttribute('src');
  await dialog.getByLabel('Title', { exact: true }).fill('Berlin Marathon');
  await dialog.getByLabel('Distance', { exact: true }).fill('42.20');
  await dialog.getByLabel('Elapsed time').fill('3:55:41');
  await dialog.getByLabel('Average pace').fill('5:31');
  await expect(preview).not.toHaveAttribute('src', initialUrl!);
  expect(tileLoads).toBe(initialTileLoads);
  async function readProof() {
    const event = page.waitForEvent('download');
    await preview.evaluate(image => {
      const link = document.createElement('a');
      link.href = (image as HTMLImageElement).src; link.download = 'preview-proof.svg';
      document.body.append(link); link.click(); link.remove();
    });
    return readFile((await (await event).path())!, 'utf8');
  }
  const proof = await page.evaluate(source => {
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
    return {
      text: doc.querySelector('#poster-details')!.textContent,
      width: doc.documentElement.getAttribute('width'), height: doc.documentElement.getAttribute('height'),
      route: doc.querySelector('#running-route')!.innerHTML,
    };
  }, await readProof());
  expect(proof.text).toContain('BERLIN MARATHON');
  expect(proof.text).toContain('42.20 km'); expect(proof.text).toContain('5:31 /km');
  await page.screenshot({ path: 'test-results/city-picture-editor.png', fullPage: true });
  const event = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download SVG' }).click();
  const source = await readFile((await (await event).path())!, 'utf8');
  const exported = await page.evaluate(svg => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    return {
      errors: doc.querySelectorAll('parsererror').length,
      text: doc.querySelector('#poster-details')!.textContent,
      width: doc.documentElement.getAttribute('width'), height: doc.documentElement.getAttribute('height'),
      route: doc.querySelector('#running-route')!.innerHTML,
    };
  }, source);
  expect(exported.errors).toBe(0);
  expect(exported.text).toBe(proof.text); expect(exported.width).toBe(proof.width);
  expect(exported.height).toBe(proof.height); expect(exported.route).toBe(proof.route);
  await dialog.getByRole('button', { name: 'Midnight' }).click();
  await dialog.getByLabel('Runner name').fill('');
  const darkSource = await readProof();
  expect(darkSource).toContain('fill="#192b28"'); expect(darkSource).not.toContain('>RUN BY<');
  await expect(dialog.locator('.picture-footer')).not.toContainText('City map ready');
  await dialog.getByRole('button', { name: 'Close picture preview' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Download SVG' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close picture preview' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  await opener.click();
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Berlin Marathon');
  await expect(dialog.getByRole('button', { name: 'Midnight' })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Use GPX values' }).click();
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Yerevan morning run');
  await expect(dialog.getByLabel('Runner name')).toHaveValue('Narek Margaryan');
  await expect(dialog.getByLabel('Elapsed time')).toHaveValue('0:16:00');
  expect(geometry).toBe(0); expect(errors).toEqual([]);
});

test('picture preview recovers from tile failures and stays usable on a narrow screen', async ({ page }) => {
  let fail = true;
  await page.route('**/World_Topo_Map/MapServer/tile/**', route => fail
    ? route.fulfill({ status: 503 })
    : route.fulfill({ contentType: 'image/png', body: tilePng }));
  await page.goto('/'); await page.getByRole('button', { name: 'City', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/city-run.gpx'));
  await page.getByRole('button', { name: 'Preview & export map picture' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your run. On paper.' });
  await expect(dialog.getByRole('alert')).toContainText('503');
  await expect(dialog.getByRole('button', { name: 'Download SVG' })).toBeDisabled();
  fail = false; await dialog.getByRole('button', { name: 'Retry map preview' }).click();
  await expect(dialog.getByAltText('City map picture preview')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Download SVG' })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByLabel('Title', { exact: true }).fill('A small city adventure');
  await expect(dialog.getByRole('button', { name: 'Download SVG' })).toBeVisible();
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/city-picture-mobile.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Close picture preview' }).click();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/city-timed-run.gpx'));
  await page.getByRole('button', { name: 'Preview & export map picture' }).click();
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Yerevan morning run');
});


test('picture preview falls back when a missing tile is hidden by browser request errors', async ({ page }) => {
  let supportedZoom: number | undefined;
  const successfulZooms = new Set<number>();
  await page.route('**/World_Topo_Map/MapServer/tile/**', route => {
    const zoom = Number(/\/tile\/(\d+)\//.exec(route.request().url())![1]);
    supportedZoom ??= zoom - 2;
    if (zoom > supportedZoom) return route.abort('failed');
    successfulZooms.add(zoom);
    return route.fulfill({ contentType: 'image/png', body: tilePng });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'City', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/city-timed-run.gpx'));
  await page.getByRole('button', { name: 'Preview & export map picture' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your run. On paper.' });
  await expect(dialog.getByAltText('City map picture preview')).toBeVisible();
  expect([...successfulZooms]).toEqual([supportedZoom]);
  const event = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download SVG' }).click();
  expect((await event).suggestedFilename()).toContain('City_Map.svg');
});


test('unavailable street map coverage shows an error while poster details stay editable', async ({ page }) => {
  await page.route('**/World_Topo_Map/MapServer/tile/**', route => route.fulfill({ status: 404 }));
  await page.goto('/'); await page.getByRole('button', { name: 'City', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/city-timed-run.gpx'));
  await page.getByRole('button', { name: 'Preview & export map picture' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your run. On paper.' });
  await expect(dialog.getByRole('alert')).toContainText('Detailed street maps are unavailable');
  await expect(dialog.getByRole('button', { name: 'Download SVG' })).toBeDisabled();
  await dialog.getByLabel('Title', { exact: true }).fill('My run');
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('My run');
});


test('poster layouts switch without reloading the map, keep edits and export cards directly on the map', async ({ page }) => {
  let tileLoads = 0;
  await page.route('**/World_Topo_Map/MapServer/tile/**', route => {
    tileLoads++; return route.fulfill({ contentType: 'image/png', body: tilePng });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'City', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/city-timed-run.gpx'));
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.getByRole('button', { name: 'Preview & export map picture' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your run. On paper.' });
  const preview = dialog.getByAltText('City map picture preview');
  await expect(preview).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Map cards', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // Inspect the rendered image too: valid SVG markup can still have an empty clip mask.
  const readPixel = () => preview.evaluate(async (image: HTMLImageElement) => {
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
      return Array.from(ctx.getImageData(Math.floor(canvas.width * .5), Math.floor(canvas.height * .08), 1, 1).data);
    });
  const cardPixel = await readPixel();
  expect(cardPixel[0]).toBeGreaterThan(225);
  expect(cardPixel[1]).toBeGreaterThan(220);
  expect(cardPixel[2]).toBeGreaterThan(210);
  await dialog.getByRole('button', { name: 'Map only', exact: true }).click();
  expect(await readPixel()).toEqual([85, 119, 98, 255]);
  await dialog.getByRole('button', { name: 'Route poster', exact: true }).click();
  await dialog.getByLabel('Title', { exact: true }).fill('My marathon');
  await dialog.getByLabel('Runner name').fill('Narek & Co.');
  const initialTileLoads = tileLoads;
  for (const [label, layout] of [['Map cards', 'cards'], ['Minimal', 'minimal'], ['Editorial', 'editorial']] as const) {
    await dialog.getByRole('button', { name: label, exact: true }).click();
    const event = page.waitForEvent('download');
    await preview.evaluate(image => {
      const link = document.createElement('a');
      link.href = (image as HTMLImageElement).src; link.download = 'layout-proof.svg';
      document.body.append(link); link.click(); link.remove();
    });
    const source = await readFile((await (await event).path())!, 'utf8');
    const parsed = await page.evaluate(svg => {
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      return {
        errors: doc.querySelectorAll('parsererror').length,
        layout: doc.querySelector('#poster-details')!.getAttribute('data-layout'),
        cards: doc.querySelectorAll('[data-overlay-card]').length,
        text: doc.querySelector('#poster-details')!.textContent,
        width: doc.documentElement.getAttribute('width'), height: doc.documentElement.getAttribute('height'),
      };
    }, source);
    expect(parsed.errors).toBe(0); expect(parsed.layout).toBe(layout);
    expect(parsed.text).toContain('Narek & Co.');
    if (layout !== 'editorial') { expect(parsed.width).toBe('120mm'); expect(parsed.height).toBe('80mm'); }
    expect(parsed.cards).toBe(layout === 'cards' ? 6 : 0);
    await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('My marathon');
    expect(tileLoads).toBe(initialTileLoads);
  }
  await dialog.getByRole('button', { name: 'Map cards', exact: true }).click();
  const event = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download SVG' }).click();
  const exported = await readFile((await (await event).path())!, 'utf8');
  expect(exported).toContain('data-layout="cards"');
  expect(exported).toContain('data-overlay-card="distance"');
  expect(exported).toContain('width="120mm" height="80mm"');
});
