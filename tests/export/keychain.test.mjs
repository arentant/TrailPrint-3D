import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const compiled = await build({
  stdin: { contents: `export * from './shared/types/config';
    export * from './shared/utils/tray-footprint'; export * from './shared/utils/tray-keychain-layout';
    export * from './shared/utils/tray-text-layout'; export * from './shared/utils/tray-validation';
    export * from './shared/utils/model-validation'; export * from './shared/utils/mesh-manifold';
    export * from './shared/utils/binary-stl'; export * from './shared/utils/crop-region';
    export * from './shared/utils/map-mm-projection';
    export * from './shared/utils/magnet-hole-layout'; export * from './shared/utils/magnet-hole-geometry';
    export * from './electron/main/tray/tray-export-mesh';`, resolveDir: resolve('.') },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const api = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);

function verticalRayHits(mesh, x, y) {
  let hits = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const p = mesh.indices.slice(t, t + 3).map(i => mesh.positions.slice(i * 3, i * 3 + 3));
    const [a, b, c] = p;
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) continue;
    const u = ((x - a[0]) * (c[1] - a[1]) - (y - a[1]) * (c[0] - a[0])) / area;
    const v = ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / area;
    if (u >= 0 && v >= 0 && u + v <= 1) hits++;
  }
  return hits;
}

function solidVolume(mesh) {
  let volume = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = mesh.indices.slice(t, t + 3).map(i => mesh.positions.slice(i * 3, i * 3 + 3));
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return volume;
}

function checkHole(mesh, hole) {
  const analysis = api.analyzeMesh(mesh);
  assert.equal(analysis.boundaryEdges, 0);
  assert.equal(analysis.nonManifoldEdges, 0);
  assert.equal(analysis.degenerateTriangles, 0);
  const winding = new Map();
  for (let t = 0; t < mesh.indices.length; t += 3) for (let i = 0; i < 3; i++) {
    const a = mesh.indices[t + i], b = mesh.indices[t + (i + 1) % 3];
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    winding.set(key, (winding.get(key) || 0) + (a < b ? 1 : -1));
  }
  assert.ok([...winding.values()].every(v => v === 0), 'the bore walls share consistent winding with both caps');
  assert.equal(verticalRayHits(mesh, hole.center.x, hole.center.y), 0, 'the hole center is clear all the way through');
  for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI / 8;
    const x = hole.center.x + Math.cos(angle) * hole.radiusMm * 0.98;
    const y = hole.center.y + Math.sin(angle) * hole.radiusMm * 0.98;
    assert.equal(verticalRayHits(mesh, x, y), 0, 'the full requested opening is clear');
    assert.ok(verticalRayHits(mesh, hole.center.x + Math.cos(angle) * (hole.cutRadiusMm + 0.5),
      hole.center.y + Math.sin(angle) * (hole.cutRadiusMm + 0.5)) >= 2, 'solid tray material remains outside the bore');
  }
}

for (const [shape, corner, sides] of [['circle', 0, 6], ['rectangle', 0, 6], ['rectangle', 8, 6], ['polygon', 0, 3], ['polygon', 0, 6], ['polygon', 4, 6], ['polygon', 0, 8]]) {
  for (const diameter of [2, 4, 10]) {
    test(`${shape} ${sides} with ${corner} mm corners has a ${diameter} mm through-hole at every rim edge`, () => {
      const config = api.createDefaultConfig();
      Object.assign(config.mapCrop, { shape, cornerRadiusMm: corner, polygonSides: sides });
      config.tray.rimWidthMm = diameter + 5;
      Object.assign(config.tray.keychain, { enabled: true, diameterMm: diameter, offsetMm: 4 });
      const footprint = api.computeTrayFootprint(config);
      for (let edge = 0; edge < api.trayRimEdgeCount(footprint); edge++) {
        config.tray.keychain.edge = edge;
        assert.equal(api.validateTrayFromAppConfig(config).valid, true);
        const hole = api.computeTrayKeychainHole(footprint, config.tray);
        const mesh = api.buildTrayBaseMeshForExport(footprint, config.tray);
        checkHole(mesh, hole);
        config.tray.keychain.enabled = false;
        const plain = api.buildTrayBaseMeshForExport(footprint, config.tray);
        config.tray.keychain.enabled = true;
        const area = Math.abs(hole.contour.reduce((sum, p, i) => {
          const q = hole.contour[(i + 1) % hole.contour.length]; return sum + p.x * q.y - p.y * q.x;
        }, 0)) / 2;
        assert.ok(Math.abs(solidVolume(plain) - solidVolume(mesh) - area * config.tray.totalThicknessMm) < 1e-6,
          'the only removed volume is the through-hole');
      }
    });
  }
}

