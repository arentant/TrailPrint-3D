import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync, gunzipSync } from 'node:zlib'
import { build } from 'esbuild'
import { writeArrayBuffer } from 'geotiff'
import { authEnv, sessionCookie } from '../auth-fixture.mjs'

let output, elevation, source, samplerApi, browser, cookie
const previousEnv = Object.fromEntries(Object.keys(authEnv).map(key => [key, process.env[key]]))
before(async () => {
  Object.assign(process.env, authEnv)
  output = await mkdtemp(join(tmpdir(), 'trailprint-elevation-grid-'))
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.api.json', '--noEmit', 'false', '--rootDir', '.', '--outDir', output], { stdio: 'pipe' })
  await writeFile(join(output, 'package.json'), '{"type":"module"}')
  await symlink(resolve('node_modules'), join(output, 'node_modules'), 'dir')
  const load = path => import(pathToFileURL(join(output, path)).href)
  elevation = (await load('api/elevation.js')).default
  source = await load('server/elevation-source.js')
  samplerApi = await load('electron/main/terrain/geotiff-sampler.js')
  const compiled = await build({
    stdin: { contents: `export * from './src/browser/dem-provider'; export { createDefaultConfig } from './shared/types/config';
      export { heightfieldCellMm, modelMmToLatLon } from './shared/utils/map-mm-projection';`, resolveDir: resolve('.') },
    bundle: true, write: false, platform: 'node', format: 'esm',
  })
  browser = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`)
  const session = await sessionCookie()
  cookie = `${session.name}=${session.value}`
})
after(async () => {
  if (output) await rm(output, { recursive: true, force: true })
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function request(cols = 1536, rows = 1536, bearing = 37) {
  const mapCrop = { ...browser.createDefaultConfig().mapCrop, mapCenterLat: 40.18, mapCenterLon: 44.51, mapZoom: 15, mapBearingDeg: bearing }
  const crop = { shape: 'circle', centerLat: 40.18, centerLon: 44.51, bearingDeg: bearing, minLat: 40.17, maxLat: 40.19, minLon: 44.49, maxLon: 44.53, widthMm: 160, heightMm: 160, radiusMm: 80 }
  return { crop, cols, rows, mapCrop, viewportWidth: 800, viewportHeight: 600, dataset: 'COP30', apiKey: 'test-only-grid-key' }
}
async function invoke(body, headers = { cookie }) {
  const result = { status: 0, headers: {}, body: null }
  const res = {
    setHeader(name, value) { result.headers[name.toLowerCase()] = value; return this },
    writeHead(status, headers = {}) { result.status = status; for (const [name, value] of Object.entries(headers)) this.setHeader(name, value); return this },
    end(value) { result.body = value; return this },
  }
  await elevation({ method: 'POST', body, headers }, res)
  return result
}
function roughRaster(url) {
  const bounds = Object.fromEntries(['west', 'south', 'east', 'north'].map(key => [key, Number(url.searchParams.get(key))]))
  let seed = 123456789
  const pixels = Float32Array.from({ length: 512 * 512 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return 500 + seed / 2 ** 32 * 1500
  })
  return writeArrayBuffer(pixels, {
    width: 512, height: 512,
    ModelPixelScale: [(bounds.east - bounds.west) / 512, (bounds.north - bounds.south) / 512, 0],
    ModelTiepoint: [0, 0, 0, bounds.west, bounds.north, 0], GeographicTypeGeoKey: 4326,
  })
}
async function sample(req) {
  return browser.sampleDemGrid(req.crop, req.cols, req.rows, req.mapCrop, req.viewportWidth, req.viewportHeight, { dataset: req.dataset, openTopographyApiKey: req.apiKey })
}

test('1536 grids preserve rotated sample coordinates at chunk boundaries and reuse one source download', async t => {
  source.clearElevationSamplerCache()
  const req = request()
  const chunks = []
  let upstream = 0, raster
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url) !== '/api/elevation') {
      upstream++
      raster = roughRaster(new URL(url))
      return new Response(raster)
    }
    const body = JSON.parse(init.body)
    chunks.push(body.sampleWindow)
    const response = await invoke(body)
    assert.equal(response.status, 200, String(response.body))
    assert.equal(response.headers['cache-control'], 'private, no-store')
    assert.ok(response.body.length < 4_400_000)
    return new Response(gunzipSync(response.body))
  })
  const result = await sample(req)
  assert.equal(result.elevations.length, 1536 * 1536)
  assert.deepEqual(chunks, [{ rowStart: 0, rowCount: 682 }, { rowStart: 682, rowCount: 682 }, { rowStart: 1364, rowCount: 172 }])
  assert.equal(upstream, 1)
  const expected = await samplerApi.createGeotiffSampler(raster)
  // Include the first/last sample and both sides of each chunk seam.
  for (const row of [0, 681, 682, 1363, 1364, 1535]) for (const col of [0, 777, 1535]) {
    const p = browser.heightfieldCellMm(req.crop, row, col, req.rows, req.cols)
    const geo = browser.modelMmToLatLon(p.x, p.y, req.mapCrop, req.crop, req.viewportWidth, req.viewportHeight)
    assert.equal(result.elevations[row * req.cols + col], Math.fround(expected.sample(geo.lat, geo.lon)))
  }
  const full = Buffer.alloc(req.cols * req.rows * 4)
  for (let i = 0; i < result.elevations.length; i++) full.writeFloatLE(result.elevations[i], i * 4)
  assert.ok(gzipSync(full).length > 4_400_000, 'this fixture reproduces the old response-size failure')
  result.elevations[0] = -1
  const again = await sample(req)
  assert.notEqual(again.elevations[0], -1, 'the cached grid cannot be mutated by height processing')
  assert.equal(chunks.length, 3)
  assert.equal(upstream, 1)
})

test('Studio keeps one response and custom rectangular grids retain a short final chunk', async t => {
  source.clearElevationSamplerCache()
  const bodies = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url) !== '/api/elevation') return new Response(roughRaster(new URL(url)))
    const body = JSON.parse(init.body); bodies.push(body)
    const response = await invoke(body)
    assert.equal(response.status, 200)
    return new Response(gunzipSync(response.body))
  })
  assert.equal((await sample(request(1024, 1024, 0))).elevations.length, 1024 * 1024)
  assert.equal(bodies.length, 1)
  assert.equal(bodies[0].sampleWindow, undefined)
  assert.equal((await sample(request(1280, 1000, 90))).elevations.length, 1280 * 1000)
  assert.deepEqual(bodies.slice(1).map(body => body.sampleWindow), [{ rowStart: 0, rowCount: 819 }, { rowStart: 819, rowCount: 181 }])
})

test('invalid or oversized row windows fail before providers and require authentication', async t => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('Unexpected provider request'))
  for (const sampleWindow of [null, {}, { rowStart: -1, rowCount: 10 }, { rowStart: 0.5, rowCount: 10 }, { rowStart: 1500, rowCount: 100 }, { rowStart: 0, rowCount: 0 }, { rowStart: 0, rowCount: 1536 }]) {
    assert.equal((await invoke({ ...request(), sampleWindow })).status, 400)
  }
  assert.equal((await invoke(request())).status, 400)
  assert.equal((await invoke({ ...request(), sampleWindow: { rowStart: 0, rowCount: 1 } }, {})).status, 401)
})

test('a failed later chunk is not cached and retry downloads the whole grid', async t => {
  const req = { ...request(1152, 1152), apiKey: 'test-only-retry-key' }
  const starts = []
  let fail = true
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body)
    starts.push(body.sampleWindow.rowStart)
    if (body.sampleWindow.rowStart && fail) {
      fail = false
      return new Response(new Uint8Array(4))
    }
    return new Response(Buffer.alloc(body.cols * body.sampleWindow.rowCount * 4))
  })
  await assert.rejects(sample(req), /incomplete/)
  assert.equal((await sample(req)).elevations.length, 1152 * 1152)
  assert.deepEqual(starts, [0, 910, 0, 910])
})

test('raster cache isolates API keys, deduplicates loads and retries provider failures', async t => {
  source.clearElevationSamplerCache()
  let calls = 0
  t.mock.method(globalThis, 'fetch', async url => { calls++; return new Response(roughRaster(new URL(url))) })
  const url = new URL('https://portal.opentopography.org/API/globaldem?west=44.49&south=40.17&east=44.53&north=40.19&API_Key=first')
  const [first, duplicate] = await Promise.all([source.loadElevationSampler(url), source.loadElevationSampler(url)])
  assert.equal(first, duplicate); assert.equal(calls, 1)
  url.searchParams.set('API_Key', 'second')
  assert.notEqual(await source.loadElevationSampler(url), first); assert.equal(calls, 2)
  source.clearElevationSamplerCache()
  const failed = t.mock.method(globalThis, 'fetch', async () => ++calls === 3 ? new Response('', { status: 429 }) : new Response(roughRaster(url)))
  await assert.rejects(source.loadElevationSampler(url), /request limit/)
  assert.ok(await source.loadElevationSampler(url)); assert.equal(calls, 4)
  failed.mock.restore()
})
