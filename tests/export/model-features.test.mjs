import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import Module from 'manifold-3d';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';

const compiled = await build({
  stdin: { contents: `export * from './shared/types/config'; export * from './shared/utils/model-features';
    export * from './shared/utils/model-features-mesh'; export * from './shared/utils/crop-region';
    export * from './shared/utils/heightfield-mesh'; export * from './shared/utils/mesh-manifold';
    export * from './shared/utils/model-validation'; export * from './shared/utils/assembly-layout';
    export * from './shared/utils/map-mm-projection';
    export * from './shared/utils/logo-trace';
    export * from './shared/utils/model-placement-presets';
    export * from './electron/main/terrain/terrain-main-service'; export * from './electron/main/export/mountain-trail-flow';`, resolveDir: resolve('.') },
  bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'model-fixtures', setup(plugin) {
    plugin.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
    plugin.onResolve({ filter: /^(\.\/|\.\.\/city\/)manifold-runtime$/ }, () => ({ path: 'manifold', namespace: 'fixture' }));
    plugin.onResolve({ filter: /^\.\/dem-provider$/ }, () => ({ path: 'dem', namespace: 'fixture' }));
    plugin.onResolve({ filter: /^\.\.\/gpx\/hydrate-gpx-config$/ }, () => ({ path: 'gpx', namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: {
      electron: 'export const nativeImage = {}; export const app = {};',
      manifold: 'export const getManifold = async () => globalThis.__featuresWasm;',
      dem: 'export const sampleDemGrid = async (_crop, cols, rows) => ({cols, rows, elevations: Float64Array.from({ length: cols * rows }, (_, i) => 500 + 30 * Math.sin(i % cols / cols * Math.PI)), source: "opentopography"});',
      gpx: 'export const hydrateGpxConfig = async config => config;',
    }[path] }));
  } }],
});
const directory = await mkdtemp(join(tmpdir(), 'trailprint-model-features-'));
after(() => rm(directory, { recursive: true, force: true }));
await writeFile(join(directory, 'model.mjs'), compiled.outputFiles[0].contents);
const api = await import(pathToFileURL(join(directory, 'model.mjs')).href);
let wasm;
before(async () => { wasm = await Module(); wasm.setup(); globalThis.__featuresWasm = wasm; });

function request(shape = 'circle', sides = 6, corner = 0) {
  const config = api.createDefaultConfig();
  Object.assign(config.mapCrop, { shape, polygonSides: sides, cornerRadiusMm: corner });
  Object.assign(config.terrain, { meshQuality: 'custom', meshQualityCustom: { maxGrid: 64 }, baseSolidThicknessMm: 3 });
  return { config, viewportWidth: 800, viewportHeight: 600 };
}
function source(config) {
  const crop = api.computeTerrainCropRegion(config.mapCrop, 800, 600);
  const field = Float64Array.from({ length: 33 * 33 }, (_, i) => 1 + Math.sin(i % 33 / 33 * Math.PI));
  return { crop, mesh: api.buildHeightfieldTerrainMesh(crop, field, 33, 33, config.terrain.baseSolidThicknessMm) };
}
function check(mesh) {
  const analysis = api.analyzeMesh(mesh);
  assert.equal(analysis.boundaryEdges, 0);
  assert.equal(analysis.nonManifoldEdges, 0);
  assert.equal(analysis.degenerateTriangles, 0);
  const raw = new wasm.Mesh({ numProp: 3, vertProperties: new Float32Array(mesh.positions), triVerts: new Uint32Array(mesh.indices) });
  raw.merge(); const solid = new wasm.Manifold(raw);
  try {
    assert.equal(solid.status(), 'NoError');
    assert.ok(solid.volume() > 0);
    const parts = solid.decompose();
    assert.equal(parts.length, 1, 'all lettering and the caption remain joined to the model');
    for (const part of parts) part.delete();
  } finally { solid.delete(); }
}
function hits(mesh, x, y) {
  let count = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = mesh.indices.slice(i, i + 3).map(index => mesh.positions.slice(index * 3, index * 3 + 3));
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) continue;
    const u = ((x - a[0]) * (c[1] - a[1]) - (y - a[1]) * (c[0] - a[0])) / area;
    const v = ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / area;
    if (u >= 0 && v >= 0 && u + v <= 1) count++;
  }
  return count;
}

