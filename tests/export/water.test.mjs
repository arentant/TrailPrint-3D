import { unzipSync, strFromU8, zipSync } from 'fflate';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import Module from 'manifold-3d';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const compiled = await build({
  stdin: { contents: `export * from './shared/water/geometry'; export * from './shared/water/mesh-payload'; export * from './shared/types/config';
    export * from './shared/utils/heightfield-mesh'; export * from './shared/utils/mesh-manifold';
    export * from './shared/utils/crop-region'; export * from './shared/utils/map-mm-projection';
    export * from './shared/utils/leaflet-projection'; export * from './shared/utils/model-validation';
    export * from './shared/water/catalog'; export * from './shared/water/selection'; export * from './shared/water/fused-materials';
    export * from './shared/export/colored-3mf'; export * from './shared/utils/binary-stl'; export * from './electron/main/terrain/prepare-heightfield'; export * from './shared/export/export-artifact'; export * from './electron/main/terrain/terrain-main-service';
    export * from './electron/main/export/mountain-trail-flow';`, resolveDir: resolve('.') },
  bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'water-fixtures', setup(plugin) {
    plugin.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
    plugin.onResolve({ filter: /^(\.\/|\.\.\/city\/)manifold-runtime$/ }, () => ({ path: 'manifold', namespace: 'fixture' }));
    plugin.onResolve({ filter: /^\.\/city-map-provider$/ }, () => ({ path: 'map', namespace: 'fixture' }));
    plugin.onResolve({ filter: /^\.\/dem-provider$/ }, () => ({ path: 'dem', namespace: 'fixture' }));
    plugin.onResolve({ filter: /^\.\.\/gpx\/hydrate-gpx-config$/ }, () => ({ path: 'gpx', namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: {
      electron: 'export const nativeImage = {}; export const app = {};',
      manifold: 'export const getManifold = async () => globalThis.__waterWasm;',
      map: 'export const loadCityMapData = (...args) => globalThis.__waterMap(...args);',
      dem: 'export const sampleDemGrid = async (_crop, cols, rows) => ({cols, rows, elevations: Float64Array.from({ length: cols * rows }, (_, i) => globalThis.__waterElevation ? globalThis.__waterElevation(i % cols, Math.floor(i / cols), cols, rows) : 500), source: "opentopography"});',
      gpx: 'export const hydrateGpxConfig = async (config) => config;',
    }[path] }));
  } }],
});
// A file URL keeps failing-test stack traces readable.
const directory = await mkdtemp(join(tmpdir(), 'trailprint-water-test-'));
after(() => rm(directory, { recursive: true, force: true }));
await writeFile(join(directory, 'water.mjs'), compiled.outputFiles[0].contents);
const api = await import(pathToFileURL(join(directory, 'water.mjs')).href);
let wasm;
before(async () => { wasm = await Module(); wasm.setup(); globalThis.__waterWasm = wasm; });

function request(shape = 'rectangle', bearing = 0) {
  const config = api.createDefaultConfig();
  Object.assign(config.mapCrop, { shape, mapCenterLat: 40.18, mapCenterLon: 44.51, mapZoom: 15, mapBearingDeg: bearing });
  Object.assign(config.terrain, { meshQuality: 'custom', meshQualityCustom: { maxGrid: 64 } });
  config.water.enabled = true;
  return { config, viewportWidth: 800, viewportHeight: 600 };
}
const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
function dataFor(req, crop, polygons) {
  const scale = api.maskMmScale(req.config.mapCrop, crop, req.viewportWidth, req.viewportHeight);
  const elements = [];
  let nodeId = 1;
  for (const [p, rings] of polygons.entries()) {
    const members = [];
    for (const [r, ring] of rings.entries()) {
      const id = elements.length + 1;
      const nodes = ring.map(() => nodeId++); nodes[nodes.length - 1] = nodes[0];
      const geometry = ring.map(([x, y]) => api.containerPointToLatLng(scale.cx + x / scale.scaleX,
        scale.cy - y / scale.scaleY, req.config.mapCrop, req.viewportWidth, req.viewportHeight));
      elements.push({ type: 'way', id, nodes, geometry, ...(rings.length === 1 ? { tags: { natural: 'water' } } : {}) });
      members.push({ type: 'way', ref: id, role: r ? 'inner' : 'outer' });
    }
    if (rings.length > 1) elements.push({ type: 'relation', id: 1000 + p, members, tags: { type: 'multipolygon', natural: 'water' } });
  }
  return { elements };
}
function setup(req, polygons, height = () => 0) {
  const crop = api.computeTerrainCropRegion(req.config.mapCrop, req.viewportWidth, req.viewportHeight);
  const heights = Float64Array.from({ length: 32 * 32 }, (_, i) => height(i % 32, Math.floor(i / 32)));
  const terrain = api.buildHeightfieldTerrainMesh(crop, heights, 32, 32, req.config.terrain.baseSolidThicknessMm);
  return { crop, terrain, data: dataFor(req, crop, polygons) };
}
function solid(mesh) {
  const source = new wasm.Mesh({ numProp: 3, vertProperties: new Float32Array(mesh.positions), triVerts: new Uint32Array(mesh.indices) });
  source.merge(); return new wasm.Manifold(source);
}
function assertClosed(mesh) {
  const stats = api.analyzeMesh(mesh);
  assert.equal(stats.boundaryEdges, 0); assert.equal(stats.nonManifoldEdges, 0); assert.equal(stats.degenerateTriangles, 0);
  const value = solid(mesh); try { assert.ok(value.volume() > 0); } finally { value.delete(); }
}
function overlap(a, b) {
  const x = solid(a), y = solid(b), shared = x.intersect(y);
  try { return shared.volume(); } finally { shared.delete(); x.delete(); y.delete(); }
}

