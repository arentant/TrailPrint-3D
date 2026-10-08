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
    export * from './shared/types/city'; export * from './shared/utils/binary-stl'; export * from './shared/utils/gpx-parser';
    export { cityProject, cityFootprint } from './shared/city/geometry'; export * from './shared/export/export-artifact';`, resolveDir: resolve('.') },
  bundle: true, write: false, platform:'node', format:'esm',
  plugins:[{ name:'runtime-fixtures', setup(build) {
    build.onResolve({ filter:/^\.\/manifold-runtime$/ }, () => ({ path:'manifold', namespace:'fixture' }));
    build.onResolve({ filter:/^\.\.\/terrain\/dem-provider$/ }, () => ({ path:'dem', namespace:'fixture' }));
    build.onResolve({ filter:/^\.\/city-map-provider$/ }, () => ({ path:'map', namespace:'fixture' }));
    build.onResolve({ filter:/^@shared\/city\/map-tiles$/ }, () => ({ path:'tiles', namespace:'fixture' }));
    build.onLoad({ filter:/.*/, namespace:'fixture' }, ({path}) => ({ contents:path === 'manifold' ? 'export const getManifold = async () => globalThis.__cityWasm;' : path === 'dem' ? 'export const sampleDemGrid = (...args) => globalThis.__cityDem(...args);' : path === 'tiles' ? 'export const loadCityPictureTiles = (...args) => globalThis.__cityTiles(...args); export const clearCityPictureTileCache = () => {};' : 'export const loadCityMapData = (...args) => globalThis.__cityMap(...args);' }));
  } }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);
before(async () => {
  globalThis.__cityWasm = await Module(); globalThis.__cityWasm.setup();
  globalThis.__cityTiles = async () => [{ x: 20435, y: 12388, zoom: 15, dataUrl: 'data:image/png;base64,aGVsbG8=' }];
});
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
  req.config.picture.title = 'My personal poster';
  assert.equal(await api.generateCityModel(req), preview, 'picture details do not regenerate the city mesh');
  assert.equal(api.cityMapExportFlow.describeArtifact(req).fileName, `${api.modelExportStem(req.config)}.zip`);
  const files={}; await api.cityMapExportFlow.generateFiles({...req,flow:'city-map'},()=>{},(name,value)=>files[name]=value);
  assert.deepEqual(files[api.modelExportFileName(req.config, 'City_Main.stl')], api.encodeBinaryStl(preview.cityMesh, api.modelExportFileName(req.config, 'City_Main.stl').replace(/\.stl$/, '')));
  assert.deepEqual(files[api.modelExportFileName(req.config, 'Trail_Line.stl')], api.encodeBinaryStl(preview.routeMesh, api.modelExportFileName(req.config, 'Trail_Line.stl').replace(/\.stl$/, '')));
  assert.deepEqual(Object.keys(files),[api.modelExportFileName(req.config, 'City_Main.stl'),api.modelExportFileName(req.config, 'Trail_Line.stl'),api.modelExportFileName(req.config, 'Assembly_Instructions.txt')]);
  const trailRequest = { ...req, flow: 'city-map', target: 'trail' };
  assert.deepEqual(api.cityMapExportFlow.describeArtifact(trailRequest), {
    kind: 'file', fileName: api.modelExportFileName(req.config, 'Trail_Line.stl'), extension: 'stl', mimeType: 'model/stl', saveDialogTitle: 'Save city running trail STL',
  });
  const trailFiles = {};
  await api.cityMapExportFlow.generateFiles(trailRequest, () => {}, (name, bytes) => trailFiles[name] = bytes);
  assert.deepEqual(Object.keys(trailFiles), [api.modelExportFileName(req.config, 'Trail_Line.stl')]);
  assert.deepEqual(trailFiles[api.modelExportFileName(req.config, 'Trail_Line.stl')], files[api.modelExportFileName(req.config, 'Trail_Line.stl')]);
  const instructions = new TextDecoder().decode(files[api.modelExportFileName(req.config, 'Assembly_Instructions.txt')]);
  assert.match(instructions,/OpenStreetMap contributors/);
  assert.ok(instructions.includes(`${api.modelExportFileName(req.config, 'City_Main.stl')} and ${api.modelExportFileName(req.config, 'Trail_Line.stl')}`));
  assert.equal(maps,1); assert.equal(dems,0);
  const edits=[];
  req.config.city.routeWidthMm=1.5; const next=await api.generateCityModel(req,(p)=>edits.push(p)); assert.notEqual(next,preview); assert.equal(maps,1);
  assert.ok(edits.some((p)=>/Updating the running trail/.test(p.message)));
  assert.ok(!edits.some((p)=>/Fusing city/.test(p.message)));
});
test('paper map skips elevation and solids, omits track titles and uses STL projection at print scale', async () => {
  api.clearCityModelCache(); let maps = 0;
  globalThis.__cityMap = async () => { maps++; assert.fail('Paper must never fetch city geometry'); };
  globalThis.__cityDem = async () => { assert.fail('Paper must never fetch elevation'); };
  const wasm = globalThis.__cityWasm;
  globalThis.__cityWasm = undefined; // Even initialization of the solid builder would fail.
  try {
    const req = { ...request(), flow: 'city-map', target: 'map' };
    req.config.picture.enabled = false;
    req.config.city.surface = 'real'; req.config.terrain.openTopographyApiKey = '';
    req.config.gpx.trackName = '<script>alert("track")</script> & run';
    const artifact = api.cityMapExportFlow.describeArtifact(req);
    assert.equal(artifact.fileName, api.modelExportFileName(req.config, 'City_Map.svg'));
    assert.equal(artifact.mimeType, 'image/svg+xml'); assert.equal(artifact.kind, 'file');
    for (const shape of ['circle', 'rectangle', 'polygon']) {
      req.config.mapCrop.shape = shape;
      req.config.mapCrop.polygonSides = 5;
      req.config.mapCrop.mapBearingDeg = 31;
      const artifact = api.cityMapExportFlow.describeArtifact(req);
      const files = {};
      await api.cityMapExportFlow.generateFiles(req, () => {}, (name, bytes) => files[name] = bytes);
      assert.deepEqual(Object.keys(files), [artifact.fileName]);
      const svg = new TextDecoder().decode(files[artifact.fileName]);
      assert.match(svg, /width="[\d.]+mm" height="[\d.]+mm"/);
      assert.match(svg, /clip-path="url\(#city-footprint\)"/);
      assert.doesNotMatch(svg, /alert\(|&lt;script|<title|<desc|mm map|actual size/);
      assert.doesNotMatch(svg, /<script|NaN|Infinity/);
      assert.match(svg, /OpenStreetMap contributors/);
      assert.match(svg, /id="running-route"[^>]*stroke="#fc4c02"/);
      assert.match(svg, /id="street-map"><image/); assert.match(svg, /href="data:image\/png;base64,/);
      // Infer the SVG's map dimensions, then project the GPX with the model's projector.
      const [, width, height] = /width="([\d.]+)mm" height="([\d.]+)mm"/.exec(svg);
      const crop = { shape, widthMm: Number(width), heightMm: Number(height), radiusMm: req.config.mapCrop.radiusMm, polygonSides: 5 };
      // Polygon crop dimensions depend on the same asymmetric footprint; circle/rectangle are exact here.
      if (shape !== 'polygon') {
        const first = req.config.gpx.segments[0][0];
        const [x, y] = api.cityProject(req, crop, first.lon, first.lat);
        assert.ok(svg.includes(`M${Math.round(x * 10000) / 10000} ${Math.round(y * 10000) / 10000}`));
      }
    }
    const count = maps;
    req.config.city.routeWidthMm = 2;
    await api.generateCityMapPicture(req);
    assert.equal(maps, count, 'paper edits never download city data');
    req.config.city.buildingsVisible = false; req.config.city.roadsVisible = false;
    const fixedBasemap = new TextDecoder().decode(await api.generateCityMapPicture(req));
    assert.match(fixedBasemap, /id="street-map"><image/);
    assert.match(fixedBasemap, /id="running-route"[^>]*><path/);
    assert.equal(maps, 0);
  } finally { globalThis.__cityWasm = wasm; api.clearCityModelCache(); }
});

test('cold trail-only export needs no map provider and matches the complete city route on both surfaces', async () => {
  for (const surface of ['flat', 'real']) {
    api.clearCityModelCache();
    const req = request(); req.config.city.surface = surface;
    req.config.terrain.openTopographyApiKey = 'test'; req.config.terrain.meshQuality = 'custom'; req.config.terrain.meshQualityCustom.maxGrid = 64;
    globalThis.__cityMap = async () => data;
    globalThis.__cityDem = async (_crop, cols, rows) => ({ elevations: Float64Array.from({ length: cols * rows }, (_, i) => 500 + i % cols) });
    const complete = await api.generateCityModel(req);
    const expected = api.encodeBinaryStl(complete.routeMesh, api.modelExportFileName(req.config, 'Trail_Line.stl').replace(/\.stl$/, ''));
    api.clearCityModelCache();
    globalThis.__cityMap = async () => { throw new Error('The map download is too large'); };
    const files = {};
    await api.cityMapExportFlow.generateFiles({ ...req, flow: 'city-map', target: 'trail' }, () => {}, (name, bytes) => files[name] = bytes);
    assert.deepEqual(Object.keys(files), [api.modelExportFileName(req.config, 'Trail_Line.stl')]);
    assert.deepEqual(files[api.modelExportFileName(req.config, 'Trail_Line.stl')], expected);
  }
});

test('marathon trail and paper map export while the city geometry provider is unavailable', async () => {
  api.clearCityModelCache();
  const req = request(); const parsed = api.parseGpxXml(await readFile('fixtures/city-marathon.gpx', 'utf8'));
  req.config.gpx = { ...req.config.gpx, ...parsed, rawPoints: parsed.points, imported: true, fileName: 'berlin-marathon.gpx' };
  Object.assign(req.config.mapCrop, { mapCenterLat: (parsed.bounds.minLat + parsed.bounds.maxLat) / 2,
    mapCenterLon: (parsed.bounds.minLon + parsed.bounds.maxLon) / 2, mapZoom: 12 });
  let maps = 0;
  globalThis.__cityMap = async () => { maps++; throw new Error('The map download is too large'); };
  globalThis.__cityDem = async () => { assert.fail('Flat needs no elevation'); };
  const files = {};
  for (const target of ['trail', 'map']) await api.cityMapExportFlow.generateFiles({ ...req, flow: 'city-map', target }, () => {}, (name, bytes) => files[name] = bytes);
  assert.equal(maps, 0);
  assert.ok(files[api.modelExportFileName(req.config, 'Trail_Line.stl')].length > 84);
  const svg = new TextDecoder().decode(files[api.modelExportFileName(req.config, 'City_Map.svg')]);
  assert.match(svg, /id="street-map"><image/); assert.match(svg, /id="running-route"/);
});

test('unsupported city targets fail before generation', () => {
  assert.throws(() => api.cityMapExportFlow.describeArtifact({ ...request(), target: 'bad' }), /Unsupported city export target/);
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
  assert.deepEqual(files[api.modelExportFileName(req.config, 'City_Main.stl')],api.encodeBinaryStl(latest.cityMesh, api.modelExportFileName(req.config, 'City_Main.stl').replace(/\.stl$/, '')));
  assert.deepEqual(files[api.modelExportFileName(req.config, 'Trail_Line.stl')],api.encodeBinaryStl(latest.routeMesh, api.modelExportFileName(req.config, 'Trail_Line.stl').replace(/\.stl$/, '')));
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
