import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const compiled = await build({
  stdin: { contents: `export * from './shared/city/map-tiles'; export * from './shared/city/printable-map';
    export * from './shared/utils/crop-region'; export * from './shared/utils/leaflet-projection';
    export * from './shared/city/geometry'; export * from './shared/types/city';
    export * from './shared/city/selection-crop';
    export * from './shared/utils/gpx-parser'; export * from './shared/city/picture-details';`, resolveDir: resolve('.') },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const api = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);
const berlin = { minLat: 52.45, maxLat: 52.56, minLon: 13.25, maxLon: 13.5 };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMILU/6DwAEgQIuIhp1GQAAAABJRU5ErkJggg==', 'base64');

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
    assert.match(String(url), /World_Topo_Map\/MapServer\/tile\/\d+\/\d+\/\d+\?blankTile=false$/);
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

test('unavailable map detail falls back to one supported tile level and caches that selection', async (t) => {
  api.clearCityPictureTileCache(); let calls = 0;
  const requestedZoom = api.cityPictureTileSelection(berlin, 180, 180)[0].zoom;
  const supportedZoom = requestedZoom - 2;
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls++;
    const zoom = Number(/\/tile\/(\d+)\//.exec(String(url))[1]);
    return zoom > supportedZoom ? new Response('', { status: 404 }) : new Response(png, { headers: { 'content-type': 'image/png' } });
  });
  const tiles = await api.loadCityPictureTiles(berlin, 180, 180);
  assert.ok(tiles.every((tile) => tile.zoom === supportedZoom));
  const before = calls;
  assert.equal(await api.loadCityPictureTiles(berlin, 180, 180), tiles);
  assert.equal(calls, before);
});

test('street tile failures remain retryable and cannot produce a blank successful export', async (t) => {
  api.clearCityPictureTileCache();
  let failed = true;
  t.mock.method(globalThis, 'fetch', async () => failed ? new Response('unavailable', { status: 503 }) : new Response(png, { headers: { 'content-type': 'image/png' } }));
  await assert.rejects(api.loadCityPictureTiles(berlin, 180, 180), /street map tile provider failed \(503\)/);
  failed = false;
  assert.ok((await api.loadCityPictureTiles(berlin, 180, 180)).length > 0);
});

