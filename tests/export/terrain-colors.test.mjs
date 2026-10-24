import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import Module from 'manifold-3d';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';

const compiled = await build({ stdin: { contents: `export * from './shared/utils/natural-snow';
  export * from './shared/utils/terrain-color-volumes'; export * from './shared/utils/heightfield-mesh';
  export * from './shared/utils/mesh-manifold'; export * from './shared/export/colored-3mf';`, resolveDir: resolve('.') },
  bundle: true, write: false, platform: 'node', format: 'esm' });
const dir = await mkdtemp(join(tmpdir(), 'trailprint-colors-'));
after(() => rm(dir, { recursive: true, force: true }));
await writeFile(join(dir, 'colors.mjs'), compiled.outputFiles[0].contents);
const api = await import(pathToFileURL(join(dir, 'colors.mjs')).href);
let wasm;
before(async () => { wasm = await Module(); wasm.setup(); });
const crop = { shape: 'rectangle', widthMm: 60, heightMm: 60, centerLat: 27.99, centerLon: 86.92,
  bearingDeg: 0, minLat: 27.9, maxLat: 28.1, minLon: 86.8, maxLon: 87.0 };
const cols = 33, rows = 33;
const heights = Array.from({ length: cols * rows }, (_, i) => {
  const x = (i % cols) / (cols - 1) * 2 - 1, y = Math.floor(i / cols) / (rows - 1) * 2 - 1;
  return 1 + 22 * Math.exp(-3 * (x * x + y * y));
});
const preview = { heights, cols, rows, minSurfaceZ: Math.min(...heights), bottomZ: -3, baseThicknessMm: 3 };
function solid(mesh) {
  const raw = new wasm.Mesh({ numProp: 3, vertProperties: new Float32Array(mesh.positions), triVerts: new Uint32Array(mesh.indices) });
  raw.merge(); return new wasm.Manifold(raw);
}
function volume(mesh) {
  let total = 0;
  const p = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t] * 3, b = mesh.indices[t + 1] * 3, c = mesh.indices[t + 2] * 3;
    total += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return total / 6;
}
function verifyPartition(mesh, parts) {
  assert.equal(parts.length, 2);
  for (const part of parts) api.assertWatertightMesh(part.mesh, part.name);
  const original = solid(mesh), a = solid(parts[0].mesh), b = solid(parts[1].mesh);
  const joined = a.add(b), overlap = a.intersect(b), missing = original.subtract(joined), extra = joined.subtract(original);
  try {
    assert.ok(Math.abs(overlap.volume()) < 0.001, 'materials must not overlap');
    assert.ok(Math.abs(missing.volume()) < 0.001, 'no missing terrain');
    assert.ok(Math.abs(extra.volume()) < 0.001, 'no added terrain');
    assert.ok(Math.abs(joined.volume() - original.volume()) < 0.01);
  } finally { [original, a, b, joined, overlap, missing, extra].forEach(s => s.delete()); }
}

