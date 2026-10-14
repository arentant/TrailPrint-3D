import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const compiled = await build({
  stdin: { contents: `export * from './shared/types/config';
    export * from './shared/utils/tray-footprint'; export * from './shared/utils/tray-text-layout';
    export * from './shared/utils/tray-validation'; export * from './shared/utils/mesh-manifold';
    export * from './shared/utils/assembly-layout'; export * from './shared/utils/binary-stl';
    export * from './shared/utils/crop-region'; export * from './shared/utils/footprint';
    export * from './shared/utils/tray-mask-geometry';
    export * from './shared/utils/magnet-hole-layout'; export * from './shared/utils/magnet-hole-geometry';
    export * from './electron/main/tray/tray-export-mesh';`, resolveDir: resolve('.') },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const api = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);

function labelled(shape, corner = 0, sides = 6) {
  const config = api.createDefaultConfig();
  Object.assign(config.mapCrop, { shape, cornerRadiusMm: corner, polygonSides: sides });
  config.tray.text.enabled = true;
  config.tray.text.labels = Array.from({ length: api.trayTextEdgeCount(config) }, (_, edge) => ({
    text: ['SNOWDON', '1085m ↑', '154.80 km', '4:26:30', 'B8O', 'RIDGE', '2026', 'TRAIL'][edge], edge,
  }));
  return config;
}

function checkSolid(mesh) {
  const analysis = api.analyzeMesh(mesh);
  assert.equal(analysis.boundaryEdges, 0);
  assert.equal(analysis.nonManifoldEdges, 0);
  assert.equal(analysis.degenerateTriangles, 0);
  const edges = new Map(), connected = new Map();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const tri = mesh.indices.slice(t, t + 3);
    for (let i = 0; i < 3; i++) {
      const a = tri[i], b = tri[(i + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) || 0) + (a < b ? 1 : -1));
      if (!connected.has(a)) connected.set(a, []);
      connected.get(a).push(b);
    }
  }
  assert.ok([...edges.values()].every(v => v === 0), 'all neighboring faces have consistent outward winding');
  const visited = new Set(), queue = [mesh.indices[0]];
  while (queue.length) {
    const i = queue.pop();
    if (visited.has(i)) continue;
    visited.add(i);
    queue.push(...connected.get(i).filter(j => !visited.has(j)));
  }
  assert.equal(visited.size, connected.size, 'letters are connected to the base as one printable shell');
}

for (const [shape, corner, sides] of [['circle', 0, 6], ['rectangle', 0, 6], ['rectangle', 8, 6], ['polygon', 0, 3], ['polygon', 0, 6], ['polygon', 4, 6], ['polygon', 0, 8]]) {
  test(`${shape} ${sides} with ${corner} mm corners exports raised, joined labels with open counters`, () => {
    const config = labelled(shape, corner, sides);
    const footprint = api.computeTrayFootprint(config), layout = api.buildTrayTextLayout(config, footprint);
    assert.ok(layout.some(s => s.holes.length), 'letters retain counters');
    const mesh = api.buildTrayBaseMeshForExport(footprint, config.tray, undefined, undefined, layout);
    checkSolid(mesh);
    assert.equal(Math.max(...mesh.positions.filter((_, i) => i % 3 === 2)), 5.6);
    const stl = api.encodeBinaryStl(mesh, 'Labelled tray');
    assert.equal(stl.length, 84 + new DataView(stl.buffer).getUint32(80, true) * 50);
  });
}

test('labels coexist with underside magnet holes and NFC recesses', () => {
  const config = labelled('polygon', 0, 6);
  config.assembly.magnet.enabled = true;
  const footprint = api.computeTrayFootprint(config), cut = api.magnetCutDimensionsMm(config.assembly.magnet);
  const mesh = api.buildTrayBaseMeshForExport(footprint, config.tray,
    { ...cut, holes: api.computeTrayBottomMagnetHoles(config, footprint) },
    { cavityVerts: [{x:-10,y:-10},{x:10,y:-10},{x:10,y:10},{x:-10,y:10}], recessDepthMm: 0.5,
      ledPockets: [], ledExtraRecessDepthMm: 0.8, ledPocketLengthMm: 4, ledPocketWidthMm: 2.5, floorZ: 3 },
    api.buildTrayTextLayout(config, footprint));
  checkSolid(mesh);
});

test('disabled and legacy text settings preserve the unlabelled base', () => {
  const config = labelled('circle');
  config.tray.text.enabled = false;
  assert.deepEqual(api.buildTrayTextLayout(config), []);
  delete config.tray.text;
  assert.deepEqual(api.buildTrayTextLayout(config), []);
  assert.equal(api.validateTrayFromAppConfig(config).valid, true);
});

