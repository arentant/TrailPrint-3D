import { test, expect } from './authenticated';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { compactCityMap } from '../city-fixture.mjs';
const data = JSON.stringify(compactCityMap(JSON.parse(await readFile('fixtures/city-map.osm.json','utf8'))));

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
  await page.screenshot({path:'test-results/city-preview.png',fullPage:true});
  const event=page.waitForEvent('download'); await downloadButton.click(); const download=await event;
  expect(download.suggestedFilename()).toMatch(/^TrailPrint-City-.*\.zip$/);
  const files=unzipSync(await readFile((await download.path())!));
  expect(Object.keys(files).sort()).toEqual(['Assembly_Instructions.txt','City_Main.stl','Trail_Line.stl']);
  expect(new TextDecoder().decode(files['Assembly_Instructions.txt'])).toContain('OpenStreetMap contributors');
  for (const name of ['City_Main.stl','Trail_Line.stl']) {
    const bytes=files[name]!, view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength); const triangles=view.getUint32(80,true);
    expect(triangles).toBeGreaterThan(0); expect(bytes.length).toBe(84+50*triangles);
    for(let t=0;t<triangles;t++) for(let c=0;c<12;c++) expect(Number.isFinite(view.getFloat32(84+t*50+c*4,true))).toBe(true);
  }
  expect(maps).toBe(1); expect(elevations).toBe(0);
  await page.getByRole('button',{name:'Close city preview'}).click();
  const again=page.waitForEvent('download'); await page.getByRole('button',{name:'Download again',exact:true}).click(); expect((await again).suggestedFilename()).toBe(download.suggestedFilename());
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
  const instructions=new TextDecoder().decode(files['Assembly_Instructions.txt']);
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
