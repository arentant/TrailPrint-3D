import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

let output
let elevation

before(async () => {
  output = await mkdtemp(join(tmpdir(), 'trailprint-api-runtime-'))
  // Compile without Vite or a bundler, as Vercel's Node runtime does. Importing
  // this output catches missing .js extensions in every transitive dependency.
  execFileSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.api.json',
    '--noEmit', 'false', '--rootDir', '.', '--outDir', output,
  ], { stdio: 'pipe' })
  await writeFile(join(output, 'package.json'), '{"type":"module"}\n')
  await symlink(resolve('node_modules'), join(output, 'node_modules'), 'dir')
  elevation = (await import(pathToFileURL(join(output, 'api/elevation.js')).href)).default
})

after(async () => {
  if (output) await rm(output, { recursive: true, force: true })
})

async function invoke(request) {
  const result = { status: undefined, headers: {}, body: undefined }
  const response = {
    setHeader(name, value) { result.headers[name.toLowerCase()] = value; return this },
    writeHead(status, headers) {
      result.status = status
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value)
      return this
    },
    end(body) { result.body = body; return this },
  }
  await elevation(request, response)
  return result
}

test('the compiled endpoint starts in plain Node and handles GET', async () => {
  const response = await invoke({ method: 'GET' })
  assert.equal(response.status, 405)
  assert.equal(response.headers.allow, 'POST')
  assert.equal(response.headers['cache-control'], 'private, no-store')
  assert.deepEqual(JSON.parse(response.body), { error: 'Use POST for elevation requests' })
})

test('Vercel-parsed POST bodies reach validation instead of a startup crash', async () => {
  const response = await invoke({ method: 'POST', body: {} })
  assert.equal(response.status, 400)
  assert.deepEqual(JSON.parse(response.body), { error: 'Enter a valid OpenTopography API key' })
})
