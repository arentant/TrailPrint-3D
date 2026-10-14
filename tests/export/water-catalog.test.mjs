import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const compiled = await build({ stdin: { contents: `export * from './shared/water/catalog'; export * from './shared/water/indexed-reader'; export * from './shared/types/config';`, resolveDir: resolve('.') }, bundle: true, write: false, platform: 'node', format: 'esm' });
const directory = await mkdtemp(join(tmpdir(), 'trailprint-water-catalog-'));
after(() => rm(directory, { recursive: true, force: true }));
await writeFile(join(directory, 'catalog.mjs'), compiled.outputFiles[0].contents);
const api = await import(pathToFileURL(join(directory, 'catalog.mjs')).href);
const manifest = JSON.parse(await readFile('fixtures/water/indexed/manifest.json', 'utf8'));
const files = Object.fromEntries(await Promise.all(manifest.datasets.map(async d => [d.url, await readFile(`fixtures/water/indexed/${d.url}`)])));
const bounds = { minLat: 40.176, maxLat: 40.184, minLon: 44.506, maxLon: 44.514 };
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

function host(log = [], fail = '') {
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('manifest.json')) return Response.json(manifest);
    const path = new URL(url).pathname.slice(1), data = files[path];
    if (path.includes(fail) && fail) return new Response('Unavailable', { status: 503 });
    const header = options.headers.Range;
    assert.match(header, /^bytes=\d+-\d+$/); log.push(header);
    const [, first, last] = /bytes=(\d+)-(\d+)/.exec(header);
    const end = Math.min(Number(last), data.length - 1);
    return new Response(data.subarray(Number(first), end + 1), { status: 206,
      headers: { 'Content-Range': `bytes ${first}-${end}/${data.length}` } });
  };
}

test('indexed range reads preserve IDs, islands and river widths and omit distant features', async () => {
  const requests = []; host(requests);
  const source = { ...manifest.datasets[0], url: manifest.datasets[0].sourceUrl };
  const features = await api.readIndexedWater('https://fixture.test/fixture-v1/lakes.fgb', bounds, source);
  assert.equal(features.length, 1); assert.equal(features[0].id, 'hydrolakes:lake-1');
  assert.equal(features[0].geometry.coordinates[0].length, 2);
  assert.ok(requests.length > 0);
  const rivers = await api.readIndexedWater('https://fixture.test/fixture-v1/rivers.fgb', bounds, manifest.datasets[1]);
  assert.equal(rivers[0].widthM, 12); assert.equal(rivers[0].geometry.type, 'MultiLineString');
});

test('a host ignoring Range is rejected without consuming its global response', async () => {
  let cancelled = false, consumed = false;
  globalThis.fetch = async () => ({ status: 200, headers: new Headers(), body: { cancel: async () => { cancelled = true; } }, arrayBuffer: async () => { consumed = true; } });
  await assert.rejects(api.readIndexedWater('https://fixture.test/fixture-v1/lakes.fgb', bounds, manifest.datasets[0]), /range requests/);
  assert.equal(cancelled, true); assert.equal(consumed, false);
});

test('partial outages retain successful sources and report failure separately from no water', async () => {
  host([], 'rivers');
  const config = api.createDefaultConfig(); Object.assign(config.mapCrop, { mapCenterLat: 40.18, mapCenterLon: 44.51, mapZoom: 14 });
  const request = { mapCrop: config.mapCrop, viewportWidth: 800, viewportHeight: 600 };
  const catalog = await api.loadWaterCatalog(request, { loadOsm: async () => { throw new Error('OSM unavailable'); }, manifestUrl: 'https://fixture.test/manifest.json' });
  assert.ok(catalog.features.some(f => f.source.id === 'hydrolakes'));
  assert.ok(catalog.errors.some(e => /OSM unavailable/.test(e.message)));
  assert.ok(catalog.errors.some(e => /grwl/.test(e.source)));
  assert.ok(!catalog.sources.some(s => s.id === 'grwl'));
});

test('catalog caching, refresh and cancellation are independent of terrain', async () => {
  host(); let osmCalls = 0;
  const config = api.createDefaultConfig(); Object.assign(config.mapCrop, { mapCenterLat: 40.18, mapCenterLon: 44.51, mapZoom: 14.1 });
  const request = { mapCrop: config.mapCrop, viewportWidth: 800, viewportHeight: 600 };
  const options = { loadOsm: async () => { osmCalls++; return { elements: [] }; }, manifestUrl: 'https://fixture.test/manifest.json' };
  const first = await api.loadWaterCatalog(request, options);
  assert.equal((await api.loadWaterCatalog(request, options)), first); assert.equal(osmCalls, 1);
  await api.loadWaterCatalog({ ...request, refresh: true }, options); assert.equal(osmCalls, 2);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.loadWaterCatalog(request, { ...options, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(osmCalls, 2);
});
