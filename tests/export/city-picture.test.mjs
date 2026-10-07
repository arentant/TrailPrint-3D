import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const compiled = await build({
  stdin: { contents: `export * from './shared/city/map-tiles'; export * from './shared/city/printable-map';
    export * from './shared/utils/crop-region'; export * from './shared/utils/leaflet-projection';
    export * from './shared/city/geometry'; export * from './shared/types/city';`, resolveDir: resolve('.') },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const api = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);
const berlin = { minLat: 52.45, maxLat: 52.56, minLon: 13.25, maxLon: 13.5 };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');

test('Berlin marathon map tile count stays bounded by paper size across physical dimensions', () => {
  for (const size of [20, 100, 180, 500, 1000]) {
    const tiles = api.cityPictureTileSelection(berlin, size, size);
    assert.ok(tiles.length > 0 && tiles.length <= api.MAX_PICTURE_TILES);
    assert.ok(tiles.every((t) => t.zoom === tiles[0].zoom));
    assert.ok(tiles[0].zoom < 19, 'a city-wide print does not fetch building-level detail');
  }
});

test('Berlin paper map fetches enough real tile pixels for a 600 DPI print', () => {
  const sizeMm = 180;
  const tiles = api.cityPictureTileSelection(berlin, sizeMm, sizeMm);
  const zoom = tiles[0].zoom;
  const nw = api.latLngToCrsPoint(berlin.maxLat, berlin.minLon, zoom);
  const se = api.latLngToCrsPoint(berlin.minLat, berlin.maxLon, zoom);
  const pixels = Math.max(se.x - nw.x, se.y - nw.y);
  assert.ok(pixels >= sizeMm / 25.4 * 600);
  assert.ok(zoom > 13, 'higher-resolution exports use more detailed tiles');
  assert.ok(tiles.length <= api.MAX_PICTURE_TILES);
});

test('street tile requests have bounded concurrency, embed their images and reuse the current selection', async (t) => {
  api.clearCityPictureTileCache(); let active = 0, maxActive = 0, calls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.match(String(url), /World_Topo_Map\/MapServer\/tile\/\d+\/\d+\/\d+$/);
    calls++; maxActive = Math.max(maxActive, ++active);
    await new Promise((resolve) => setTimeout(resolve, 2)); active--;
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  });
  const tiles = await api.loadCityPictureTiles(berlin, 180, 180);
  assert.equal(calls, tiles.length); assert.ok(maxActive <= 4);
  assert.ok(tiles.every((tile) => tile.dataUrl === `data:image/png;base64,${png.toString('base64')}`));
  assert.equal(await api.loadCityPictureTiles(berlin, 180, 180), tiles);
  assert.equal(calls, tiles.length);
});

test('street tile failures remain retryable and cannot produce a blank successful export', async (t) => {
  api.clearCityPictureTileCache();
  let failed = true;
  t.mock.method(globalThis, 'fetch', async () => failed ? new Response('unavailable', { status: 503 }) : new Response(png, { headers: { 'content-type': 'image/png' } }));
  await assert.rejects(api.loadCityPictureTiles(berlin, 180, 180), /street map tile provider failed \(503\)/);
  failed = false;
  assert.ok((await api.loadCityPictureTiles(berlin, 180, 180)).length > 0);
});

test('high-resolution downloads stop oversized image payloads and remain retryable', async (t) => {
  api.clearCityPictureTileCache();
  let oversized = true, calls = 0;
  const largeImage = new Uint8Array(256 * 1024);
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(oversized ? largeImage : png, { headers: { 'content-type': 'image/png' } });
  });
  await assert.rejects(api.loadCityPictureTiles(berlin, 180, 180), /map image download exceeded 32 MB/);
  assert.ok(calls < api.cityPictureTileSelection(berlin, 180, 180).length, 'oversized downloads stop before fetching the entire selection');
  oversized = false;
  assert.ok((await api.loadCityPictureTiles(berlin, 180, 180)).length > 0);
});

test('embedded tile pixels and GPX share the same rotated millimeter projection', () => {
  const config = api.createDefaultCityConfig();
  Object.assign(config.mapCrop, { mapCenterLat: 52.51, mapCenterLon: 13.38, mapZoom: 12, mapBearingDeg: 37 });
  const request = { config, viewportWidth: 800, viewportHeight: 600 };
  const tile = { ...api.cityPictureTileSelection(berlin, 180, 180)[0], dataUrl: `data:image/png;base64,${png.toString('base64')}` };
  for (const shape of ['circle', 'rectangle', 'polygon']) {
    config.mapCrop.shape = shape; config.mapCrop.polygonSides = 5;
    const crop = api.computeTerrainCropRegion(config.mapCrop, 800, 600);
    const svg = api.renderPrintableCityMap(request, crop, [tile]);
    const matrix = /<image[^>]*matrix\(([^)]+)\)/.exec(svg)[1].split(' ').map(Number);
    const [a, b, c, d, e, f] = matrix;
    const pixel = { x: 147, y: 91 };
    const geo = api.crsPointToLatLng(tile.x * 256 + pixel.x, tile.y * 256 + pixel.y, tile.zoom);
    const [x, y] = api.cityProject(request, crop, geo.lon, geo.lat);
    assert.ok(Math.abs(x - (a * pixel.x + c * pixel.y + e)) < 1e-7);
    assert.ok(Math.abs(y - (b * pixel.x + d * pixel.y + f)) < 1e-7);
    assert.match(svg, /clip-path="url\(#city-footprint\)"/);
    assert.doesNotMatch(svg, /href="https?:/);
  }
});

test('paper picture contains only the framed map and orange route, with source credits in metadata', () => {
  const config = api.createDefaultCityConfig();
  config.gpx.trackName = '<script>Unwanted GPX title</script>';
  config.gpx.distanceKm = 42.195;
  Object.assign(config.mapCrop, { shape: 'rectangle', lengthMm: 120, widthMm: 90 });
  const crop = { shape: 'rectangle', widthMm: 120, heightMm: 90 };
  const svg = api.renderPrintableCityMap({ config, viewportWidth: 800, viewportHeight: 600 }, crop, []);
  assert.match(svg, /width="120mm" height="90mm" viewBox="0 0 120 90"/);
  assert.match(svg, /translate\(60 45\) scale\(1 -1\)/);
  assert.match(svg, /id="running-route"[^>]*stroke="#fc4c02"/);
  assert.doesNotMatch(svg, /Unwanted GPX title|42\.195|actual size|fit to page|<title|<desc|mm map/);
  assert.doesNotMatch(svg, /<text\b|map-attribution/);
  assert.match(svg, /<metadata>Sources: Esri,.*OpenStreetMap contributors/);
});