for (const [shape, sides, corner] of [['circle', 6, 0], ['rectangle', 6, 0], ['rectangle', 6, 6], ['polygon', 3, 0], ['polygon', 6, 3], ['polygon', 8, 0]]) {
  for (const style of ['raised', 'engraved']) for (const placement of ['front', 'underside', 'both']) {
    test(`${shape} ${sides} corners ${corner}: ${style} ${placement} text and direct keychain hole form one closed solid`, () => {
      const { config } = request(shape, sides, corner);
      Object.assign(config.terrain.text, { enabled: true, title: 'ARAGATS', subtitle: '4,090 m', style, placement });
      config.terrain.keychain.enabled = true;
      if (shape === 'polygon' && sides === 3) config.terrain.keychain.offsetMm = 8;
      const validation = api.validateModelGeneration(config);
      assert.equal(validation.valid, true, validation.message);
      const { crop, mesh } = source(config);
      const result = api.applyModelFeatures(wasm, config, crop, mesh, null, []).mesh;
      check(result);
      const hole = api.computeModelKeychainHole(config, crop);
      assert.equal(hits(result, hole.center.x, hole.center.y), 0);
      for (let i = 0; i < 16; i++) {
        const angle = i * Math.PI / 8;
        assert.equal(hits(result, hole.center.x + Math.cos(angle) * hole.radiusMm * 0.98, hole.center.y + Math.sin(angle) * hole.radiusMm * 0.98), 0);
      }
      if (placement !== 'front' && style === 'raised') assert.ok(Math.abs(result.bottomZ - mesh.bottomZ + config.terrain.text.heightMm) < 1e-5);
      else assert.ok(Math.abs(result.bottomZ - mesh.bottomZ) < 1e-5);
    });
  }
}

test('a direct model hole stays clear through crossing trail and water materials', () => {
  const { config } = request('rectangle'); config.terrain.keychain.enabled = true;
  config.terrain.keychain.position = { xMm: 13, yMm: -17 };
  const { crop, mesh } = source(config);
  const hole = api.computeModelKeychainHole(config, crop);
  // Three stacked volumes exercise each output without depending on remote map data.
  const shift = amount => ({ ...mesh, positions: mesh.positions.map((v, i) => i % 3 === 2 ? v + amount : v), bottomZ: mesh.bottomZ + amount });
  const result = api.applyModelFeatures(wasm, config, crop, mesh, shift(4), [shift(8)]);
  for (const part of [result.mesh, result.trailMesh, ...result.waterMeshes]) { check(part); assert.equal(hits(part, hole.center.x, hole.center.y), 0); }
});

test('every model edge can host a hole, including rounded corners and circular arc offsets', () => {
  for (const [shape, sides, corner] of [['circle', 6, 0], ['rectangle', 6, 6], ['polygon', 3, 0], ['polygon', 6, 3], ['polygon', 8, 0]]) {
    const { config } = request(shape, sides, corner);
    config.terrain.keychain.enabled = true;
    const { crop, mesh } = source(config);
    for (let edge = 0; edge < api.modelEdgeCount(config); edge++) {
      config.terrain.keychain.edge = edge;
      for (const offset of [-3, 3]) {
        config.terrain.keychain.offsetMm = offset;
        const hole = api.computeModelKeychainHole(config, crop);
        const result = api.applyModelFeatures(wasm, config, crop, mesh, null, []).mesh;
        check(result);
        assert.equal(hits(result, hole.center.x, hole.center.y), 0);
      }
    }
  }
});

test('a separately downloaded trail keeps the same keychain bore as the complete model', async () => {
  const req = request('rectangle'), config = req.config;
  config.terrain.keychain.enabled = true;
  config.terrain.keychain.position = { xMm: 17, yMm: 9 };
  const crop = api.computeTerrainCropRegion(config.mapCrop, req.viewportWidth, req.viewportHeight);
  const hole = api.computeModelKeychainHole(config, crop);
  const points = [[hole.center.x, hole.center.y - 12], [hole.center.x, hole.center.y + 12]].map(([x, y]) =>
    api.modelMmToLatLon(x, y, config.mapCrop, crop, req.viewportWidth, req.viewportHeight));
  Object.assign(config.gpx, { imported: true, points, rawPoints: points, pointCount: points.length });
  const complete = await api.generateTerrainMain({ ...req, stlExport: true });
  const standalone = await api.generateTerrainMain({ ...req, stlExport: true, trailOnly: true });
  for (const part of [complete.trailMesh, standalone.trailMesh]) {
    assert.ok(part.indices.length);
    assert.equal(api.analyzeMesh(part).boundaryEdges, 0);
    assert.equal(hits(part, hole.center.x, hole.center.y), 0);
    assert.ok(hits(part, hole.center.x, hole.center.y + 6) >= 2);
  }
});

