import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import Module from 'manifold-3d';
const data = JSON.parse(await readFile('fixtures/city-map.osm.json','utf8'));
const xml = await readFile('fixtures/city-run.gpx','utf8');
const compiled = await build({
  stdin: { contents: `export * from './electron/main/city/city-model-service'; export * from './electron/main/export/city-map-flow';
    export * from './shared/types/city'; export * from './shared/utils/binary-stl'; export * from './shared/utils/gpx-parser';`, resolveDir: resolve('.') },
  bundle: true, write: false, platform:'node', format:'esm',
  plugins:[{ name:'runtime-fixtures', setup(build) {
    build.onResolve({ filter:/^\.\/manifold-runtime$/ }, () => ({ path:'manifold', namespace:'fixture' }));
    build.onResolve({ filter:/^\.\.\/terrain\/dem-provider$/ }, () => ({ path:'dem', namespace:'fixture' }));
    build.onResolve({ filter:/^\.\/city-map-provider$/ }, () => ({ path:'map', namespace:'fixture' }));
    build.onLoad({ filter:/.*/, namespace:'fixture' }, ({path}) => ({ contents:path === 'manifold' ? 'export const getManifold = async () => globalThis.__cityWasm;' : path === 'dem' ? 'export const sampleDemGrid = (...args) => globalThis.__cityDem(...args);' : 'export const loadCityMapData = (...args) => globalThis.__cityMap(...args);' }));
  } }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);
before(async () => { globalThis.__cityWasm = await Module(); globalThis.__cityWasm.setup(); });
function request() {
  const config=api.createDefaultCityConfig();
  const parsed=api.parseGpxXml(xml);
  config.gpx={ ...config.gpx,...parsed,rawPoints:parsed.points,imported:true,importId:'test',fileName:'city-run.gpx' };
  Object.assign(config.mapCrop,{mapCenterLat:40.18,mapCenterLon:44.51,mapZoom:15});
  return { config,viewportWidth:800,viewportHeight:600 };
}
test('Flat skips DEM, caches the finalized preview and exports the same geometry', async () => {
  api.clearCityModelCache(); let maps=0, dems=0;
  globalThis.__cityMap=async (req) => { maps++; assert.deepEqual(Object.keys(req).sort(),['bounds','buildings','roads']); return data; };
  globalThis.__cityDem=async () => { dems++; throw new Error('Unexpected elevation'); };
  const req=request(); const preview=await api.generateCityModel(req);
  assert.equal(await api.generateCityModel(req),preview);
  req.config.colors = { ...req.config.colors, terrain: '#2468ac', trail: '#00ff00' };
  assert.equal(await api.generateCityModel(req),preview, 'color changes reuse the finalized geometry');
  assert.equal(api.cityMapExportFlow.describeArtifact(req).fileName, 'city-run.zip');
  const files={}; await api.cityMapExportFlow.generateFiles({...req,flow:'city-map'},()=>{},(name,value)=>files[name]=value);
  assert.deepEqual(files['city-run_City_Main.stl'], api.encodeBinaryStl(preview.cityMesh,'City_Main'));
  assert.deepEqual(files['city-run_Trail_Line.stl'], api.encodeBinaryStl(preview.routeMesh,'Trail_Line'));
  assert.deepEqual(Object.keys(files),['city-run_City_Main.stl','city-run_Trail_Line.stl','city-run_Assembly_Instructions.txt']);
  const instructions = new TextDecoder().decode(files['city-run_Assembly_Instructions.txt']);
  assert.match(instructions,/OpenStreetMap contributors/);
  assert.match(instructions,/city-run_City_Main\.stl and city-run_Trail_Line\.stl/);
  assert.equal(maps,1); assert.equal(dems,0);
  const edits=[];
  req.config.city.routeWidthMm=1.5; const next=await api.generateCityModel(req,(p)=>edits.push(p)); assert.notEqual(next,preview); assert.equal(maps,1);
  assert.ok(edits.some((p)=>/Updating the running trail/.test(p.message)));
  assert.ok(!edits.some((p)=>/Fusing city/.test(p.message)));
});
test('Real terrain reports missing keys before contacting providers and never switches modes', async () => {
  api.clearCityModelCache(); const req=request(); req.config.city.surface='real';
  globalThis.__cityMap=async()=>{throw new Error('Provider must not be called');};
  await assert.rejects(api.generateCityModel(req),/OpenTopography API key/);
  assert.equal(req.config.city.surface,'real');
  req.config.terrain.openTopographyApiKey='test';
  globalThis.__cityMap=async()=>data; globalThis.__cityDem=async()=>{throw new Error('Elevation rate limited');};
  await assert.rejects(api.generateCityModel(req),/Elevation rate limited/); assert.equal(req.config.city.surface,'real');
});
test('Real terrain reuses DEM preparation and provider errors propagate', async () => {
  api.clearCityModelCache(); const req=request(); req.config.city.surface='real'; req.config.terrain.openTopographyApiKey='test'; req.config.terrain.meshQuality='custom'; req.config.terrain.meshQualityCustom.maxGrid=64;
  globalThis.__cityMap=async()=>data;
  globalThis.__cityDem=async(_crop,cols,rows)=>({cols,rows,elevations:Float64Array.from({length:cols*rows},(_,i)=>500+i%cols),source:'opentopography'});
  const model=await api.generateCityModel(req); assert.ok(model.cityMesh.positions.some((_,i)=>i%3===2 && model.cityMesh.positions[i]>0));
  api.clearCityModelCache(); globalThis.__cityMap=async()=>{throw new Error('Map provider unavailable');};
  await assert.rejects(api.generateCityModel(req),/Map provider unavailable/);
});
test('Real terrain trail edits reuse map and elevation inputs and export the latest preview', async () => {
  api.clearCityModelCache();let maps=0,dems=0;
  const req=request();req.config.city.surface='real';req.config.terrain.openTopographyApiKey='test';req.config.terrain.meshQuality='custom';req.config.terrain.meshQualityCustom.maxGrid=64;
  let raw;
  globalThis.__cityMap=async()=>{maps++;return data;};
  globalThis.__cityDem=async(_crop,cols,rows)=>{dems++;raw=Float64Array.from({length:cols*rows},(_,i)=>500+i%cols);return {cols,rows,elevations:raw,source:'opentopography'};};
  const progress=[];
  let latest=await api.generateCityModel(req,(p)=>progress.push(p));const originalRaw=raw.slice();
  assert.ok(progress.some((p)=>/Fusing city/.test(p.message)));
  progress.length=0;
  for(const[field,value]of[['routeWidthMm',2],['routeClearanceMm',0.2],['routeSeatDepthMm',0.7],['routeReliefMm',1.2]]) {
    req.config.city[field]=value;const next=await api.generateCityModel(req,(p)=>progress.push(p));
    assert.notDeepEqual([next.cityMesh,next.routeMesh],[latest.cityMesh,latest.routeMesh]);latest=next;
    assert.equal(maps,1);assert.equal(dems,1);
  }
  assert.equal(progress.filter((p)=>/Fusing city/.test(p.message)).length,0);
  assert.equal(progress.filter((p)=>/Updating the running trail/.test(p.message)).length,4);
  const files={};await api.cityMapExportFlow.generateFiles({...req,flow:'city-map'},()=>{},(name,bytes)=>files[name]=bytes);
  assert.deepEqual(files['city-run_City_Main.stl'],api.encodeBinaryStl(latest.cityMesh,'City_Main'));
  assert.deepEqual(files['city-run_Trail_Line.stl'],api.encodeBinaryStl(latest.routeMesh,'Trail_Line'));
  assert.equal(maps,1);assert.equal(dems,1);assert.deepEqual(raw,originalRaw);
});
test('elevation processing edits stay local and changed sampling inputs fetch fresh data', async () => {
  api.clearCityModelCache();let maps=0,dems=0;
  const req=request();req.config.city.surface='real';req.config.terrain.openTopographyApiKey='first';req.config.terrain.meshQuality='custom';req.config.terrain.meshQualityCustom.maxGrid=64;
  globalThis.__cityMap=async()=>{maps++;return data;};
  globalThis.__cityDem=async(_crop,cols,rows)=>{dems++;return {cols,rows,elevations:Float64Array.from({length:cols*rows},(_,i)=>500+i%cols),source:'opentopography'};};
  const first=await api.generateCityModel(req);
  req.config.terrain.zExaggeration=2;const exaggerated=await api.generateCityModel(req);assert.notDeepEqual(first.cityMesh,exaggerated.cityMesh);
  req.config.terrain.smoothing='heavy';await api.generateCityModel(req);assert.equal(maps,1);assert.equal(dems,1);
  req.config.terrain.demDataset='SRTMGL1';await api.generateCityModel(req);assert.equal(maps,1);assert.equal(dems,2);
  req.config.terrain.openTopographyApiKey='second';await api.generateCityModel(req);assert.equal(dems,3);
  req.config.mapCrop.mapCenterLat+=0.0001;await api.generateCityModel(req);assert.equal(maps,2);assert.equal(dems,4);
  req.config.terrain.meshQualityCustom.maxGrid=96;await api.generateCityModel(req);assert.equal(maps,2);assert.equal(dems,5);
});