test('terrain generation without GPX validates accessories and still requires GPX for a trail target', async () => {
  const req = request(); req.config.water.enabled = false;
  assert.equal(api.validateModelGeneration(req.config).valid, true);
  assert.equal(api.validateModelGeneration(req.config, { trailOnly: true }).scope, 'gpx');
  await assert.rejects(api.generateTerrainMain({ ...req, trailOnly: true }), /Import a GPX/);
  await assert.rejects(api.mountainTrailExportFlow.generateFiles({ ...req, target: 'trail' }, () => {}, () => assert.fail('Unexpected file')), /Import a GPX/);
  req.config.gpx.imported = true;
  assert.match(api.validateModelGeneration(req.config).message, /Not enough track points/);
  req.config.gpx.imported = false;
  req.config.tray.recessDepthMm = req.config.tray.totalThicknessMm + 1;
  assert.equal(api.validateModelGeneration(req.config).scope, 'tray');
});

for (const shape of ['circle', 'rectangle', 'polygon']) test(`${shape} terrain preview and ZIP work without GPX and omit trail parts`, async () => {
  const req = request(shape, 31); req.config.water.enabled = false;
  const preview = await api.generateTerrainMain(req);
  assert.ok(preview.heightPreview.heights.length > 0);
  assert.equal(preview.trailMesh, null);
  assert.deepEqual(preview.trailPolylineMm, []);
  const exported = await api.generateTerrainMain({ ...req, stlExport: true });
  assertClosed(exported.mesh);
  const files = {};
  await api.mountainTrailExportFlow.generateFiles(req, () => {}, (name, bytes) => { files[name] = bytes; });
  assert.ok(Object.keys(files).some(name => name.endsWith('_Terrain_Main.stl')));
  assert.ok(Object.keys(files).some(name => name.endsWith('_Tray_Base.stl')));
  assert.ok(!Object.keys(files).some(name => name.includes('Trail_Line')));
  assert.ok(Object.keys(files).every(name => name.startsWith('TrailPrint_')));
});