test('model feature settings validate fit, walls, unsupported glyphs and conflicting text', () => {
  const { config } = request(); config.terrain.keychain.enabled = true;
  config.terrain.keychain.insetMm = 2;
  assert.match(api.validateModelGeneration(config).message, /2 mm/);
  config.terrain.keychain.insetMm = 5; config.terrain.keychain.offsetMm = 1000;
  assert.match(api.validateModelGeneration(config).message, /offset/);
  config.terrain.keychain.offsetMm = 0; config.terrain.keychain.insetMm = 56;
  Object.assign(config.terrain.text, { enabled: true, placement: 'underside', title: 'MMMMM' });
  assert.match(api.validateModelGeneration(config).message, /overlaps text/);
  config.terrain.keychain.enabled = false; config.terrain.text.title = 'TRAIL 🏔';
  assert.match(api.validateModelGeneration(config).message, /font does not support/);
  config.terrain.text.title = 'ARAGATS'; config.terrain.text.style = 'engraved';
  config.terrain.baseSolidThicknessMm = 0.5;
  assert.match(api.validateModelGeneration(config).message, /Base thickness/);
  config.terrain.baseSolidThicknessMm = 3; config.terrain.text.placement = 'front'; config.tray.enabled = true;
  assert.match(api.validateModelGeneration(config).message, /Turn off Generate base/);
});

test('legacy presets normalize with personalization off, and disabled settings do not alter the model', async () => {
  const req = request();
  const original = await api.generateTerrainMain({ ...req, stlExport: true });
  delete req.config.terrain.text; delete req.config.terrain.keychain;
  assert.equal(api.validateModelGeneration(req.config).valid, true);
  const legacy = await api.generateTerrainMain({ ...req, stlExport: true });
  assert.deepEqual(legacy.mesh, original.mesh);
  assert.equal(api.normalizeTerrainFeatures(req.config.terrain).text.enabled, false);
  assert.equal(api.normalizeTerrainFeatures(req.config.terrain).keychain.enabled, false);
});

test('browser and desktop generation and terrain STL / model 3MF include personalization', async () => {
  const req = request('rectangle');
  Object.assign(req.config.terrain.text, { enabled: true, title: 'ԱՐԱԳԱԾ', subtitle: '2026', placement: 'both' });
  req.config.terrain.keychain.enabled = true;
  req.config.terrain.keychain.position = { xMm: -23, yMm: 17 };
  const preview = await api.generateTerrainMain(req);
  const exported = await api.generateTerrainMain({ ...req, stlExport: true });
  assert.equal(preview.modelFeaturesApplied, true); check(preview.mesh);
  assert.deepEqual(preview.mesh, exported.mesh);
  assert.equal(hits(preview.mesh, -23, 17), 0);
  const files = {};
  await api.mountainTrailExportFlow.generateFiles(req, () => {}, (name, data) => { files[name] = data; });
  const stl = Object.entries(files).find(([name]) => name.endsWith('_Terrain_Main.stl'))[1];
  assert.equal(new DataView(stl.buffer, stl.byteOffset).getUint32(80, true), exported.mesh.indices.length / 3);
  const colored = {};
  await api.mountainTrailExportFlow.generateFiles({ ...req, target: 'model-3mf' }, () => {}, (name, data) => { colored[name] = data; });
  const xml = strFromU8(unzipSync(Object.values(colored)[0])['3D/3dmodel.model']);
  assert.equal((xml.match(/<triangle /g) ?? []).length, exported.mesh.indices.length / 3);
});

