import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { resolve } from 'node:path'

const compiled = await build({
  stdin: {
    contents: `export { createExportPipeline } from './shared/export/export-pipeline';
      export { gpxExportStem, gpxExportFileName, modelExportStem, modelExportFileName } from './shared/export/export-artifact';
      export { createDefaultConfig } from './shared/types/config';
      export { createDefaultCityConfig } from './shared/types/city';
      export { encodeBinaryStl } from './shared/utils/binary-stl';
      export { buildSprayPaintManifest } from './shared/utils/spray-manifest';`,
    resolveDir: resolve('.'),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
})
const { createExportPipeline, gpxExportStem, gpxExportFileName, modelExportStem, modelExportFileName, createDefaultConfig, createDefaultCityConfig, encodeBinaryStl, buildSprayPaintManifest } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`
)

const bytes = new Uint8Array([1, 2, 3])
const noop = () => {}
const artifact = (kind = 'zip', fileName = 'Models.zip') => ({
  kind, fileName, extension: kind === 'zip' ? 'zip' : 'stl',
  mimeType: kind === 'zip' ? 'application/zip' : 'model/stl',
  saveDialogTitle: 'Save models',
})
const flow = (files, output = artifact()) => ({
  describeArtifact: () => output,
  generateFiles: async (_request, progress, sink) => {
    progress({ phase: 'model', progress: 0.5, message: 'Generating models' })
    for (const name of files) await sink(name, bytes)
  },
})

test('omitted flow routes to the default and preserves archive entries and progress', async () => {
  const generate = createExportPipeline({ 'mountain-trail': flow(['Terrain.stl', 'Trail.stl']) }, 'mountain-trail')
  const written = []
  const progress = []
  const bundle = await generate({ config: {} }, (value) => progress.push(value), async (name, data) => {
    written.push(name)
    assert.equal(data, bytes)
  })
  assert.deepEqual(bundle.fileNames, written)
  assert.deepEqual(written, ['Terrain.stl', 'Trail.stl'])
  assert.equal(bundle.artifact.kind, 'zip')
  assert.equal(progress[0].phase, 'model')
})

test('a separately registered flow accepts its own inputs without GPX or terrain settings', async () => {
  let received
  const additional = flow(['Model.stl'], artifact('file', 'Model.stl'))
  const generateFiles = additional.generateFiles
  additional.generateFiles = (request, ...callbacks) => {
    received = request
    return generateFiles(request, ...callbacks)
  }
  const generate = createExportPipeline({
    'mountain-trail': { generateFiles: () => assert.fail('Wrong flow'), describeArtifact: noop },
    'test-map': additional,
  }, 'mountain-trail')
  const request = { flow: 'test-map', config: { mapCrop: {} }, viewportWidth: 800, viewportHeight: 600 }
  const bundle = await generate(request, noop, noop)
  assert.equal(received, request)
  assert.deepEqual(bundle.fileNames, ['Model.stl'])
  assert.equal(bundle.artifact.mimeType, 'model/stl')
})

test('unknown and inherited flow names fail before generating or writing files', async () => {
  const generate = createExportPipeline({ 'mountain-trail': flow(['Model.stl']) }, 'mountain-trail')
  for (const id of ['city', 'constructor', 'toString']) {
    await assert.rejects(generate({ flow: id }, noop, () => assert.fail('Unexpected write')), {
      code: 'EXPORT_FLOW_UNSUPPORTED',
    })
  }
})

test('unsafe and duplicate filenames never reach the file sink', async () => {
  for (const name of ['../Model.stl', 'folder/Model.stl', 'folder\\Model.stl', '', '.', '..', 'bad\0name']) {
    const generate = createExportPipeline({ test: flow([name]) }, 'test')
    await assert.rejects(generate({}, noop, () => assert.fail('Unsafe write')), { code: 'EXPORT_FILE_INVALID' })
  }
  const written = []
  const generate = createExportPipeline({ test: flow(['Model.stl', 'Model.stl']) }, 'test')
  await assert.rejects(generate({}, noop, (name) => written.push(name)), { code: 'EXPORT_FILE_DUPLICATE' })
  assert.deepEqual(written, ['Model.stl'])
})

test('standalone artifacts must contain exactly the declared file and archives cannot be empty', async () => {
  for (const files of [[], ['Other.stl'], ['Model.stl', 'Extra.stl']]) {
    const generate = createExportPipeline({ test: flow(files, artifact('file', 'Model.stl')) }, 'test')
    await assert.rejects(generate({}, noop, noop), { code: 'EXPORT_OUTPUT_INVALID' })
  }
  const generate = createExportPipeline({ test: flow([]) }, 'test')
  await assert.rejects(generate({}, noop, noop), { code: 'EXPORT_OUTPUT_INVALID' })
})

test('concurrent emission rejects duplicate names before a second write', async () => {
  const generate = createExportPipeline({ test: {
    describeArtifact: () => artifact(),
    generateFiles: async (_request, _progress, sink) => {
      await Promise.all([sink('Model.stl', bytes), sink('Model.stl', bytes)])
    },
  } }, 'test')
  let writes = 0
  await assert.rejects(generate({}, noop, async () => { writes++ }), { code: 'EXPORT_FILE_DUPLICATE' })
  assert.equal(writes, 1)
})

test('file sink failures propagate to the runtime adapter', async () => {
  const error = new Error('Disk full')
  const generate = createExportPipeline({ test: flow(['Model.stl']) }, 'test')
  await assert.rejects(generate({}, noop, () => { throw error }), (received) => received === error)
})

test('export names use the GPX filename, preserving spaces, Unicode and multiple dots', () => {
  const gpx = { fileName: 'Արագած hike.v2.GPX', trackName: 'Different internal title' }
  assert.equal(gpxExportStem(gpx), 'Արագած hike.v2')
  assert.equal(gpxExportFileName(gpx, 'Trail_Line.stl'), 'Արագած hike.v2_Trail_Line.stl')
  assert.equal(`${gpxExportStem(gpx)}.zip`, 'Արագած hike.v2.zip')
})

test('missing filenames fall back to desktop paths, track titles and a default', () => {
  assert.equal(gpxExportStem({ filePath: '/Users/test/tracks/morning-run.gpx' }), 'morning-run')
  assert.equal(gpxExportStem({ filePath: 'C:\\tracks\\morning-run.gpx' }), 'morning-run')
  assert.equal(gpxExportStem({ fileName: '.gpx', trackName: 'Morning run' }), 'Morning run')
  assert.equal(gpxExportStem({}), 'TrailPrint')
})

test('export names remove unsafe characters and avoid reserved or oversized filenames', () => {
  assert.equal(gpxExportStem({ fileName: '../ridge:run?*.gpx' }), 'ridge_run_')
  assert.equal(gpxExportStem({ trackName: '  ../ridge\\run\0  ' }), '_ridge_run_')
  assert.equal(gpxExportStem({ fileName: 'CON.gpx' }), '_CON')
  const name = gpxExportFileName({ fileName: '山'.repeat(100) + '.gpx' }, 'Assembly_Instructions.txt')
  assert.ok(new TextEncoder().encode(name).length <= 255)
  assert.ok(!name.includes('\ufffd'))
})

test('export prefixes include the active dimensions, shape, mesh quality and magnet option', () => {
  const config = createDefaultConfig(); config.gpx.fileName = 'berlin.gpx';
  config.mapCrop.radiusMm = 80; config.terrain.meshQuality = 'high'; config.assembly.magnet.enabled = true;
  const stem = 'berlin_circle_R80mm_mesh-high_magnets-on-circle-6x2mm';
  assert.equal(modelExportStem(config), stem);
  assert.equal(modelExportFileName(config, 'Tray_Base.stl'), `${stem}_Tray_Base.stl`);
  config.mapCrop.shape = 'rectangle'; config.mapCrop.lengthMm = 200; config.mapCrop.widthMm = 150;
  config.assembly.magnet.enabled = false;
  assert.equal(modelExportStem(config), 'berlin_rectangle_200x150mm_mesh-high_magnets-off');
  config.mapCrop.shape = 'polygon'; config.mapCrop.polygonSides = 6; config.mapCrop.polygonSideLengthMm = 40;
  config.terrain.meshQuality = 'custom'; config.terrain.meshQualityCustom.maxGrid = 1536;
  assert.equal(modelExportStem(config), 'berlin_polygon6_R40mm_mesh-custom1536_magnets-off');
  config.assembly.magnet.enabled = true; config.assembly.magnet.shape = 'rectangle';
  config.assembly.magnet.lengthMm = 8; config.assembly.magnet.widthMm = 4; config.assembly.magnet.thicknessMm = 1.5;
  assert.ok(modelExportStem(config).endsWith('_magnets-on-rectangle-8x4x1.5mm'));
  const city = createDefaultCityConfig(); city.gpx.fileName = 'berlin.gpx';
  assert.equal(modelExportStem(city), 'berlin_circle_R60mm_mesh-high_magnets-off');
});

test('parameterized export names preserve Unicode and stay within filename byte limits', () => {
  const config = createDefaultConfig(); config.gpx.fileName = '山'.repeat(100) + '.gpx';
  const name = modelExportFileName(config, 'Assembly_Instructions.txt');
  assert.ok(new TextEncoder().encode(name).length <= 255);
  assert.ok(name.endsWith('_circle_R60mm_mesh-studio_magnets-off_Assembly_Instructions.txt'));
  assert.ok(!name.includes('\ufffd'));
  config.gpx.fileName = 'Արագած.gpx';
  assert.ok(modelExportStem(config).startsWith('Արագած_'));
});

test('binary STL names omit the generic brand and long Unicode headers do not overwrite triangles', () => {
  const mesh = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
  const name = 'Արագած'.repeat(20);
  const stl = encodeBinaryStl(mesh, name);
  const header = new TextDecoder('utf-8', { fatal: true }).decode(stl.subarray(0, 80)).replace(/\0+$/, '');
  assert.ok(name.startsWith(header)); assert.ok(header.length > 0);
  assert.equal(stl.length, 134); assert.equal(new DataView(stl.buffer).getUint32(80, true), 1);
  assert.equal(new DataView(stl.buffer).getFloat32(108, true), 1);
  assert.doesNotMatch(header, /TrailPrint/);
});

test('paint manifests reference the parameterized terrain and masks', async () => {
  const config = createDefaultConfig()
  config.gpx.fileName = 'ridge-run.gpx'
  const plan = {
    colors: [{ index: 1, hex: '#ffffff', label: 'Snow', regionId: 1 }],
    cellRegions: [1], gridCols: 1, gridRows: 1, generatedAt: 1,
  }
  const manifest = await buildSprayPaintManifest(config, plan)
  assert.equal(manifest.terrainStl, 'ridge-run_circle_R60mm_mesh-studio_magnets-off_Terrain_Main.stl')
  assert.equal(manifest.colors[0].stl, 'ridge-run_circle_R60mm_mesh-studio_magnets-off_Mask_Color_01.stl')
})
