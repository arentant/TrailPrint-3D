import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import Module from 'manifold-3d';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const compiled = await build({
  stdin: { contents: `export * from './shared/water/geometry'; export * from './shared/water/mesh-payload'; export * from './shared/types/config';
    export * from './shared/utils/heightfield-mesh'; export * from './shared/utils/mesh-manifold';
    export * from './shared/utils/crop-region'; export * from './shared/utils/map-mm-projection';
    export * from './shared/utils/leaflet-projection'; export * from './shared/utils/model-validation';
    export * from './shared/export/export-artifact'; export * from './electron/main/terrain/terrain-main-service';
    export * from './electron/main/export/mountain-trail-flow';`, resolveDir: resolve('.') },
  bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'water-fixtures', setup(plugin) {
    plugin.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
    plugin.onResolve({ filter: /^\.\/manifold-runtime$/ }, () => ({ path: 'manifold', namespace: 'fixture' }));
    plugin.onResolve({ filter: /^\.\/city-map-provider$/ }, () => ({ path: 'map', namespace: 'fixture' }));
    plugin.onResolve({ filter: /^\.\/dem-provider$/ }, () => ({ path: 'dem', namespace: 'fixture' }));
    plugin.onResolve({ filter: /^\.\.\/gpx\/hydrate-gpx-config$/ }, () => ({ path: 'gpx', namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: {
      electron: 'export const nativeImage = {}; export const app = {};',
      manifold: 'export const getManifold = async () => globalThis.__waterWasm;',
      map: 'export const loadCityMapData = (...args) => globalThis.__waterMap(...args);',
      dem: 'export const sampleDemGrid = async (_crop, cols, rows) => ({cols, rows, elevations: new Float64Array(cols * rows).fill(500), source: "opentopography"});',
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

test('water and terrain have closed complementary pockets with loose pins and flat insert bottoms', () => {
  const req = request(), { crop, terrain, data } = setup(req, [[box(-20, -15, 20, 15)]]);
  const result = api.buildWaterGeometry(wasm, req, crop, data, terrain, []);
  assert.equal(result.waterMeshes.length, 1); assert.equal(result.waterPinMeshes.length, 2);
  for (const mesh of [result.mesh, ...result.waterMeshes, ...result.waterPinMeshes]) assertClosed(mesh);
  const water = result.waterMeshes[0];
  assert.equal(Math.min(...water.positions.filter((_, i) => i % 3 === 2)), -req.config.water.thicknessMm);
  assert.ok(overlap(result.mesh, water) < 1e-6);
  for (const pin of result.waterPinMeshes) {
    assert.ok(overlap(result.mesh, pin) < 1e-6); assert.ok(overlap(water, pin) < 1e-6);
    const z = pin.positions.filter((_, i) => i % 3 === 2);
    assert.ok(Math.abs(Math.max(...z) - Math.min(...z) - (2 * req.config.water.pinDepthMm - 0.1)) < 1e-5);
  }
  assert.ok(result.mesh.positions.some((value, i) => i % 3 === 2 && Math.abs(value + 1.6) < 1e-5), 'terrain has pin sockets below the water seat');
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

test('empty, incomplete and sub-pin-scale water leave terrain intact with actionable status', () => {
  const req = request(), { crop, terrain } = setup(req, []);
  for (const data of [{ elements: [] }, dataFor(req, crop, [[box(-0.5, -0.5, 0.5, 0.5)]])]) {
    const result = api.buildWaterGeometry(wasm, req, crop, data, terrain, []);
    assert.equal(result.mesh, terrain); assert.equal(result.waterMeshes.length, 0); assert.equal(result.waterPinMeshes.length, 0);
    assert.ok(result.waterWarnings.length > 0);
  }
});

test('water validation protects socket roofs and terrain floors, while trail-only ignores water', () => {
  const req = request(); req.config.water.thicknessMm = 0.5;
  assert.match(api.validateModelGeneration(req.config, { requireGpx: false }).message, /socket depth plus 0.4/);
  req.config.water.thicknessMm = 2;
  assert.match(api.validateModelGeneration(req.config, { requireGpx: false }).message, /terrain base thickness/);
  req.config.water.clearanceMm = -1;
  assert.match(api.validateModelGeneration(req.config, { requireGpx: false }).message, /clearance/);
  assert.equal(api.validateModelGeneration(req.config, { requireGpx: false, trailOnly: true }).valid, true);
});

test('terrain preview and ZIP export detect water, include pin parts and keep standalone trail independent', async () => {
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
  const pins = files[api.modelExportFileName(req.config, 'Water_Pins.stl')]; assert.ok(pins);
  const view = new DataView(pins.buffer, pins.byteOffset, pins.byteLength);
  assert.ok(view.getUint32(80, true) > 0);
  for (let face = 0; face < view.getUint32(80, true); face++) for (let v = 0; v < 3; v++) {
    assert.ok(view.getFloat32(84 + face * 50 + 12 + v * 12 + 8, true) >= -1e-5, 'print pins are placed on the bed');
  }
  const guide = new TextDecoder().decode(files[api.modelExportFileName(req.config, 'Water_Assembly.txt')]);
  assert.match(guide, /underside sockets/); assert.match(guide, /OpenStreetMap contributors/);
  const exportResult = await api.generateTerrainMain({ ...req, stlExport: true });
  for (let i = 0; i < preview.waterMeshes.length; i++) assert.deepEqual(preview.waterMeshes[i], exportResult.waterMeshes[i]);
  assert.equal(calls, 3);
  globalThis.__waterMap = async () => { throw new Error('Water provider unavailable'); };
  await assert.rejects(api.generateTerrainMain(req), /Water provider unavailable/);
  const trail = await api.generateTerrainMain({ ...req, stlExport: true, trailOnly: true });
  assert.ok(trail.trailMesh); assert.deepEqual(trail.waterMeshes, []);
  req.config.water.enabled = false;
  const withoutWater = await api.generateTerrainMain(req); assert.deepEqual(withoutWater.waterMeshes, []);
});