test('free hole coordinates work across model shapes and ignore legacy edge settings', () => {
  for (const [shape, sides, corner] of [['circle', 6, 0], ['rectangle', 6, 6], ['polygon', 3, 0], ['polygon', 8, 3]]) {
    const { config } = request(shape, sides, corner);
    Object.assign(config.terrain.keychain, { enabled: true, position: { xMm: 12.3, yMm: -7.8 }, edge: 99, offsetMm: Infinity, insetMm: -1 });
    const valid = api.validateModelGeneration(config); assert.equal(valid.valid, true, valid.message);
    const { crop, mesh } = source(config), hole = api.computeModelKeychainHole(config, crop);
    assert.deepEqual(hole.center, { x: 12.3, y: -7.8 });
    const result = api.applyModelFeatures(wasm, config, crop, mesh, null, []).mesh;
    check(result); assert.equal(hits(result, 12.3, -7.8), 0);
    assert.ok(hits(result, 0, 0) >= 2, 'the hole cuts only the requested location');
    assert.deepEqual(api.normalizeTerrainFeatures(config.terrain).keychain.position, config.terrain.keychain.position);
  }
});

test('free hole placement validates coordinates, edge clearance and artwork while retaining an editable outline', () => {
  const { config } = request('rectangle');
  Object.assign(config.terrain.keychain, { enabled: true, position: { xMm: 100, yMm: 0 } });
  assert.match(api.validateModelGeneration(config).message, /2 mm of model material/);
  assert.equal(api.computeModelKeychainHole(config, undefined, false).center.x, 100);
  for (const value of [Infinity, NaN, 501]) {
    config.terrain.keychain.position.xMm = value;
    assert.match(api.validateModelGeneration(config).message, /coordinates/);
  }
  config.terrain.keychain.position = { xMm: 0, yMm: 0 };
  Object.assign(config.terrain.logo, { enabled: true, asset: logoAsset(), widthMm: 12 });
  assert.match(api.validateModelGeneration(config).message, /overlaps text or a logo/);
  config.terrain.keychain.position = { xMm: 18, yMm: 12 };
  const valid = api.validateModelGeneration(config); assert.equal(valid.valid, true, valid.message);
  delete config.terrain.keychain.position;
  assert.equal(api.normalizeTerrainFeatures(config.terrain).keychain.position, null);
  assert.ok(api.computeModelKeychainHole(config).center.x > 50, 'legacy edge positions are preserved');
});

function logoAsset() {
  const pixels = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = 8; y < 56; y++) for (let x = 8; x < 56; x++) {
    if (x >= 24 && x < 40 && y >= 24 && y < 40) continue;
    pixels[(y * 64 + x) * 4 + 3] = 255;
  }
  return api.traceLogoPixels(pixels, 64, 64, 'ring.png');
}
function volume(mesh) {
  const source = new wasm.Mesh({ numProp: 3, vertProperties: new Float32Array(mesh.positions), triVerts: new Uint32Array(mesh.indices) });
  source.merge(); const solid = new wasm.Manifold(source);
  try { return solid.volume(); } finally { solid.delete(); }
}
test('local logo tracing retains transparent holes and supports light and opaque artwork', () => {
  const asset = logoAsset();
  assert.equal(asset.contours.length, 2); assert.equal(asset.aspectRatio, 1);
  const white = new Uint8ClampedArray(16 * 16 * 4);
  for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) white.set([255, 255, 255, 255], (y * 16 + x) * 4);
  assert.throws(() => api.traceLogoPixels(white, 16, 16, 'white.png'), /No logo shapes/);
  for (const mode of ['light', 'opaque']) assert.equal(api.traceLogoPixels(white, 16, 16, 'white.png', mode).contours.length, 1);
  const diagonal = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < 8; i++) diagonal[(i * 8 + i) * 4 + 3] = 255;
  assert.equal(api.traceLogoPixels(diagonal, 8, 8, 'diagonal.png').contours.length, 8);
});

for (const shape of ['circle', 'rectangle', 'polygon']) for (const style of ['raised', 'engraved']) {
  test(`${shape} preserves logo counters, rotation and independent front / underside positions with ${style} artwork`, () => {
    const { config } = request(shape);
    Object.assign(config.terrain.logo, { enabled: true, asset: logoAsset(), placement: 'both', style, widthMm: 16,
      frontPosition: { xMm: -8, yMm: -8, rotationDeg: 25 }, undersidePosition: { xMm: -12, yMm: -10, rotationDeg: -30 } });
    Object.assign(config.terrain.text, { enabled: true, title: 'RIDGE', placement: 'both',
      frontPosition: { xMm: 8, yMm: -3, rotationDeg: 5 }, undersidePosition: { xMm: 8, yMm: 12, rotationDeg: 20 } });
    const valid = api.validateModelGeneration(config); assert.equal(valid.valid, true, valid.message);
    const { crop, mesh } = source(config);
    const result = api.applyModelFeatures(wasm, config, crop, mesh, null, []).mesh;
    check(result);
    const layout = api.buildModelTextLayout(config, crop);
    assert.equal(layout.logoFront.length, 2); assert.equal(layout.logoUnderside.length, 2);
    assert.ok(api.modelMarkBounds(layout.logoUnderside).minX > 0);
    assert.ok(api.modelMarkBounds(layout.underside).maxX < 5);
  });
}