test('natural snow is deterministic, irregular and responds to snowline height', () => {
  const low = api.createNaturalSnowPlan(preview, crop, 0.35), high = api.createNaturalSnowPlan(preview, crop, 0.75);
  assert.deepEqual(low.cellRegions, api.createNaturalSnowPlan(preview, crop, 0.35).cellRegions);
  assert.ok(low.cellRegions.reduce((a, b) => a + b) > high.cellRegions.reduce((a, b) => a + b));
  assert.ok(new Set(low.naturalSnow.boundaryHeights.map(v => v.toFixed(2))).size > 100);
  assert.deepEqual(low.colors.map(c => c.hex), ['#000000', '#ffffff']);
});
for (const shape of ['rectangle', 'rounded rectangle', 'circle', 'polygon']) test(`${shape} exports closed black and white volumes conserving terrain`, () => {
  const footprint = { ...crop, shape: shape === 'rounded rectangle' ? 'rectangle' : shape,
    cornerRadiusMm: shape === 'rounded rectangle' ? 6 : 0, radiusMm: 30, polygonSides: 6 };
  const mesh = api.buildHeightfieldTerrainMesh(footprint, heights, cols, rows, 3);
  const plan = api.createNaturalSnowPlan(preview, footprint);
  const parts = api.buildTerrainColorVolumes(wasm, mesh, footprint, plan);
  verifyPartition(mesh, parts);
  const rock = parts.find(p => p.color === '#000000'), snow = parts.find(p => p.color === '#ffffff');
  assert.equal(Math.min(...rock.mesh.positions.filter((_, i) => i % 3 === 2)), -3);
  assert.ok(Math.min(...snow.mesh.positions.filter((_, i) => i % 3 === 2)) > 0);
  const files = unzipSync(api.encodeColored3mf([{ name: 'Everest', parts }], 'Everest'));
  const xml = strFromU8(files['3D/3dmodel.model']);
  assert.match(xml, /#000000FF/); assert.match(xml, /#FFFFFFFF/);
  assert.match(xml, /Terrain — snow/);
  assert.match(strFromU8(files['Metadata/model_settings.config']), /key="extruder" value="2"/);
  const meshes = [...xml.matchAll(/<mesh>(.*?)<\/mesh>/gs)];
  assert.equal(meshes.length, parts.length);
  for (const [i, match] of meshes.entries()) {
    const positions = [...match[1].matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].flatMap(m => m.slice(1).map(Number));
    const indices = [...match[1].matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)].flatMap(m => m.slice(1).map(Number));
    assert.equal(indices.length, parts[i].mesh.indices.length, 'chunked XML retains every triangle');
    assert.ok(indices.every(index => index * 3 < positions.length));
    api.assertWatertightMesh({ positions, indices }, parts[i].name);
    assert.ok(Math.abs(volume({ positions, indices }) - volume(parts[i].mesh)) < 1e-6);
  }
});
for (const shape of ['rectangle', 'rounded rectangle', 'circle', 'polygon']) test(`${shape} keeps surface detail without a dense flat underside`, () => {
  const size = 97;
  const field = Array.from({ length: size * size }, (_, i) => 10 + i % size / (size - 1) - 0.5
    + Math.floor(i / size) / (size - 1) - 0.5);
  const footprint = { ...crop, shape: shape === 'rounded rectangle' ? 'rectangle' : shape,
    cornerRadiusMm: shape === 'rounded rectangle' ? 6 : 0, radiusMm: 30, polygonSides: 6 };
  const mesh = api.buildHeightfieldTerrainMesh(footprint, field, size, size, 3);
  api.assertWatertightMesh(mesh, shape);
  let bottomTriangles = 0, bottomArea = 0, surfaceVertices = 0;
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) if (p[i + 2] !== -3) {
    surfaceVertices++;
    assert.ok(Math.abs(p[i + 2] - (10 + p[i] / 60 + p[i + 1] / 60)) < 1e-8);
  }
  if (shape === 'rectangle') assert.equal(surfaceVertices, size * size);
  if (shape === 'circle') assert.equal(surfaceVertices, 1 + (size - 1) * size);
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = mesh.indices.slice(t, t + 3).map(i => i * 3);
    if ([a, b, c].every(i => p[i + 2] === -3)) {
      bottomTriangles++;
      const cross = (p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[b + 1] - p[a + 1]) * (p[c] - p[a]);
      assert.ok(cross < 0, 'the underside faces outward');
      bottomArea -= cross / 2;
    }
  }
  assert.ok(bottomTriangles < size * 8, 'flat base complexity scales with the perimeter, not the DEM area');
  assert.ok(Math.abs(volume(mesh) - bottomArea * 13) < 1e-6, 'the solid keeps the same volume');
});
test('manual and satellite regions become closed material volumes with a solid base', () => {
  const mesh = api.buildHeightfieldTerrainMesh(crop, heights, cols, rows, 3);
  const plan = api.createNaturalSnowPlan(preview, crop);
  delete plan.naturalSnow;
  plan.cellRegions = plan.cellRegions.map((_, i) => i % cols > cols / 2 ? 1 : 0);
  verifyPartition(mesh, api.buildTerrainColorVolumes(wasm, mesh, crop, plan));
});
test('multiple painted colors preserve earlier volumes as successive split inputs are released', () => {
  const mesh = api.buildHeightfieldTerrainMesh(crop, heights, cols, rows, 3);
  const plan = api.createNaturalSnowPlan(preview, crop);
  delete plan.naturalSnow;
  plan.colors.push({ index: 3, regionId: 2, hex: '#ff0000', label: 'Paint' });
  plan.cellRegions = plan.cellRegions.map((_, i) => Math.min(2, Math.floor((i % cols) / cols * 3)));
  const parts = api.buildTerrainColorVolumes(wasm, mesh, crop, plan);
  assert.equal(parts.length, 3);
  for (const part of parts) api.assertWatertightMesh(part.mesh, part.name);
  const solids = parts.map(part => solid(part.mesh)), original = solid(mesh);
  const joined = wasm.Manifold.union(solids), missing = original.subtract(joined), extra = joined.subtract(original);
  try {
    assert.ok(Math.abs(missing.volume()) < 0.001);
    assert.ok(Math.abs(extra.volume()) < 0.001);
    assert.ok(Math.abs(solids.reduce((sum, part) => sum + part.volume(), 0) - joined.volume()) < 0.001, 'no overlap');
  } finally { [...solids, original, joined, missing, extra].forEach(s => s.delete()); }
});
test('rejects stale snow and malformed palettes instead of exporting one color silently', () => {
  const mesh = api.buildHeightfieldTerrainMesh(crop, heights, cols, rows, 3);
  const plan = api.createNaturalSnowPlan(preview, crop);
  assert.throws(() => api.buildTerrainColorVolumes(wasm, mesh, { ...crop, widthMm: 70 }, plan), /changed/);
  plan.colors[1].hex = 'invalid';
  assert.throws(() => api.buildTerrainColorVolumes(wasm, mesh, crop, plan), /incomplete/);
});

// Run separately: TRAILPRINT_STRESS_TEST=1 node --test tests/export/terrain-colors.test.mjs
// This exercises the reported DEM resolution and needs several GB of memory.
test('1536 × 1536 natural snow exports a complete colored 3MF', { skip: process.env.TRAILPRINT_STRESS_TEST !== '1' }, () => {
  const size = 1536;
  const footprint = { ...crop, widthMm: 120, heightMm: 120, cornerRadiusMm: 10 };
  const field = Float64Array.from({ length: size * size }, (_, i) => {
    const x = i % size / (size - 1) * 2 - 1, y = Math.floor(i / size) / (size - 1) * 2 - 1;
    return 1 + 55 * Math.exp(-3 * (x * x + y * y));
  });
  const mesh = api.buildHeightfieldTerrainMesh(footprint, field, size, size, 3);
  const plan = api.createNaturalSnowPlan({ ...preview, heights: field, cols: size, rows: size }, footprint, 0.55);
  const parts = api.buildTerrainColorVolumes(wasm, mesh, footprint, plan);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map(part => part.color), ['#000000', '#ffffff']);
  assert.ok(parts.every(part => volume(part.mesh) > 0));
  assert.ok(Math.abs(parts.reduce((sum, part) => sum + volume(part.mesh), 0) - volume(mesh)) < 0.1);
  const bytes = api.encodeColored3mf([{ name: 'High resolution snow', parts }]);
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b);
  assert.ok(bytes.byteLength > 0);
});
