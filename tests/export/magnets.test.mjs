import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const compiled = await build({
  stdin: { contents: `export * from './shared/types/config';
    export * from './shared/utils/magnet-hole-geometry'; export * from './shared/utils/magnet-hole-layout';
    export * from './shared/utils/tray-footprint'; export * from './shared/utils/mesh-manifold';
    export * from './shared/utils/binary-stl'; export * from './electron/main/tray/tray-export-mesh';
    export { validateMagnetAssembly } from './shared/utils/model-validation';
    export { bottomPlateCoversPoint } from './electron/main/assembly/tray-magnet-pockets';`, resolveDir: resolve('.') },
  bundle: true, write: false, platform: 'node', format: 'esm',
});

const api = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);

for (const mapShape of ['circle', 'rectangle', 'polygon']) {
  for (const pocketShape of ['rectangle', 'hexagon']) {
    test(`${pocketShape} magnet shape and dimensions are independent of the ${mapShape} map`, () => {
      const config = api.createDefaultConfig();
      Object.assign(config.mapCrop, { shape: mapShape, radiusMm: 80, lengthMm: 200, widthMm: 150, polygonSideLengthMm: 80 });
      Object.assign(config.assembly.magnet, { enabled: true, shape: pocketShape, lengthMm: 8, widthMm: 4, diameterMm: 6, thicknessMm: 1.5, toleranceMm: 0.2 });
      assert.equal(api.validateMagnetAssembly(config).valid, true);
      const footprint = api.computeTrayFootprint(config), holes = api.computeTrayBottomMagnetHoles(config, footprint);
      const cut = api.magnetCutDimensionsMm(config.assembly.magnet);
      const mesh = api.buildTrayBaseMeshForExport(footprint, config.tray, { holes, ...cut });
      const analysis = api.analyzeMesh(mesh);
      assert.equal(analysis.boundaryEdges, 0); assert.equal(analysis.nonManifoldEdges, 0);
      const contour = api.magnetPocketVertsMm(holes[0].x, holes[0].y, cut.radiusMm, cut);
      assert.equal(contour.length, pocketShape === 'rectangle' ? 4 : 6);
      const spanX = Math.max(...contour.map(p => p.x)) - Math.min(...contour.map(p => p.x));
      const spanY = Math.max(...contour.map(p => p.y)) - Math.min(...contour.map(p => p.y));
      assert.ok(Math.abs(spanX - (pocketShape === 'rectangle' ? 8.4 : 6.4)) < 1e-9);
      assert.ok(Math.abs(spanY - (pocketShape === 'rectangle' ? 4.4 : 6.4 / Math.cos(Math.PI / 6))) < 1e-9);
      assert.equal(cut.depthMm, 1.7);
      for (const hole of holes) {
        for (const point of api.magnetPocketVertsMm(hole.x, hole.y, cut.radiusMm, cut)) {
          assert.ok(mesh.positions.some((value, i) => i % 3 === 0 && Math.hypot(value - point.x, mesh.positions[i + 1] - point.y) < 1e-5 && Math.abs(mesh.positions[i + 2] - cut.depthMm) < 1e-5));
        }
        assert.equal(api.bottomPlateCoversPoint(mesh, hole.x, hole.y), false);
      }
    });
  }
}

for (const shape of ['circle', 'rectangle', 'hexagon']) {
  test(`rounded polygon keeps one ${shape} magnet pocket per logical corner`, () => {
    const config = api.createDefaultConfig();
    Object.assign(config.mapCrop, { shape: 'polygon', polygonSides: 6, polygonSideLengthMm: 80, cornerRadiusMm: 8 });
    Object.assign(config.assembly.magnet, { enabled: true, shape, lengthMm: 8, widthMm: 4 });
    const footprint = api.computeTrayFootprint(config);
    const holes = api.computeTrayBottomMagnetHoles(config, footprint);
    assert.equal(holes.length, 6);
    assert.equal(api.validateMagnetAssembly(config).valid, true);
    const cut = api.magnetCutDimensionsMm(config.assembly.magnet);
    const mesh = api.buildTrayBaseMeshForExport(footprint, config.tray, { holes, ...cut });
    const analysis = api.analyzeMesh(mesh);
    assert.equal(analysis.boundaryEdges, 0); assert.equal(analysis.nonManifoldEdges, 0);
    for (const hole of holes) assert.equal(api.bottomPlateCoversPoint(mesh, hole.x, hole.y), false);
  });
}

test('legacy magnet settings default to round pockets with the original size', () => {
  const config = api.createDefaultConfig();
  delete config.assembly.magnet.shape; delete config.assembly.magnet.lengthMm; delete config.assembly.magnet.widthMm;
  const cut = api.magnetCutDimensionsMm(config.assembly.magnet);
  assert.equal(cut.shape, 'circle'); assert.equal(cut.radiusMm, 3.1); assert.equal(cut.depthMm, 2.1);
  assert.ok(api.magnetPocketVertsMm(0, 0, cut.radiusMm, cut).length >= 32);
});

