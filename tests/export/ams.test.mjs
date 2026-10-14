import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve, join } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { readFileSync } from 'node:fs';

const compiled = await build({
  stdin: { contents: `export * from './shared/types/config'; export * from './shared/types/model-colors';
    export * from './shared/export/tray-ams-3mf'; export * from './shared/export/export-artifact';
    export * from './electron/main/tray/tray-service'; export * from './electron/main/export/mountain-trail-flow';
    export * from './shared/utils/mesh-manifold';`, resolveDir: resolve('.') },
  bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'no-elevation-for-ams', setup(plugin) {
    plugin.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock-electron' }));
    plugin.onLoad({ filter: /.*/, namespace: 'mock-electron' }, () => ({ contents: `export const app = { getPath() { throw new Error('No Electron runtime in AMS base tests'); } }; export const nativeImage = { createFromBuffer() { throw new Error('No imagery in AMS base tests'); } };` }));
    plugin.onResolve({ filter: /^\.\.\/terrain\/terrain-main-service$/ }, () => ({ path: 'terrain', namespace: 'mock' }));
    plugin.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export async function generateTerrainMain() { throw new Error('AMS base must not fetch terrain'); }` }));
  } }],
});
const directory = await mkdtemp(join(tmpdir(), 'trailprint-ams-test-'));
after(() => rm(directory, { recursive: true, force: true }));
const modulePath = join(directory, 'ams.mjs');
await writeFile(modulePath, compiled.outputFiles[0].contents);
const api = await import(pathToFileURL(modulePath).href);

function config(shape = 'circle', corner = 0) {
  const cfg = api.createDefaultConfig();
  Object.assign(cfg.mapCrop, { shape, cornerRadiusMm: corner });
  Object.assign(cfg.tray.text, { enabled: true, labels: [{ text: 'B8O TRAIL', edge: 0 }, { text: '42.80 km', edge: 2 }] });
  cfg.tray.keychain.enabled = true; cfg.assembly.magnet.enabled = true;
  return cfg;
}
function volume(mesh) {
  let sum = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a,b,c] = mesh.indices.slice(t,t+3).map(i => mesh.positions.slice(i*3,i*3+3));
    sum += (a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
  }
  return sum;
}
for (const [shape, corner] of [['circle', 0], ['rectangle', 0], ['rectangle', 8], ['polygon', 0], ['polygon', 4]]) {
  test(`${shape} ${corner} mm corners has non-overlapping printable base and text solids`, async () => {
    const cfg = config(shape, corner), { mesh } = await api.generateTrayBase({ config: cfg });
    const { baseMesh, textMesh } = mesh;
    for (const part of [baseMesh, textMesh]) {
      const check = api.analyzeMesh(part);
      assert.equal(check.boundaryEdges, 0); assert.equal(check.nonManifoldEdges, 0); assert.equal(check.degenerateTriangles, 0);
      assert.ok(volume(part) > 0);
    }
    assert.equal(Math.max(...baseMesh.positions.filter((_,i) => i % 3 === 2)), cfg.tray.totalThicknessMm);
    assert.equal(Math.min(...textMesh.positions.filter((_,i) => i % 3 === 2)), cfg.tray.totalThicknessMm);
    assert.ok(Math.abs(volume(mesh) - volume(baseMesh) - volume(textMesh)) < 1e-6, 'the parts have a shared interface without overlapping volumes');
  });
}

for (const shape of ['circle', 'rectangle', 'polygon']) {
  test(`${shape} Armenian and mixed-language labels produce closed AMS parts`, async () => {
    const cfg = config(shape);
    cfg.tray.text.labels = [{ text: 'Արագած 4090մ ↑', edge: 0 }, { text: 'ԵՐԵՎԱՆ և Trail', edge: 2 }];
    const { mesh } = await api.generateTrayBase({ config: cfg });
    for (const part of [mesh, mesh.baseMesh, mesh.textMesh]) {
      const check = api.analyzeMesh(part);
      assert.equal(check.boundaryEdges, 0); assert.equal(check.nonManifoldEdges, 0); assert.equal(check.degenerateTriangles, 0);
      assert.ok(volume(part) > 0);
    }
    assert.ok(Math.abs(volume(mesh) - volume(mesh.baseMesh) - volume(mesh.textMesh)) < 1e-6);
    const files = unzipSync(api.encodeTrayAms3mf(mesh.baseMesh, mesh.textMesh, '#202020', '#ffffff', 'Արագած'));
    assert.match(strFromU8(files['3D/3dmodel.model']), /Արագած/);
  });
}

test('every bundled Armenian character generates printable text, including punctuation and ligatures', async () => {
  const glyphs = JSON.parse(readFileSync('shared/assets/fonts/noto-sans-armenian-bold.typeface.json', 'utf8')).glyphs;
  for (let code = 0x0531; code <= 0x0556; code++) assert.ok(glyphs[String.fromCodePoint(code)]);
  for (let code = 0x0561; code <= 0x0587; code++) assert.ok(glyphs[String.fromCodePoint(code)]);
  const cfg = config('rectangle');
  cfg.assembly.magnet.enabled = false;
  cfg.tray.keychain.enabled = false;
  for (const character of Object.keys(glyphs)) {
    cfg.tray.text.labels = [{ text: `Ա${character}`, edge: 0 }];
    const { mesh } = await api.generateTrayBase({ config: cfg });
    const check = api.analyzeMesh(mesh.textMesh);
    assert.equal(check.boundaryEdges, 0, character); assert.equal(check.nonManifoldEdges, 0, character);
    assert.equal(check.degenerateTriangles, 0, character); assert.ok(volume(mesh.textMesh) > 0, character);
  }
});

test('3MF contains a single assembly with independent colors and filament assignments', async () => {
  const { mesh } = await api.generateTrayBase({ config: config() });
  const files = unzipSync(api.encodeTrayAms3mf(mesh.baseMesh, mesh.textMesh, '#202020', '#ffcc00', 'Base & text'));
  const model = strFromU8(files['3D/3dmodel.model']), settings = strFromU8(files['Metadata/model_settings.config']);
  assert.match(model, /unit="millimeter"/); assert.match(model, /<item objectid="4" transform="[^"]+"\/>/);
  assert.match(model, /component objectid="2"/); assert.match(model, /component objectid="3"/);
  assert.match(model, /color="#202020FF"/); assert.match(model, /color="#FFCC00FF"/);
  assert.match(model, /name="Base" pid="1" pindex="0"/); assert.match(model, /name="Text" pid="1" pindex="1"/);
  assert.match(settings, /name" value="Base"\/><metadata key="extruder" value="1"/);
  assert.match(settings, /name" value="Text"\/><metadata key="extruder" value="2"/);
  assert.match(model, /Base &amp; text/);
  const props = JSON.parse(strFromU8(files['Metadata/trailprint.json']));
  assert.deepEqual(props.palette, ['#202020','#ffcc00']);
  assert.equal(files['Metadata/project_settings.config'], undefined, 'partial printer configurations must not trigger slicer import failures');
});

test('AMS export target emits one 3MF without generating terrain or fetching elevation', async () => {
  const cfg = config();
  Object.assign(cfg.gpx, { imported: true, points: [{lat:0,lon:0},{lat:0.001,lon:0.001}], rawPoints: [], fileName: 'run.gpx' });
  const request = { config: cfg, target: 'ams-base', viewportWidth: 800, viewportHeight: 600 };
  const flow = api.mountainTrailExportFlow, artifact = flow.describeArtifact(request), files = [];
  await flow.generateFiles(request, () => {}, (name, bytes) => files.push({ name, bytes }));
  assert.equal(artifact.extension, '3mf'); assert.equal(artifact.kind, 'file');
  assert.equal(files.length, 1); assert.equal(files[0].name, artifact.fileName);
  assert.ok(unzipSync(files[0].bytes)['3D/3dmodel.model']);
  cfg.tray.text.labels = [];
  await assert.rejects(flow.generateFiles(request, () => {}, () => {}), /enter a label/);
});

test('legacy palettes get white text, valid edits persist, and invalid colors fail', () => {
  assert.equal(api.normalizeModelColors({ tray: '#202020' }).text, '#ffffff');
  assert.equal(api.normalizeModelColors({ text: '#FFCC00' }).text, '#ffcc00');
  assert.throws(() => api.encodeTrayAms3mf({}, {}, 'red', '#ffffff'), /valid.*colors/);
});
