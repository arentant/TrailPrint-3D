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
for (const shape of ['rectangle', 'circle', 'polygon']) test(`${shape} exports closed black and white volumes conserving terrain`, () => {
  const footprint = { ...crop, shape, radiusMm: 30, polygonSides: 6 };
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
});
test('manual and satellite regions become closed material volumes with a solid base', () => {
  const mesh = api.buildHeightfieldTerrainMesh(crop, heights, cols, rows, 3);
  const plan = api.createNaturalSnowPlan(preview, crop);
  delete plan.naturalSnow;
  plan.cellRegions = plan.cellRegions.map((_, i) => i % cols > cols / 2 ? 1 : 0);
  verifyPartition(mesh, api.buildTerrainColorVolumes(wasm, mesh, crop, plan));
});
test('rejects stale snow and malformed palettes instead of exporting one color silently', () => {
  const mesh = api.buildHeightfieldTerrainMesh(crop, heights, cols, rows, 3);
  const plan = api.createNaturalSnowPlan(preview, crop);
  assert.throws(() => api.buildTerrainColorVolumes(wasm, mesh, { ...crop, widthMm: 70 }, plan), /changed/);
  plan.colors[1].hex = 'invalid';
  assert.throws(() => api.buildTerrainColorVolumes(wasm, mesh, crop, plan), /incomplete/);
});
