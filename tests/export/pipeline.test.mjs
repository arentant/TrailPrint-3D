import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { resolve } from 'node:path'

const compiled = await build({
  stdin: {
    contents: `export { createExportPipeline } from './shared/export/export-pipeline';
      export { timestampedZipName } from './shared/export/export-artifact';`,
    resolveDir: resolve('.'),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
})
const { createExportPipeline, timestampedZipName } = await import(
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

test('archive names keep the existing timestamp format', () => {
  assert.equal(timestampedZipName('TrailPrint', new Date(2026, 0, 2, 3, 4)), 'TrailPrint-20260102-0304.zip')
})
