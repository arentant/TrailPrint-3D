import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, symlink, writeFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { unzipSync } from 'fflate'

let output
let generateModelExport
let mock

before(async () => {
  output = await mkdtemp(join(tmpdir(), 'trailprint-export-tests-'))
  await symlink(resolve('node_modules'), join(output, 'node_modules'), 'dir')
  await writeFile(join(output, 'package.json'), '{"type":"module"}\n')
  await build({
    stdin: {
      contents: `export { generateModelExport } from './electron/main/export/export-service';
        export { mock } from 'electron';`,
      resolveDir: resolve('.'),
    },
    outfile: join(output, 'desktop.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    alias: { '@shared': resolve('shared') },
    plugins: [{
      name: 'desktop-boundaries',
      setup(plugin) {
        plugin.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock' }))
        plugin.onResolve({ filter: /^\.\/generate-model-files$/ }, () => ({ path: 'generator', namespace: 'mock' }))
        plugin.onResolve({ filter: /^fs\/promises$/ }, () => ({ path: 'files', namespace: 'mock' }))
        plugin.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: path === 'electron' ? `
            export const mock = { result: {}, shown: [], options: [], workDirs: [] };
            export const shell = { showItemInFolder(path) { mock.shown.push(path); } };
            export const dialog = { async showSaveDialog(...args) {
              mock.options.push(args.at(-1)); return mock.result;
            } };
          ` : path === 'files' ? `
            import { mkdtemp as createTemp } from 'node:fs/promises';
            import { mock } from 'electron';
            export * from 'node:fs/promises';
            export async function mkdtemp(prefix) {
              const directory = await createTemp(prefix);
              mock.workDirs.push(directory); return directory;
            }
          ` : `
            export async function generateExportBundle(request, progress, sink) {
              for (const [name, data] of Object.entries(request.files)) await sink(name, data);
              if (request.fail) throw new Error('Model generation failed');
              return { artifact: request.artifact, fileNames: Object.keys(request.files) };
            }
          `,
          resolveDir: resolve('.'),
        }))
      },
    }],
  })
  ;({ generateModelExport, mock } = await import(pathToFileURL(join(output, 'desktop.mjs')).href))
})

beforeEach(() => {
  mock.result = { canceled: false, filePath: join(output, 'saved-model') }
  mock.shown = []
  mock.options = []
  mock.workDirs = []
})

after(async () => {
  if (output) await rm(output, { recursive: true, force: true })
})

function request(kind = 'file') {
  return {
    flow: 'test-map',
    config: { mapCrop: {} },
    artifact: {
      kind,
      fileName: kind === 'file' ? 'Buildings.stl' : 'MapParts.zip',
      extension: kind === 'file' ? 'stl' : 'zip',
      mimeType: kind === 'file' ? 'model/stl' : 'application/zip',
      saveDialogTitle: 'Save map model',
    },
    files: { 'Buildings.stl': new Uint8Array([1, 2, 3]) },
  }
}

async function assertStagingRemoved() {
  assert.equal(mock.workDirs.length, 1)
  await assert.rejects(access(mock.workDirs[0]), { code: 'ENOENT' })
}

test('desktop saves a flow-defined standalone model with its filename and extension', async () => {
  const progress = []
  const result = await generateModelExport(request(), (value) => progress.push(value))
  assert.equal(result.savedPath, join(output, 'saved-model.stl'))
  assert.equal(result.cancelled, false)
  assert.deepEqual([...await readFile(result.savedPath)], [1, 2, 3])
  assert.equal(mock.options[0].defaultPath, 'Buildings.stl')
  assert.equal(mock.options[0].title, 'Save map model')
  assert.deepEqual(mock.options[0].filters[0].extensions, ['stl'])
  assert.deepEqual(mock.shown, [result.savedPath])
  assert.equal(progress.at(-1).phase, 'done')
  assert.equal(progress.some((value) => value.phase === 'zip'), false)
  await assertStagingRemoved()
})

test('desktop ZIP delivery packages the entries declared by any model flow', async () => {
  const input = request('zip')
  input.files['Base.stl'] = new Uint8Array([4, 5, 6])
  const result = await generateModelExport(input, () => {})
  const files = unzipSync(await readFile(result.savedPath))
  assert.deepEqual(Object.keys(files).sort(), ['Base.stl', 'Buildings.stl'])
  for (const name of Object.keys(input.files)) assert.deepEqual(files[name], input.files[name])
  assert.equal(mock.options[0].defaultPath, 'MapParts.zip')
  assert.equal(result.savedPath, join(output, 'saved-model.zip'))
  await assertStagingRemoved()
})

test('desktop delivers the printable city SVG as an image with correct save metadata', async () => {
  const input = request();
  input.artifact = { kind: 'file', fileName: 'run_City_Map.svg', extension: 'svg', mimeType: 'image/svg+xml', saveDialogTitle: 'Save printable city map picture' };
  input.files = { 'run_City_Map.svg': new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>') };
  const result = await generateModelExport(input, () => {});
  assert.equal(result.savedPath, join(output, 'saved-model.svg'));
  assert.equal(mock.options[0].filters[0].name, 'SVG image');
  assert.deepEqual(await readFile(result.savedPath), Buffer.from(input.files['run_City_Map.svg']));
  await assertStagingRemoved();
})

test('cancelled desktop saves clean up staged files and do not reveal an export', async () => {
  mock.result = { canceled: true }
  const result = await generateModelExport(request(), () => {})
  assert.equal(result.cancelled, true)
  assert.equal(result.savedPath, undefined)
  assert.deepEqual(mock.shown, [])
  await assertStagingRemoved()
})

test('generation failures clean up staging and never open the save dialog', async () => {
  await assert.rejects(generateModelExport({ ...request(), fail: true }, () => {}), /Model generation failed/)
  assert.deepEqual(mock.options, [])
  assert.deepEqual(mock.shown, [])
  await assertStagingRemoved()
})