test('invalid labels fail with useful errors instead of replacing or clipping glyphs', () => {
  const config = labelled('rectangle');
  const fails = (message) => assert.match(api.validateTrayFromAppConfig(config).message, message);
  config.tray.text.labels = [{ text: 'TRAIL 🏔', edge: 0 }]; fails(/font does not support/);
  config.tray.text.labels = [{ text: 'TRAIL', edge: 0 }, { text: 'TRAIL', edge: 0 }]; fails(/different edge/);
  config.tray.text.labels = [{ text: 'TRAIL', edge: 7 }]; fails(/available.*edge/);
  config.tray.text.labels = [{ text: 'TOO LONG '.repeat(8), edge: 0 }];
  config.tray.rimWidthMm = 2; fails(/too small to print/);
  config.tray.text.enabled = false;
  assert.equal(api.validateTrayFromAppConfig(config).valid, true);
  config.assembly.trayToleranceMm = -1; fails(/clearance/);
});

test('circle recesses contain the terrain with the full clearance, even at large radii', () => {
  for (const radius of [20, 60, 500]) for (const clearance of [0, 0.2]) {
    const config = api.createDefaultConfig(); config.mapCrop.radiusMm = radius; config.assembly.trayToleranceMm = clearance;
    const inner = api.computeTrayFootprint(config).recessInner;
    for (let i = 0; i < inner.length; i++) {
      const a = inner[i], b = inner[(i + 1) % inner.length];
      const distance = Math.abs(a.x * b.y - a.y * b.x) / Math.hypot(b.x - a.x, b.y - a.y);
      assert.ok(Math.abs(distance - radius - clearance) < 1e-9);
    }
  }
});

test('polygon and rounded rectangle recesses leave the configured gap along every terrain edge', () => {
  for (const shape of ['polygon', 'rectangle']) for (const sides of [3, 6, 8]) for (const corner of [0, 4]) {
    const config = api.createDefaultConfig(); Object.assign(config.mapCrop, { shape, polygonSides: sides, cornerRadiusMm: corner });
    const terrain = api.buildFootprintPolygonMm(api.computeTerrainCropRegion(config.mapCrop, 800, 600));
    const inner = api.computeTrayFootprint(config).recessInner;
    for (let i = 0; i < terrain.length; i++) {
      const a = terrain[i], b = terrain[(i + 1) % terrain.length], q = inner[i];
      const distance = ((q.x - a.x) * (b.y - a.y) - (q.y - a.y) * (b.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
      assert.ok(Math.abs(distance - config.assembly.trayToleranceMm) < 1e-9);
    }
  }
});

test('terrain bottom contacts the recess floor at any base thickness', () => {
  const config = api.createDefaultConfig();
  config.tray.enabled = true;
  for (const thickness of [1, 2, 5]) for (const depth of [0.5, 2, 4]) {
    config.terrain.baseSolidThicknessMm = thickness; config.tray.recessDepthMm = depth;
    assert.equal(-thickness + api.computeTerrainAssemblyOffsetZMm(config), api.trayRecessFloorZMm(config));
  }
});

test('terrain rests on the print bed without a tray and ignores unused tray thickness', () => {
  const config = api.createDefaultConfig();
  config.tray.totalThicknessMm = 100;
  for (const thickness of [1, 2, 5]) {
    config.terrain.baseSolidThicknessMm = thickness;
    assert.equal(-thickness + api.computeTerrainAssemblyOffsetZMm(config), 0);
  }
});

test('map tray outline uses the same footprint and responds to clearance', () => {
  for (const shape of ['circle', 'rectangle', 'polygon']) {
    const config = api.createDefaultConfig(); config.mapCrop.shape = shape;
    for (const tolerance of [0, 0.2, 1]) {
      config.assembly.trayToleranceMm = tolerance;
      const footprint = api.computeTrayFootprint(config);
      const overlay = api.buildTrayMaskOverlay(config.mapCrop, config.tray, 800, 600, tolerance);
      if (shape === 'circle') assert.ok(Math.abs(overlay.outer.r / 204 - footprint.outerRadius / 60) < 1e-9);
      else {
        assert.equal(overlay.outer.vertices.length, footprint.outer.length);
        const scale = shape === 'rectangle' ? 204 / 60 : 204 / 45;
        footprint.outer.forEach((p, i) => {
          assert.ok(Math.abs(overlay.outer.vertices[i].x - 400 - p.x * scale) < 1e-9);
          assert.ok(Math.abs(overlay.outer.vertices[i].y - 300 - p.y * scale) < 1e-9);
        });
      }
    }
  }
});
