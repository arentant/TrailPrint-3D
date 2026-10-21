import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const compiled = await build({
  stdin: { contents: `export * from './shared/city/picture-map'; export * from './shared/city/picture-png'; export * from './shared/city/printable-map';
    export * from './shared/utils/crop-region'; export * from './shared/utils/leaflet-projection';
    export * from './shared/city/geometry'; export * from './shared/types/city';
    export * from './shared/city/selection-crop';
    export * from './shared/utils/gpx-parser'; export * from './shared/city/picture-details';`, resolveDir: resolve('.') },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const api = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);
// Minimal PNG header: image validation checks IHDR dimensions without decoding pixels.
function imageFor(request, dpi) {
  const plan = api.cityPictureMapPlan(request, dpi);
  const header = Buffer.alloc(33);
  header.writeUInt32BE(0x89504e47, 0); header.writeUInt32BE(0x0d0a1a0a, 4);
  header.writeUInt32BE(13, 8); header.write('IHDR', 12);
  header.writeUInt32BE(plan.pixelWidth, 16); header.writeUInt32BE(plan.pixelHeight, 20);
  return { ...plan, dataUrl: 'data:image/png;base64,' + header.toString('base64') };
}
function request() {
  const config = api.createDefaultCityConfig();
  Object.assign(config.mapCrop, { shape: 'rectangle', lengthMm: 180, widthMm: 180, mapCenterLat: 40.18, mapCenterLon: 44.51, mapZoom: 18 });
  return { config, viewportWidth: 800, viewportHeight: 600 };
}

test('small city selections retain 600 DPI independently of geographic zoom', () => {
  const req = request();
  for (const zoom of [12, 17, 18, 19, 22]) {
    req.config.mapCrop.mapZoom = zoom;
    const plan = api.cityPictureMapPlan(req);
    assert.ok(plan.pixelWidth >= Math.ceil(180 / 25.4 * 600));
    assert.ok(plan.pixelHeight >= Math.ceil(180 / 25.4 * 600));
    const preview = api.cityPictureMapPlan(req, 120);
    assert.equal(plan.zoom, preview.zoom, 'export DPI does not change map detail or label sizing');
    assert.deepEqual(plan.bounds, preview.bounds);
    assert.equal(plan.pixelRatio / preview.pixelRatio, 5);
  }
});

test('large rotated maps stay within the image budget', () => {
  const req = request();
  Object.assign(req.config.mapCrop, { lengthMm: 500, widthMm: 500, mapBearingDeg: 45 });
  const plan = api.cityPictureMapPlan(req);
  assert.ok(plan.pixelWidth <= api.MAX_PICTURE_PIXELS && plan.pixelHeight <= api.MAX_PICTURE_PIXELS);
  assert.ok(plan.pixelWidth > 8000);
});

test('small prints provide native 4K detail and PNG dimensions preserve every poster aspect ratio', () => {
  const req = request();
  Object.assign(req.config.mapCrop, { lengthMm: 60, widthMm: 40 });
  const background = api.cityPictureMapPlan(req);
  assert.ok(background.pixelWidth >= 4096, 'a 4K download must not upscale a small 600 DPI basemap');
  assert.ok(background.pixelHeight >= 4096 * 40 / 60);
  for (const shape of ['circle', 'rectangle', 'polygon']) {
    req.config.mapCrop.shape = shape;
    for (const layout of ['cards', 'minimal', 'editorial']) {
      Object.assign(req.config.picture, { layout, athlete: 'Runner' });
      const png = api.cityPicturePngPlan(req);
      const page = api.cityPictureLayout(api.citySelectionCrop(req), req.config.picture);
      assert.equal(Math.max(png.pixelWidth, png.pixelHeight), 4096);
      assert.ok(Math.abs(png.pixelWidth / png.pixelHeight - page.width / page.height) < .001);
    }
  }
});

test('4K PNG validation rejects missing, incorrectly sized and malformed companion images', () => {
  const req = request();
  const plan = api.cityPicturePngPlan(req);
  const header = Buffer.from(imageFor(req).dataUrl.slice(22), 'base64');
  header.writeUInt32BE(plan.pixelWidth, 16); header.writeUInt32BE(plan.pixelHeight, 20);
  const png = { ...plan, dataUrl: 'data:image/png;base64,' + header.toString('base64') };
  assert.deepEqual(api.cityPicturePngBytes(png, req), new Uint8Array(header));
  for (const value of [undefined, { ...png, pixelWidth: 1024 }, imageFor(req, 120)]) {
    assert.throws(() => api.cityPicturePngBytes(value, req), /4K PNG/);
  }
  assert.throws(() => api.cityPicturePngBytes({ ...png, dataUrl: 'https://example.com/map.png' }, req), /Invalid printable/);
  assert.throws(() => api.cityPicturePngBytes({ ...png, dataUrl: imageFor(req, 120).dataUrl }, req), /print resolution/);
});

test('export rejects missing, stale, preview-resolution and malformed map images', () => {
  const req = request(), map = imageFor(req);
  api.validateCityPictureMap(map, req);
  for (const value of [undefined, imageFor(req, 120), { ...map, pixelWidth: 1 }, { ...map, bounds: { ...map.bounds, minLon: 0 } }]) {
    assert.throws(() => api.validateCityPictureMap(value, req), /missing or out of date/);
  }
  assert.throws(() => api.validateCityPictureMap({ ...map, dataUrl: 'https://example.com/image.png' }, req), /Invalid printable/);
  assert.throws(() => api.validateCityPictureMap({ ...map, dataUrl: 'data:image/png;base64,aGVsbG8=' }, req), /print resolution/);
  req.config.mapCrop.mapCenterLon += .01;
  assert.throws(() => api.validateCityPictureMap(map, req), /out of date/);
});

test('rendered image pixels and GPX share the rotated millimeter projection for every footprint', () => {
  const req = request();
  Object.assign(req.config.mapCrop, { mapBearingDeg: 37, mapPaneX: 61, mapPaneY: -19 });
  for (const shape of ['circle', 'rectangle', 'polygon']) {
    req.config.mapCrop.shape = shape; req.config.mapCrop.polygonSides = 5;
    const map = imageFor(req), crop = api.citySelectionCrop(req);
    const svg = api.renderPrintableCityMap(req, crop, map);
    const [a, b, c, d, e, f] = /<image[^>]*matrix\(([^)]+)\)/.exec(svg)[1].split(' ').map(Number);
    const tl = api.latLngToCrsPoint(map.bounds.maxLat, map.bounds.minLon, 0);
    const br = api.latLngToCrsPoint(map.bounds.minLat, map.bounds.maxLon, 0);
    for (const [u, v] of [[0, 0], [.23, .67], [1, 1]]) {
      const geo = api.crsPointToLatLng(tl.x + u * (br.x - tl.x), tl.y + v * (br.y - tl.y), 0);
      const [x, y] = api.cityProject(req, crop, geo.lon, geo.lat);
      assert.ok(Math.abs(x - (a * u * map.pixelWidth + c * v * map.pixelHeight + e)) < 1e-6);
      assert.ok(Math.abs(y - (b * u * map.pixelWidth + d * v * map.pixelHeight + f)) < 1e-6);
    }
    assert.match(svg, /clip-path="url\(#city-footprint\)"/);
    assert.doesNotMatch(svg, /href="https?:/);
  }
});

test('map-only exports preserve physical size and include visible print attribution', () => {
  const req = request(); req.config.picture.enabled = false;
  req.config.gpx.trackName = '<script>Unwanted GPX title</script>';
  const svg = api.renderPrintableCityMap(req, api.citySelectionCrop(req), imageFor(req));
  assert.match(svg, /width="180mm" height="180mm" viewBox="0 0 180 180"/);
  assert.match(svg, /id="map-attribution"/);
  assert.match(svg, /<text[^>]*>© OpenMapTiles · © OpenStreetMap contributors<\/text>/);
  assert.match(svg, /openstreetmap.org\/copyright/);
  assert.doesNotMatch(svg, /Unwanted GPX title|Esri/);
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
  const svg = api.renderPrintableCityMap(request, crop);
  assert.match(svg, /id="poster-details"/); assert.match(svg, /BERLIN MARATHON/);
  assert.match(svg, /Narek &lt;script&gt;&amp; Margaryan/); assert.doesNotMatch(svg, /<script/);
  for (const text of ['24 SEP 2023', '42.20 km', '3:55:41', '5:31 /km']) assert.ok(svg.includes(text));
  assert.match(svg, /fill="#192b28"/);
  assert.match(svg, /width="135.6mm" height="176.4mm"/);
  assert.match(svg, /translate\(67.8 82.8\) scale\(1 -1\)/, 'the map is translated, never scaled down');
  Object.assign(config.picture, { athlete: '', date: '', distance: '', duration: '', pace: '' });
  const empty = api.renderPrintableCityMap(request, crop);
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
    const bare = api.renderPrintableCityMap(request, crop);
    const route = /<g id="running-route"[\s\S]*?<\/g>/.exec(bare)[0];
    config.picture.enabled = true;
    for (const layout of ['cards', 'minimal']) {
      config.picture.layout = layout;
      const svg = api.renderPrintableCityMap(request, crop);
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
    const svg = api.renderPrintableCityMap(request, crop);
    assert.match(svg, /Narek &amp; Co\./); assert.match(svg, /42.20 km/);
    assert.doesNotMatch(svg, /<script|>ELAPSED<|>PACE<|>DATE<|data-overlay-card="duration"/);
  }
  delete config.picture.layout;
  assert.equal(api.cityPictureLayout(crop, config.picture).width, 135.6);
  assert.match(api.renderPrintableCityMap(request, crop), /data-layout="editorial"/);
});