for (const mode of ['separate', 'fused']) test(`${mode} water and 3MF export work without GPX`, async () => {
  const req = request(); req.config.printMode = mode;
  const { crop } = setup(req, []);
  req.waterCatalog = catalogFor(req, crop, [[box(-25, -18, 25, 18)]]);
  const preview = await api.generateTerrainMain({ ...req, stlExport: true });
  assert.equal(preview.trailMesh, null);
  assert.ok(preview.waterMeshes.length > 0);
  [preview.mesh, ...preview.waterMeshes].forEach(assertClosed);
  const files = {};
  await api.mountainTrailExportFlow.generateFiles({ ...req, target: 'model-3mf' }, () => {}, (name, bytes) => { files[name] = bytes; });
  assert.equal(Object.keys(files).length, 1);
  const model = strFromU8(unzipSync(Object.values(files)[0])['3D/3dmodel.model']);
  assert.match(model, /name="Terrain"/);
  assert.match(model, /name="Water 1:/);
  assert.doesNotMatch(model, /name="Trail"/);
});

test('NFC cover and AMS base labels export without GPX or endpoint LED pockets', async () => {
  const req = request(); req.config.water.enabled = false;
  req.config.tray.nfc.enabled = true;
  req.config.tray.text.enabled = true;
  req.config.tray.text.labels = [{ text: 'MY PLACE', edge: 0 }];
  const files = {};
  await api.mountainTrailExportFlow.generateFiles(req, () => {}, (name, bytes) => { files[name] = bytes; });
  assert.ok(Object.keys(files).some(name => name.endsWith('_Tray_Cover.stl')));
  assert.ok(Object.keys(files).some(name => name.endsWith('_Tray_Text.stl')));
  const ams = {};
  await api.mountainTrailExportFlow.generateFiles({ ...req, target: 'ams-base' }, () => {}, (name, bytes) => { ams[name] = bytes; });
  assert.equal(Object.keys(ams).length, 1);
  assert.ok(Object.keys(ams)[0].endsWith('_Tray_AMS.3mf'));
});

test('Boolean export keeps unrelated coincident edges separate instead of making them non-manifold', () => {
  const req = request(), { terrain } = setup(req, []);
  const a = wasm.Manifold.cube([1, 1, 1]);
  const rawB = wasm.Manifold.cube([1, 1, 1]);
  const b = rawB.translate([1, 1, 0]);
  const composed = wasm.Manifold.compose([a, b]);
  try {
    const payload = api.waterMeshPayload(composed, terrain, 0);
    assert.equal(api.analyzeMesh(payload).nonManifoldEdges, 0);
    assert.equal(api.analyzeMesh(payload).boundaryEdges, 0);
    // The old export conversion fused the touching edges and refused downloads.
    const welded = api.weldMeshVertices(payload, 0.000001);
    assert.equal(api.analyzeMesh(welded).nonManifoldEdges, 1);
    assertClosed(payload);
  } finally { composed.delete(); b.delete(); rawB.delete(); a.delete(); }
});

test('water sits on a closed flat terrain pocket with no holes in its underside', () => {
  const req = request(), { crop, terrain, data } = setup(req, [[box(-20, -15, 20, 15)]]);
  const result = api.buildWaterGeometry(wasm, req, crop, data, terrain, []);
  assert.equal(result.waterMeshes.length, 1);
  for (const mesh of [result.mesh, ...result.waterMeshes]) assertClosed(mesh);
  const water = result.waterMeshes[0];
  assert.equal(Math.min(...water.positions.filter((_, i) => i % 3 === 2)), -req.config.water.thicknessMm);
  assert.ok(overlap(result.mesh, water) < 1e-6);
  assert.ok(result.mesh.positions.filter((_, i) => i % 3 === 2).every(z => z === 0 || z === water.bottomZ || z === terrain.bottomZ));
  const insert = solid(water);
  try {
    const expectedVolume = (40 - 2 * req.config.water.clearanceMm) * (30 - 2 * req.config.water.clearanceMm) * req.config.water.thicknessMm;
    assert.ok(Math.abs(insert.volume() - expectedVolume) < 0.001, 'the complete flat-bottom insert has no sockets');
  } finally { insert.delete(); }
});

test('clearance changes each shoreline by the requested amount while the insert stays seated', () => {
  for (const clearanceMm of [0, 0.15, 0.35]) {
    const req = request(); req.config.water.clearanceMm = clearanceMm;
    const { crop, terrain, data } = setup(req, [[box(-20, -15, 20, 15)]]);
    const result = api.buildWaterGeometry(wasm, req, crop, data, terrain, []);
    const water = result.waterMeshes[0];
    const x = water.positions.filter((_, i) => i % 3 === 0), y = water.positions.filter((_, i) => i % 3 === 1);
    assert.ok(Math.abs(Math.max(...x) - (20 - clearanceMm)) < 1e-5);
    assert.ok(Math.abs(Math.min(...x) - (-20 + clearanceMm)) < 1e-5);
    assert.ok(Math.abs(Math.max(...y) - (15 - clearanceMm)) < 1e-5);
    assertClosed(result.mesh); assertClosed(water);
    assert.ok(overlap(result.mesh, water) < 1e-6);
    const main = solid(result.mesh);
    const block = wasm.Manifold.cube([0.5, 0.5, 0.1], true);
    const bed = block.translate([0, 0, water.bottomZ - 0.05]);
    const air = block.translate([0, 0, water.bottomZ + 0.05]);
    const supported = main.intersect(bed), clear = main.intersect(air);
    try { assert.ok(Math.abs(supported.volume() - 0.025) < 1e-6); assert.ok(clear.volume() < 1e-6); }
    finally { supported.delete(); clear.delete(); air.delete(); bed.delete(); block.delete(); main.delete(); }
  }
});

test('small water areas that previously could not hold pins now export as seated inserts', () => {
  const req = request(), { crop, terrain, data } = setup(req, [[box(-0.5, -0.5, 0.5, 0.5)], [box(2, -5, 3.2, 5)]]);
  const result = api.buildWaterGeometry(wasm, req, crop, data, terrain, []);
  assert.equal(result.waterMeshes.length, 2);
  assert.deepEqual(result.waterWarnings, []);
  assertClosed(result.mesh);
  for (const water of result.waterMeshes) { assertClosed(water); assert.ok(overlap(result.mesh, water) < 1e-6); }
});

test('a printable water piece survives when clearance splits off an unprintable neighbor', () => {
  const req = request();
  const outline = [[-10,-5],[0,-5],[0,-0.1],[2,-0.1],[2,-0.2],[2.8,-0.2],
    [2.8,0.2],[2,0.2],[2,0.1],[0,0.1],[0,5],[-10,5],[-10,-5]];
  const { crop, terrain, data } = setup(req, [[outline]]);
  const result = api.buildWaterGeometry(wasm, req, crop, data, terrain, []);
  assert.equal(result.waterMeshes.length, 1); assertClosed(result.mesh); assertClosed(result.waterMeshes[0]);
  const main = solid(result.mesh), block = wasm.Manifold.cube([0.3, 0.1, 0.2], true);
  const probe = block.translate([2.4, 0, -0.1]), remaining = main.intersect(probe);
  try { assert.ok(Math.abs(remaining.volume() - 0.006) < 1e-6, 'omitted water leaves its terrain surface intact'); }
  finally { remaining.delete(); probe.delete(); block.delete(); main.delete(); }
});

test('multipolygon islands remain in the terrain and trails reserve an unobstructed corridor', () => {
  const req = request(), { crop, terrain, data } = setup(req, [[box(-25, -18, 25, 18), box(-5, -5, 5, 5)]]);
  const result = api.buildWaterGeometry(wasm, req, crop, data, terrain, [{ x: -40, y: 10 }, { x: 40, y: 10 }]);
  assert.equal(result.waterMeshes.length, 2);
  const island = wasm.Manifold.cube([8, 8, 1], true).translate([0, 0, -0.5]);
  const main = solid(result.mesh), islandOverlap = main.intersect(island);
  try { assert.ok(Math.abs(islandOverlap.volume() - 64) < 1e-5); }
  finally { island.delete(); main.delete(); islandOverlap.delete(); }
  for (const part of result.waterMeshes) {
    assertClosed(part); assert.ok(overlap(result.mesh, part) < 1e-6);
    const route = wasm.Manifold.cube([80, 1, 4], true).translate([0, 10, 0]);
    const water = solid(part), hit = water.intersect(route);
    try { assert.ok(hit.volume() < 1e-6); } finally { route.delete(); water.delete(); hit.delete(); }
  }
  assertClosed(result.mesh);
});

for (const shape of ['circle', 'rectangle', 'polygon']) test(`${shape} rotated water is clipped to the actual footprint`, () => {
  const req = request(shape, 37); req.config.mapCrop.polygonSides = 5;
  const { crop, terrain, data } = setup(req, [[box(-100, -20, 15, 20)]]);
  const result = api.buildWaterGeometry(wasm, req, crop, data, terrain, []);
  assert.ok(result.waterMeshes.length > 0); assertClosed(result.mesh);
  for (const water of result.waterMeshes) { assertClosed(water); assert.ok(overlap(result.mesh, water) < 1e-5); }
});

test('empty and below-print-scale water leave terrain intact with actionable status', () => {
  const req = request(), { crop, terrain } = setup(req, []);
  for (const data of [{ elements: [] }, dataFor(req, crop, [[box(-0.1, -0.1, 0.1, 0.1)]])]) {
    const result = api.buildWaterGeometry(wasm, req, crop, data, terrain, []);
    assert.equal(result.mesh, terrain); assert.equal(result.waterMeshes.length, 0);
    assert.ok(result.waterWarnings.length > 0);
  }
});

test('water validation protects pocket floors and accepts thinner inserts without sockets', () => {
  const req = request(); req.config.water.thicknessMm = 0.5;
  assert.equal(api.validateModelGeneration(req.config, { requireGpx: false }).valid, true);
  req.config.water.thicknessMm = 2;
  assert.match(api.validateModelGeneration(req.config, { requireGpx: false }).message, /terrain base thickness/);
  req.config.water.clearanceMm = -1;
  assert.match(api.validateModelGeneration(req.config, { requireGpx: false }).message, /clearance/);
  assert.equal(api.validateModelGeneration(req.config, { requireGpx: false, trailOnly: true }).valid, true);
});

test('terrain preview and ZIP export include fitted inserts and keep standalone trail independent', async () => {
  const req = request();
  req.config.gpx = { ...req.config.gpx, imported: true, points: [{ lat: 40.177, lon: 44.505 }, { lat: 40.183, lon: 44.515 }],
    rawPoints: [{ lat: 40.177, lon: 44.505 }, { lat: 40.183, lon: 44.515 }], pointCount: 2, fileName: 'water-test.gpx' };
  const { crop, data } = setup(req, [[box(-25, -18, 25, 18)]]);
  let calls = 0;
  globalThis.__waterMap = async (request) => { calls++; assert.equal(request.water, true); assert.equal(request.buildings, false); assert.equal(request.roads, false); return data; };
  const preview = await api.generateTerrainMain(req);
  assert.ok(preview.waterMeshes.length > 0); assertClosed(preview.mesh);
  const files = {};
  await api.mountainTrailExportFlow.generateFiles(req, () => {}, (name, value) => { files[name] = value; });
  assert.ok(Object.keys(files).some((name) => /Water_Insert.*\.stl$/.test(name)));
  assert.ok(!Object.keys(files).some(name => /Water_Pins\.stl$/.test(name)));
  const guide = new TextDecoder().decode(files[api.modelExportFileName(req.config, 'Water_Assembly.txt')]);
  assert.match(guide, /flat pocket floor/); assert.match(guide, /glue/); assert.match(guide, /OpenStreetMap contributors/);
  assert.doesNotMatch(guide, /pin|socket/i);
  const exportResult = await api.generateTerrainMain({ ...req, stlExport: true });
  for (let i = 0; i < preview.waterMeshes.length; i++) assert.deepEqual(preview.waterMeshes[i], exportResult.waterMeshes[i]);
  assert.equal(calls, 3);
  globalThis.__waterMap = async () => { throw new Error('Water provider unavailable'); };
  const partial = await api.generateTerrainMain(req);
  assert.ok(partial.waterCoverageErrors.some(error => /Water provider unavailable/.test(error.message)));
  assert.deepEqual(partial.waterMeshes, []);
  const trail = await api.generateTerrainMain({ ...req, stlExport: true, trailOnly: true });
  assert.ok(trail.trailMesh); assert.deepEqual(trail.waterMeshes, []);
  req.config.water.enabled = false;
  const withoutWater = await api.generateTerrainMain(req); assert.deepEqual(withoutWater.waterMeshes, []);
});

function catalogFor(req, crop, polygons) {
  return { key: api.waterCatalogKey({ mapCrop: req.config.mapCrop, viewportWidth: req.viewportWidth, viewportHeight: req.viewportHeight }),
    features: api.osmWaterFeatures(dataFor(req, crop, polygons)), sources: [api.OSM_WATER_ATTRIBUTION], errors: [], fetchedAt: '2026-10-14T00:00:00Z' };
}

test('a lake enclosing the crop retains a protective wall and its islands', () => {
  const req = request(), { crop, terrain } = setup(req, []);
  const data = catalogFor(req, crop, [[box(-200, -200, 200, 200), box(-5, -5, 5, 5)]]);
  const result = api.buildWaterGeometry(wasm, req, crop, data, terrain, []);
  assert.equal(result.waterMeshes.length, 1);
  for (const part of [result.mesh, ...result.waterMeshes]) assertClosed(part);
  const xs = result.waterMeshes[0].positions.filter((_, i) => i % 3 === 0);
  assert.ok(Math.max(...xs) <= crop.widthMm / 2 - .6 - req.config.water.clearanceMm + 1e-5);
});

test('complete OSM geometry suppresses duplicate lake sources, even when excluded', () => {
  const req = request(), { crop, terrain } = setup(req, []);
  const data = catalogFor(req, crop, [[box(-20, -20, 20, 20)]]);
  const osm = data.features[0];
  data.features.push({ ...osm, id: 'hydrolakes:42', sourceId: '42', source: { ...osm.source, id: 'hydrolakes', version: '1' } });
  for (const excluded of [false, true]) {
    req.config.water.excludedFeatureIds = excluded ? [osm.id] : [];
    const result = api.buildWaterGeometry(wasm, req, crop, data, terrain, []);
    assert.equal(result.waterMeshes.length, excluded ? 0 : 1);
    assert.equal(result.waterFeatureStatuses.find(s => s.featureId === 'hydrolakes:42').state, 'covered');
    if (!excluded) assert.deepEqual(result.waterPartMappings[0].featureIds, [osm.id]);
  }
  req.config.water.excludedFeatureIds = [];
  req.config.water.categories = ['river'];
  assert.equal(api.buildWaterGeometry(wasm, req, crop, data, terrain, []).waterMeshes.length, 0);
});

test('the real Azat river remains continuous when its overlapping short records are hidden', async () => {
  const req = request();
  Object.assign(req.config.mapCrop, { lengthMm: 120, widthMm: 80, mapCenterLat: 40.04, mapCenterLon: 44.56, mapZoom: 12.9, mapBearingDeg: 45 });
  const { crop, terrain } = setup(req, []);
  const data = JSON.parse(await readFile('fixtures/water/azat-osm.json', 'utf8'));
  data.key = api.waterCatalogKey({ mapCrop: req.config.mapCrop, viewportWidth: req.viewportWidth, viewportHeight: req.viewportHeight });
  const keep = ['osm:relation/17884226', 'osm:way/419632551', 'osm:way/74412858', 'osm:way/1010915009'];
  req.config.water.excludedFeatureIds = data.features.filter(feature => !keep.includes(feature.id)).map(feature => feature.id);
  const result = api.buildWaterGeometry(wasm, req, crop, data, terrain, []);
  assert.equal(result.waterMeshes.length, 1, 'hidden overlapping records must not cut holes out of the selected Azat river');
  assertClosed(result.mesh); assertClosed(result.waterMeshes[0]);
  assert.deepEqual(result.waterPartMappings[0].featureIds, ['osm:way/1010915009', 'osm:way/419632551', 'osm:way/74412858']);
  assert.equal(result.waterFeatureStatuses.find(status => status.featureId === 'osm:way/419632554').state, 'excluded');
});

for (const geometryType of ['Polygon', 'LineString']) test(`adjacent river ${geometryType} segments remain continuous after clearance and can still be hidden individually`, () => {
  const req = request(), { crop, terrain } = setup(req, []);
  const data = catalogFor(req, crop, [[box(-30, -.8, -10, .8)], [box(-10, -.8, 10, .8)], [box(10, -.8, 30, .8)]]);
  data.features = data.features.map(feature => ({ ...feature, category: 'river', name: 'Connected river',
    ...(geometryType === 'LineString' ? { geometry: { type: 'LineString', coordinates: feature.geometry.coordinates[0].slice(0, 2) } } : {}) }));
  const joined = api.buildWaterGeometry(wasm, req, crop, data, terrain, []);
  assert.equal(joined.waterMeshes.length, 1, 'adjoining source segments should produce one connected printable insert');
  assert.deepEqual(joined.waterPartMappings[0].featureIds, data.features.map(feature => feature.id));
  assert.ok(joined.waterFeatureStatuses.every(status => status.state === 'included' && status.partIndices[0] === 0));
  assertClosed(joined.mesh); assertClosed(joined.waterMeshes[0]);
  const river = solid(joined.waterMeshes[0]), cube = wasm.Manifold.cube([.08, .08, .5], true);
  const seam = cube.translate([-10, geometryType === 'LineString' ? -.8 : 0, -.25]), wet = river.intersect(seam);
  try { assert.ok(wet.volume() > .003, 'clearance must not cut an artificial dry gap at the source boundary'); }
  finally { wet.delete(); seam.delete(); cube.delete(); river.delete(); }
  req.config.water.excludedFeatureIds = [data.features[1].id];
  const hidden = api.buildWaterGeometry(wasm, req, crop, data, terrain, []);
  assert.equal(hidden.waterMeshes.length, 2);
  assert.equal(hidden.waterFeatureStatuses.find(status => status.featureId === data.features[1].id).state, 'excluded');
  assert.ok(hidden.waterPartMappings.every(part => !part.featureIds.includes(data.features[1].id)));
  assertClosed(hidden.mesh); hidden.waterMeshes.forEach(assertClosed);
  req.config.water.excludedFeatureIds = [];
  const crossing = api.buildWaterGeometry(wasm, req, crop, data, terrain, [{ x: -10, y: -5 }, { x: -10, y: 5 }]);
  assert.equal(crossing.waterMeshes.length, 2, 'the terrain supporting a trail crossing must still separate the inserts');
  assertClosed(crossing.mesh); crossing.waterMeshes.forEach(assertClosed);
});

test('river centerlines use measured widths, printable widening and stable feature mappings', () => {
  const req = request(), { crop, terrain } = setup(req, []);
  const polygonCatalog = catalogFor(req, crop, [[box(-30, -10, 30, 10)]]), polygon = polygonCatalog.features[0].geometry.coordinates[0];
  const feature = { ...polygonCatalog.features[0], id: 'osm:way/river', category: 'river',
    geometry: { type: 'LineString', coordinates: [polygon[0], polygon[1]] }, widthM: .1 };
  polygonCatalog.features = [feature];
  const result = api.buildWaterGeometry(wasm, req, crop, polygonCatalog, terrain, []);
  assert.equal(result.waterMeshes.length, 1); assertClosed(result.waterMeshes[0]);
  assert.equal(result.waterFeatureStatuses[0].exaggerated, true);
  assert.ok(Math.abs(result.waterFeatureStatuses[0].printedWidthMm - .8) < 1e-6);
  req.config.water.riverWidthMultiplier = 2;
  polygonCatalog.features[0].widthM = 100;
  const wider = api.buildWaterGeometry(wasm, req, crop, polygonCatalog, terrain, []);
  assert.ok(wider.waterFeatureStatuses[0].printedWidthMm > .8);
  req.config.water.minimumAreaMm2 = 5000;
  const omitted = api.buildWaterGeometry(wasm, req, crop, polygonCatalog, terrain, []);
  assert.equal(omitted.mesh, terrain); assert.equal(omitted.waterMeshes.length, 0);
  assert.equal(omitted.waterFeatureStatuses[0].state, 'too-small');
});

test('seas use a flat sea-level surface while preserving islands and floor thickness', () => {
  const req = request(), { crop, terrain } = setup(req, [], (x, y) => (x + y) * .015);
  const data = catalogFor(req, crop, [[box(-20, -20, 20, 20), box(-3, -3, 3, 3)]]);
  data.features[0].category = 'sea';
  data.features[0].source.id = 'coastline';
  const result = api.buildWaterGeometry(wasm, req, crop, data, terrain, [], undefined, .5);
  const water = result.waterMeshes[0];
  assertClosed(water); assertClosed(result.mesh);
  assert.ok(water.positions.filter((_, i) => i % 3 === 2).every(z => Math.abs(z - .5) < 1e-6 || Math.abs(z - water.bottomZ) < 1e-6));
  assert.ok(water.bottomZ >= terrain.bottomZ + .4);
  assert.ok(overlap(result.mesh, water) < 1e-6);
  const heights = Float64Array.of(-100, 500);
  const transform = api.elevationsToHeightMmInPlace(heights, crop, 2, 'standard', { maxGrid: 64 });
  assert.ok(Math.abs(transform.seaLevelMm - 100 * transform.mmPerMeter) < 1e-8);
});

test('bed-normalized parts restore their assembly placement exactly', () => {
  const req = request(), { terrain } = setup(req, []);
  const normalized = api.normalizePartToBed(terrain);
  assert.equal(Math.min(...normalized.mesh.positions.filter((_, i) => i % 3 === 2)), 0);
  normalized.mesh.positions.forEach((value, i) => assert.equal(value + normalized.assemblyTranslation[i % 3], terrain.positions[i]));
});

test('fused preview and complete 3MF have closed, touching material volumes and independent groups', async () => {
  const req = request(); req.config.printMode = 'fused';
  req.config.gpx = { ...req.config.gpx, imported: true, points: [{ lat: 40.177, lon: 44.505 }, { lat: 40.183, lon: 44.515 }],
    rawPoints: [{ lat: 40.177, lon: 44.505 }, { lat: 40.183, lon: 44.515 }], pointCount: 2, fileName: 'complete-model.gpx' };
  const { crop } = setup(req, []);
  req.waterCatalog = catalogFor(req, crop, [[box(-25, -18, 25, 18)]]);
  const preview = await api.generateTerrainMain(req);
  for (const part of [preview.mesh, preview.trailMesh, ...preview.waterMeshes]) assertClosed(part);
  const materials = [preview.mesh, preview.trailMesh, ...preview.waterMeshes].map(solid), combined = wasm.Manifold.union(materials), pieces = combined.decompose();
  try {
    assert.equal(pieces.filter(piece => piece.volume() > 1e-6).length, 1);
    assert.ok(Math.abs(combined.volume() - materials.reduce((v, s) => v + s.volume(), 0)) < 1e-4, 'material volumes have no positive-volume overlap');
  } finally { pieces.forEach(s => s.delete()); combined.delete(); materials.forEach(s => s.delete()); }
  const files = {};
  req.target = 'model-3mf';
  await api.mountainTrailExportFlow.generateFiles(req, () => {}, (name, value) => { files[name] = value; });
  const names = Object.keys(files);
  assert.equal(names.length, 1); assert.match(names[0], /Model\.3mf$/);
  const parts = unzipSync(files[names[0]]), model = strFromU8(parts['3D/3dmodel.model']);
  assert.equal((model.match(/<item /g) ?? []).length, 2);
  assert.match(model, /name="Terrain"/); assert.match(model, /name="Trail"/); assert.match(model, /name="Water 1:/); assert.match(model, /name="Tray"/);
  assert.match(model, /color="#268FBCFF"/);
  const metadata = JSON.parse(strFromU8(parts['Metadata/trailprint.json']));
  assert.equal(metadata.metadata.printMode, 'fused'); assert.ok(metadata.metadata.sources.length);
  assert.ok(metadata.placements[1].translationMm[1] > 100);
  await writeFile('/tmp/trailprint-complete-model.3mf', files[names[0]]);
  assert.match(strFromU8(parts['Metadata/model_settings.config']), /key="name" value="Water 1:/);
  assert.match(strFromU8(parts['Metadata/model_settings.config']), /key="extruder" value="3"/);
  // Camera navigation and window resizing must not change an anchored export.
  const { mapCenterLat, mapCenterLon, mapZoom, mapBearingDeg } = req.config.mapCrop;
  req.config.mapCrop.selection = { mapCenterLat, mapCenterLon, mapZoom, mapBearingDeg, viewportWidth: req.viewportWidth, viewportHeight: req.viewportHeight };
  Object.assign(req.config.mapCrop, { mapCenterLat: 41, mapCenterLon: 45, mapZoom: 18, mapBearingDeg: 65 });
  assert.equal(api.waterCatalogKey({ mapCrop: req.config.mapCrop, viewportWidth: 390, viewportHeight: 700 }), req.waterCatalog.key);
  const navigated = {};
  await api.mountainTrailExportFlow.generateFiles({ ...req, viewportWidth: 390, viewportHeight: 700 }, () => {}, (name, value) => { navigated[name] = value; });
  assert.ok(strFromU8(unzipSync(Object.values(navigated)[0])['3D/3dmodel.model']) === model, 'Bambu geometry retains the selected area after map navigation');
});


test('fused mountain relief remains closed and connected across a terrain-following lake', async () => {
  const req = request(); req.config.printMode = 'fused';
  req.config.tray.text.enabled = true;
  req.config.tray.text.labels = [{ text: 'WATER TEST', edge: 0 }];
  req.config.gpx = { ...req.config.gpx, imported: true, points: [{ lat: 40.177, lon: 44.505 }, { lat: 40.183, lon: 44.515 }],
    rawPoints: [{ lat: 40.177, lon: 44.505 }, { lat: 40.183, lon: 44.515 }], pointCount: 2, fileName: 'mountain-relief.gpx' };
  const { crop } = setup(req, []); req.waterCatalog = catalogFor(req, crop, [[box(-25, -18, 25, 18), box(-4, -3, 4, 3)]]);
  globalThis.__waterElevation = (x, y, cols, rows) => 500 + 150 * Math.sin(Math.PI * x / cols) * Math.sin(Math.PI * y / rows);
  try {
    const preview = await api.generateTerrainMain(req);
    for (const part of [preview.mesh, preview.trailMesh, ...preview.waterMeshes]) assertClosed(part);
    assert.ok(Math.max(...preview.mesh.positions.filter((_, i) => i % 3 === 2)) > 1);
    const files = {}; req.target = 'model-3mf';
    await api.mountainTrailExportFlow.generateFiles(req, () => {}, (name, value) => { files[name] = value; });
    await writeFile('/tmp/trailprint-mountain-relief.3mf', Object.values(files)[0]);
  } finally { delete globalThis.__waterElevation; }
});


test('clearance calibration coupons have closed flat seats and bed-ready inserts', async () => {
  const files = {};
  for (const clearance of [.1, .15, .2]) {
    const req = request(); req.config.mapCrop.lengthMm = 15; req.config.mapCrop.widthMm = 15;
    req.config.water.clearanceMm = clearance;
    const { crop, terrain, data } = setup(req, [[box(-5, -5, 5, 5)]]);
    const result = api.buildWaterGeometry(wasm, req, crop, data, terrain, []);
    assert.equal(result.waterMeshes.length, 1);
    for (const [name, part] of [['Terrain', result.mesh], ['Water', result.waterMeshes[0]]]) {
      assertClosed(part);
      const normalized = api.normalizePartToBed(part).mesh;
      assert.equal(Math.min(...normalized.positions.filter((_, i) => i % 3 === 2)), 0);
      files[`Coupon_${clearance.toFixed(2)}mm_${name}.stl`] = api.encodeBinaryStl(normalized, name);
    }
  }
  files['Read_me.txt'] = new TextEncoder().encode('Experimental TrailPrint clearance coupons\nPrint the matching Terrain and Water pair at each clearance without scaling.\nEach coupon is 15 × 15 × 2 mm, with a 1 mm water insert. Clearances are per side.\nCompare 0.10, 0.15 and 0.20 mm on your printer. Check dry fit, complete seat contact and remaining floor.\nThese files do not establish a validated fit; record your physical test results.\n');
  await writeFile('/tmp/trailprint-clearance-coupons.zip', zipSync(files));
});