test('invalid sizes, pocket overlap and insufficient edge material are rejected', () => {
  const config = api.createDefaultConfig(); config.assembly.magnet.enabled = true;
  config.assembly.magnet.shape = 'rectangle'; config.assembly.magnet.lengthMm = 0;
  assert.match(api.validateMagnetAssembly(config).message, /length and width/);
  config.assembly.magnet.lengthMm = 1000;
  assert.match(api.validateMagnetAssembly(config).message, /tray edge/);
  config.assembly.magnet.lengthMm = 8; config.assembly.magnet.widthMm = Number.NaN;
  assert.equal(api.validateMagnetAssembly(config).valid, false);
  config.mapCrop.radiusMm = 20;
  Object.assign(config.assembly.magnet, { shape: 'circle', diameterMm: 12, circleCount: 12 });
  assert.match(api.validateMagnetAssembly(config).message, /overlap/);
  config.assembly.magnet.thicknessMm = 10;
  assert.match(api.validateMagnetAssembly(config).message, /tray base thickness/);
  config.assembly.magnet.enabled = false;
  assert.equal(api.validateMagnetAssembly(config).valid, true);
});

for (const [shape, sides] of [['circle', 0], ['rectangle', 0], ['polygon', 3], ['polygon', 5], ['polygon', 6], ['polygon', 8]]) {
  for (const nfcEnabled of [false, true]) {
    test(`${shape}${sides || ''} tray has round open magnet pockets and a closed printable mesh${nfcEnabled ? ' with NFC' : ''}`, () => {
      const config = api.createDefaultConfig();
      Object.assign(config.mapCrop, { shape, polygonSides: sides || 6, polygonSideLengthMm: 80, radiusMm: 80, lengthMm: 200, widthMm: 150 });
      config.assembly.magnet.enabled = true;
      const footprint = api.computeTrayFootprint(config);
      const holes = api.computeTrayBottomMagnetHoles(config, footprint);
      const cut = api.magnetCutDimensionsMm(config.assembly.magnet);
      const nfc = nfcEnabled ? {
        cavityVerts: [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }],
        recessDepthMm: 0.5, ledPockets: [], ledExtraRecessDepthMm: 0.2,
        ledPocketLengthMm: 2, ledPocketWidthMm: 1,
        floorZ: config.tray.totalThicknessMm - config.tray.recessDepthMm,
      } : undefined;
      const mesh = api.buildTrayBaseMeshForExport(footprint, config.tray, { holes, ...cut }, nfc);
      const analysis = api.analyzeMesh(mesh);
      assert.equal(analysis.boundaryEdges, 0); assert.equal(analysis.nonManifoldEdges, 0);
      const baseline = api.analyzeMesh(api.buildTrayBaseMeshForExport(footprint, config.tray, undefined, nfc));
      assert.equal(analysis.degenerateTriangles, baseline.degenerateTriangles, 'round pockets do not introduce collapsed triangles');
      assert.ok(api.bottomPlateCoversPoint(mesh, 0, 0), 'the tray underside retains its solid center');
      assert.equal(holes.length, shape === 'circle' ? 3 : shape === 'rectangle' ? 4 : sides);
      for (const hole of holes) {
        const ring = [];
        for (let i = 0; i < mesh.positions.length; i += 3) {
          const x = mesh.positions[i], y = mesh.positions[i + 1], z = mesh.positions[i + 2];
          const radius = Math.hypot(x - hole.x, y - hole.y);
          if (Math.abs(z - mesh.bottomZ) < 1e-6 && Math.abs(radius - cut.radiusMm) < 0.02) ring.push(radius);
        }
        assert.ok(ring.length >= 32, 'the opening is smoothly round, independently of the map outline');
        assert.ok(ring.every(radius => radius >= cut.radiusMm - 1e-5 && radius <= cut.radiusMm + 0.011));
        for (let i = 0; i < 24; i++) {
          const angle = i / 24 * Math.PI * 2;
          const covered = (radius) => api.bottomPlateCoversPoint(mesh, hole.x + Math.cos(angle) * radius, hole.y + Math.sin(angle) * radius);
          assert.equal(covered(cut.radiusMm * 0.98), false, 'the opening is clear all the way around');
          assert.equal(covered(cut.radiusMm * 1.03), true, 'the pocket does not extend into polygon corners');
        }
      }
      const stl = api.encodeBinaryStl(mesh, 'Round magnet tray');
      assert.equal(stl.length, 84 + new DataView(stl.buffer).getUint32(80, true) * 50);
    });
  }
}

test('round pocket facets preserve magnet fit and clearance at small and large diameters', () => {
  for (const radius of [0.5, 1, 3, 3.1, 15]) {
    const contour = api.magnetCircleVertsMm(0, 0, radius);
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i], b = contour[(i + 1) % contour.length];
      const midpointRadius = Math.hypot((a.x + b.x) / 2, (a.y + b.y) / 2);
      assert.ok(Math.abs(midpointRadius - radius) < 1e-9, 'even zero-clearance magnets fit inside every facet');
      assert.ok(Math.hypot(a.x, a.y) - radius <= 0.011);
    }
  }
});