test('missing city coverage fails before a world-level tile can become a blank successful picture', async (t) => {
  api.clearCityPictureTileCache();
  const zooms = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const zoom = Number(/\/tile\/(\d+)\//.exec(String(url))[1]); zooms.push(zoom);
    return zoom > 0 ? new Response('', { status: 404 }) : new Response(png, { headers: { 'content-type': 'image/png' } });
  });
  await assert.rejects(api.loadCityPictureTiles(berlin, 180, 180), /Detailed street maps are unavailable/);
  assert.ok(Math.min(...zooms) > 0);
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
  config.picture.enabled = false;
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

test('GPX activity details decode text, preserve the local date and include stationary time', () => {
  const track = api.parseGpxXml(`<gpx><metadata><author><name>Narek &amp; Co.</name></author></metadata><trk><name>Run &lt;3</name><trkseg>
    <trkpt lat="40" lon="44"><time>2023-09-24T00:30:00+04:00</time></trkpt>
    <trkpt lat="40.01" lon="44"><time>2023-09-24T00:35:00+04:00</time></trkpt>
    <trkpt lat="40.01" lon="44"><time>2023-09-24T00:36:00+04:00</time></trkpt>
  </trkseg></trk></gpx>`);
  assert.equal(track.trackName, 'Run <3'); assert.equal(track.athleteName, 'Narek & Co.');
  assert.equal(track.activityDate, '2023-09-24'); assert.equal(track.elapsedSeconds, 360);
  assert.equal(track.pointCount, 2, 'stationary points do not change the route geometry');
  const details = api.cityPictureDetails({ ...track, distanceKm: 1.2 });
  assert.equal(details.duration, '0:06:00'); assert.equal(details.pace, '5:00');
  const cdata = api.parseGpxXml('<gpx><trk><name><![CDATA[Run &amp; recover]]></name><trkseg><trkpt lat="40" lon="44"/><trkpt lat="40.01" lon="44"/></trkseg></trk></gpx>');
  assert.equal(cdata.trackName, 'Run &amp; recover', 'CDATA text is preserved literally');
});

test('GPX missing or backwards timestamps do not invent elapsed time or pace', () => {
  for (const times of ['', '<time>invalid</time>', '<time>2023-09-24T12:00:00Z</time>']) {
    const track = api.parseGpxXml(`<gpx><trk><trkseg><trkpt lat="40" lon="44">${times}</trkpt><trkpt lat="40.01" lon="44"><time>2023-09-24T11:00:00Z</time></trkpt></trkseg></trk></gpx>`);
    assert.equal(track.elapsedSeconds, undefined);
    assert.equal(api.cityPictureDetails(track).pace, '');
  }
  const metadataOnly = api.parseGpxXml('<gpx><metadata><time>2023-09-24T12:00:00Z</time></metadata><rte><name>Sunday run</name><rtept lat="40" lon="44"/><rtept lat="40.01" lon="44"/></rte></gpx>');
  assert.equal(metadataOnly.activityDate, '2023-09-24'); assert.equal(metadataOnly.trackName, 'Sunday run');
  assert.equal(api.cityPictureDetails(metadataOnly).duration, '');
});

test('poster details are editable, escaped and laid out outside the original map footprint', () => {
  const config = api.createDefaultCityConfig();
  Object.assign(config.mapCrop, { shape: 'rectangle', lengthMm: 120, widthMm: 90 });
  Object.assign(config.picture, { layout: 'editorial', title: 'Berlin Marathon', athlete: 'Narek <script>& Margaryan', date: '2023-09-24', distance: '42.20', duration: '3:55:41', pace: '5:31', theme: 'midnight' });
  const crop = { shape: 'rectangle', widthMm: 120, heightMm: 90 };
  const request = { config, viewportWidth: 800, viewportHeight: 600 };
  const svg = api.renderPrintableCityMap(request, crop, []);
  assert.match(svg, /id="poster-details"/); assert.match(svg, /BERLIN MARATHON/);
  assert.match(svg, /Narek &lt;script&gt;&amp; Margaryan/); assert.doesNotMatch(svg, /<script/);
  for (const text of ['24 SEP 2023', '42.20 km', '3:55:41', '5:31 /km']) assert.ok(svg.includes(text));
  assert.match(svg, /fill="#192b28"/);
  assert.match(svg, /width="135.6mm" height="176.4mm"/);
  assert.match(svg, /translate\(67.8 82.8\) scale\(1 -1\)/, 'the map is translated, never scaled down');
  Object.assign(config.picture, { athlete: '', date: '', distance: '', duration: '', pace: '' });
  const empty = api.renderPrintableCityMap(request, crop, []);
  assert.doesNotMatch(empty, />RUN BY<|>DISTANCE<|>DATE<|>ELAPSED<|>PACE</);
});


test('on-map variations keep cards within each footprint and preserve the map and route at print scale', () => {
  const config = api.createDefaultCityConfig();
  Object.assign(config.picture, { title: 'Berlin Marathon', athlete: 'Narek Margaryan', date: '2023-09-24', distance: '42.20', duration: '3:55:41', pace: '5:31' });
  assert.equal(config.picture.layout, 'cards');
  config.gpx.segments = [[{ lat: 52.50, lon: 13.3 }, { lat: 52.51, lon: 13.4 }]];
  Object.assign(config.mapCrop, { lengthMm: 120, widthMm: 90, mapCenterLat: 52.51, mapCenterLon: 13.38, mapZoom: 12, mapBearingDeg: 27 });
  const request = { config, viewportWidth: 800, viewportHeight: 600 };
  for (const shape of ['rectangle', 'circle', 'polygon']) {
    config.mapCrop.shape = shape; config.mapCrop.polygonSides = 3;
    const crop = api.citySelectionCrop(request);
    config.picture.enabled = false;
    const bare = api.renderPrintableCityMap(request, crop, []);
    const route = /<g id="running-route"[\s\S]*?<\/g>/.exec(bare)[0];
    config.picture.enabled = true;
    for (const layout of ['cards', 'minimal']) {
      config.picture.layout = layout;
      const svg = api.renderPrintableCityMap(request, crop, []);
      assert.equal(/<g id="running-route"[\s\S]*?<\/g>/.exec(svg)[0], route);
      assert.equal(api.cityPictureLayout(crop, config.picture).width, crop.widthMm);
      assert.equal(api.cityPictureLayout(crop, config.picture).height, crop.heightMm);
      assert.match(svg, /clip-path="url\(#poster-overlay-footprint\)"/);
      const outline = api.cityFootprint(request, crop);
      const inside = (x, y) => {
        const px = x - crop.widthMm / 2, py = crop.heightMm / 2 - y;
        if (!outline) return Math.hypot(px, py) <= crop.radiusMm + .001;
        let within = false;
        for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
          const [xi, yi] = outline[i], [xj, yj] = outline[j];
          if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) within = !within;
        }
        return within;
      };
      const cards = [...svg.matchAll(/<rect data-overlay-card="[^"]+"[^>]+\/>/g)];
      assert.equal(cards.length, layout === 'cards' ? 6 : 0);
      for (const [rect] of cards) {
        const attrs = Object.fromEntries([...rect.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
        const x = Number(attrs.x), y = Number(attrs.y), width = Number(attrs.width), height = Number(attrs.height);
        assert.ok(width > 0 && height > 0);
        for (const [cx, cy] of [[x, y], [x + width, y], [x, y + height], [x + width, y + height]]) {
          assert.ok(inside(cx, cy), shape + ' / ' + attrs['data-overlay-card'] + ' stays on the map');
        }
      }
    }
  }
});

test('layout changes retain edited details, omit cleared fields and support older editorial configs', () => {
  const config = api.createDefaultCityConfig();
  const crop = { shape: 'rectangle', widthMm: 120, heightMm: 90 };
  Object.assign(config.mapCrop, { shape: 'rectangle', lengthMm: 120, widthMm: 90 });
  Object.assign(config.picture, { title: 'Run <script>', athlete: 'Narek & Co.', distance: '42.20', duration: '', pace: '', date: '' });
  const request = { config, viewportWidth: 800, viewportHeight: 600 };
  for (const layout of ['cards', 'minimal', 'editorial']) {
    config.picture.layout = layout;
    const svg = api.renderPrintableCityMap(request, crop, []);
    assert.match(svg, /Narek &amp; Co\./); assert.match(svg, /42.20 km/);
    assert.doesNotMatch(svg, /<script|>ELAPSED<|>PACE<|>DATE<|data-overlay-card="duration"/);
  }
  delete config.picture.layout;
  assert.equal(api.cityPictureLayout(crop, config.picture).width, 135.6);
  assert.match(api.renderPrintableCityMap(request, crop, []), /data-layout="editorial"/);
});