test('an engraved logo removes exactly its silhouette while leaving its hollow center solid', () => {
  const { config } = request('rectangle');
  Object.assign(config.terrain.logo, { enabled: true, asset: logoAsset(), widthMm: 18,
    undersidePosition: { xMm: 12, yMm: -8, rotationDeg: 37 } });
  const { crop, mesh } = source(config);
  const result = api.applyModelFeatures(wasm, config, crop, mesh, null, []).mesh;
  check(result);
  const expected = (18 ** 2 - 6 ** 2) * config.terrain.logo.heightMm;
  assert.ok(Math.abs(volume(mesh) - volume(result) - expected) < 0.001, 'the logo counter is not filled or engraved');
});

test('text position changes move each surface independently and reject clipping', () => {
  const { config } = request();
  Object.assign(config.terrain.text, { enabled: true, title: 'RIDGE', placement: 'both' });
  const original = api.buildModelTextLayout(config);
  config.terrain.text.frontPosition = { xMm: 4, yMm: -5, rotationDeg: 0 };
  config.terrain.text.undersidePosition = { xMm: 7, yMm: 9, rotationDeg: 0 };
  const moved = api.buildModelTextLayout(config);
  assert.ok(Math.abs(api.modelMarkBounds(moved.front).minX - api.modelMarkBounds(original.front).minX - 4) < 1e-8);
  assert.ok(Math.abs(api.modelMarkBounds(moved.underside).minX - api.modelMarkBounds(original.underside).minX + 7) < 1e-8);
  config.terrain.text.undersidePosition.xMm = 100;
  assert.match(api.validateModelGeneration(config).message, /outside the underside/);
  assert.ok(api.buildModelTextLayout(config, undefined, false).underside.length, 'invalid artwork stays visible in the editor for correction');
});

test('logo settings and old position defaults validate before geometry generation', () => {
  const { config } = request();
  delete config.terrain.logo; delete config.terrain.text.frontPosition; delete config.terrain.text.undersidePosition;
  const normalized = api.normalizeTerrainFeatures(config.terrain);
  assert.equal(normalized.logo.enabled, false); assert.deepEqual(normalized.text.frontPosition, { xMm: 0, yMm: 0, rotationDeg: 0 });
  config.terrain = normalized;
  Object.assign(config.terrain.logo, { enabled: true, asset: logoAsset() });
  config.terrain.logo.undersidePosition.xMm = 60;
  assert.match(api.validateModelGeneration(config).message, /Logo extends outside/);
  config.terrain.logo.undersidePosition.xMm = 0; config.terrain.logo.heightMm = 3;
  assert.match(api.validateModelGeneration(config).message, /Base thickness/);
  config.terrain.logo.heightMm = 0.6; config.terrain.logo.asset.contours[0][0].x = Infinity;
  assert.match(api.validateModelGeneration(config).message, /outlines are invalid/);
});

test('logo-only preview and STL / 3MF keep the same engraving with no GPX or separate base', async () => {
  const req = request('rectangle');
  Object.assign(req.config.terrain.logo, { enabled: true, asset: logoAsset(),
    undersidePosition: { xMm: 6, yMm: -8, rotationDeg: 20 } });
  assert.equal(api.hasModelFeatures(req.config), true);
  const preview = await api.generateTerrainMain(req);
  assert.equal(preview.modelFeaturesApplied, true); check(preview.mesh);
  const files = {};
  await api.mountainTrailExportFlow.generateFiles(req, () => {}, (name, data) => { files[name] = data; });
  const stl = Object.entries(files).find(([name]) => name.endsWith('_Terrain_Main.stl'))[1];
  assert.equal(new DataView(stl.buffer, stl.byteOffset).getUint32(80, true), preview.mesh.indices.length / 3);
  const colored = {};
  await api.mountainTrailExportFlow.generateFiles({ ...req, target: 'model-3mf' }, () => {}, (name, data) => { colored[name] = data; });
  const xml = strFromU8(unzipSync(Object.values(colored)[0])['3D/3dmodel.model']);
  assert.equal((xml.match(/<triangle /g) ?? []).length, preview.mesh.indices.length / 3);
});