for (const shape of ['circle', 'rectangle', 'polygon']) for (const pocketShape of ['circle', 'rectangle', 'hexagon']) {
  test(`${shape} keychain hole retains text, NFC and ${pocketShape} magnet pockets`, () => {
    const config = api.createDefaultConfig(); config.mapCrop.shape = shape;
    config.tray.keychain.enabled = true;
    Object.assign(config.tray.text, { enabled: true, labels: [{ text: 'B8O TRAIL', edge: 0 }] });
    Object.assign(config.assembly.magnet, { enabled: true, shape: pocketShape });
    const footprint = api.computeTrayFootprint(config), hole = api.computeTrayKeychainHole(footprint, config.tray);
    const mesh = api.buildTrayBaseMeshForExport(footprint, config.tray,
      { ...api.magnetCutDimensionsMm(config.assembly.magnet), holes: api.computeTrayBottomMagnetHoles(config, footprint) },
      { cavityVerts: [{x:-10,y:-10},{x:10,y:-10},{x:10,y:10},{x:-10,y:10}], recessDepthMm: 0.5,
        ledPockets: [], ledExtraRecessDepthMm: 0.8, ledPocketLengthMm: 4, ledPocketWidthMm: 2.5, floorZ: 3 },
      api.buildTrayTextLayout(config, footprint));
    checkHole(mesh, hole);
    assert.equal(Math.max(...mesh.positions.filter((_, i) => i % 3 === 2)), 5.6);
    const stl = api.encodeBinaryStl(mesh, 'Keychain tray');
    assert.equal(stl.length, 84 + mesh.indices.length / 3 * 50);
  });
}

test('disabled and legacy keychain settings retain exactly the same base STL', () => {
  const config = api.createDefaultConfig(), footprint = api.computeTrayFootprint(config);
  const original = api.encodeBinaryStl(api.buildTrayBaseMeshForExport(footprint, config.tray), 'Tray');
  delete config.tray.keychain;
  assert.equal(api.validateTrayFromAppConfig(config).valid, true);
  assert.deepEqual(api.encodeBinaryStl(api.buildTrayBaseMeshForExport(footprint, config.tray), 'Tray'), original);
});

test('invalid diameters, thin walls, positions and conflicting labels are rejected', () => {
  const config = api.createDefaultConfig(); config.tray.keychain.enabled = true;
  const fails = pattern => assert.match(api.validateTrayFromAppConfig(config).message, pattern);
  for (const diameter of [0, 1, 11, Number.NaN, Infinity]) { config.tray.keychain.diameterMm = diameter; fails(/diameter/); }
  config.tray.keychain.diameterMm = 4; config.tray.rimWidthMm = 7; fails(/2 mm.*material/);
  config.tray.rimWidthMm = 9; config.tray.keychain.offsetMm = 1000; fails(/offset/);
  config.tray.keychain.offsetMm = 0; config.tray.keychain.edge = 8; fails(/available rim edge/);
  config.tray.keychain.edge = 1;
  Object.assign(config.tray.text, { enabled: true, labels: [{ text: 'MOUNTAIN', edge: 1 }] }); fails(/overlaps a base label/);
  config.tray.text.enabled = false; assert.equal(api.validateTrayFromAppConfig(config).valid, true);
});

test('keychain holes cannot break into underside magnet pockets', () => {
  const config = api.createDefaultConfig(); config.mapCrop.radiusMm = 20;
  config.tray.keychain.enabled = true; config.assembly.magnet.enabled = true;
  const footprint = api.computeTrayFootprint(config), hole = api.computeTrayKeychainHole(footprint, config.tray);
  config.tray.keychain.offsetMm = -(Math.hypot(hole.center.x, hole.center.y) * Math.PI / 6);
  assert.match(api.validateTrayFromAppConfig(config).message, /magnet pockets/);
});

test('LED pockets near the terrain edge are checked before generation', () => {
  const config = api.createDefaultConfig(); config.tray.keychain.enabled = true; config.tray.nfc.enabled = true;
  const crop = api.computeTerrainCropRegion(config.mapCrop, 800, 600);
  const points = [[59, 0], [0, 0]].map(([x, y]) => api.modelMmToLatLon(x, y, config.mapCrop, crop, 800, 600));
  Object.assign(config.gpx, { imported: true, points, rawPoints: points, pointCount: 2 });
  assert.match(api.validateTrayNfcLayout(config, 800, 600).message, /keychain hole and LED pockets/);
});