for (const [shape, sides, corner] of [['circle', 6, 0], ['rectangle', 6, 0], ['rectangle', 6, 8], ['polygon', 3, 0], ['polygon', 6, 4], ['polygon', 8, 0]]) {
  test(`${shape} ${sides} corners ${corner}: all nine placement presets fit rotated text and logos on both surfaces`, () => {
    const { config } = request(shape, sides, corner);
    Object.assign(config.terrain.text, { enabled: true, title: 'RIDGE', sizeMm: 4, placement: 'both',
      frontPosition: { xMm: 0, yMm: -8, rotationDeg: 15 }, undersidePosition: { xMm: 0, yMm: 0, rotationDeg: 25 } });
    Object.assign(config.terrain.logo, { enabled: true, asset: logoAsset(), widthMm: 8, placement: 'both',
      frontPosition: { xMm: 0, yMm: -10, rotationDeg: 25 }, undersidePosition: { xMm: 0, yMm: 0, rotationDeg: -15 } });
    for (const kind of ['text', 'logo']) for (const surface of ['front', 'underside']) {
      const settings = config.terrain[kind], field = surface === 'front' ? 'frontPosition' : 'undersidePosition';
      const otherField = surface === 'front' ? 'undersidePosition' : 'frontPosition';
      const other = { ...settings[otherField] }, rotation = settings[field].rotationDeg;
      for (const preset of api.MODEL_PLACEMENT_PRESETS) {
        const next = api.modelPlacementPresetPosition(config, kind, surface, preset.id);
        assert.ok(next, `${kind} ${surface} ${preset.id} has a fitting position`);
        assert.equal(next.rotationDeg, rotation);
        settings[field] = next;
        const valid = api.validateModelGeneration(config);
        assert.equal(valid.valid, true, `${kind} ${surface} ${preset.id}: ${valid.message}`);
        assert.deepEqual(settings[otherField], other, 'the other surface stays independent');
      }
    }
    assert.equal(config.terrain.text.sizeMm, 4); assert.equal(config.terrain.logo.widthMm, 8);
  });
}

test('quick placement centers visible bounds, recovers off-model items and clears keychain holes', () => {
  const { config } = request();
  Object.assign(config.terrain.logo, { enabled: true, asset: logoAsset(), widthMm: 12,
    undersidePosition: { xMm: 200, yMm: 100, rotationDeg: 30 } });
  const center = api.modelPlacementPresetPosition(config, 'logo', 'underside', 'center');
  assert.ok(center); config.terrain.logo.undersidePosition = center;
  const bounds = api.modelMarkBounds(api.buildModelTextLayout(config).logoUnderside);
  assert.ok(Math.abs(bounds.minX + bounds.maxX) < 1e-7);
  assert.ok(Math.abs(bounds.minY + bounds.maxY) < 1e-7);
  config.terrain.keychain.enabled = true;
  const left = api.modelPlacementPresetPosition(config, 'logo', 'underside', 'left');
  assert.ok(left); config.terrain.logo.undersidePosition = left;
  const check = api.validateModelGeneration(config); assert.equal(check.valid, true, check.message);
  config.terrain.keychain.insetMm = 59;
  const before = { ...config.terrain.logo.undersidePosition };
  assert.equal(api.modelPlacementPresetPosition(config, 'logo', 'underside', 'center'), null);
  assert.deepEqual(config.terrain.logo.undersidePosition, before, 'an unavailable position does not move the logo');
});

test('Center aligns the visible bounds of asymmetric rotated letters', () => {
  const { config } = request();
  Object.assign(config.terrain.text, { enabled: true, title: 'RIDGE', placement: 'underside',
    undersidePosition: { xMm: -20, yMm: 14, rotationDeg: 25 } });
  const next = api.modelPlacementPresetPosition(config, 'text', 'underside', 'center');
  assert.ok(next); config.terrain.text.undersidePosition = next;
  const bounds = api.modelMarkBounds(api.buildModelTextLayout(config).underside);
  assert.ok(Math.abs(bounds.minX + bounds.maxX) < 0.0011);
  assert.ok(Math.abs(bounds.minY + bounds.maxY) < 0.0011);
  assert.equal(next.rotationDeg, 25);
});
