import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const compiled = await build({
  stdin: { contents: `export { createDefaultConfig } from './shared/types/config';
    export { computeTerrainCropRegion } from './shared/utils/crop-region';
    export { modelMmToLatLon, heightfieldSampleGeo } from './shared/utils/map-mm-projection';
    export { parseMapCoordinates } from './src/utils/place-search';`, resolveDir: resolve('.') },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { createDefaultConfig, computeTerrainCropRegion, modelMmToLatLon, heightfieldSampleGeo, parseMapCoordinates } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`,
);

test('clockwise shape rotation turns the generated sampling frame around the selected place, independent of the camera', () => {
  const config = createDefaultConfig();
  const map = config.mapCrop;
  map.shape = 'rectangle';
  map.selection = { mapCenterLat: 40.523, mapCenterLon: 44.194, mapZoom: 15, mapBearingDeg: 0, viewportWidth: 800, viewportHeight: 600 };
  const crop = computeTerrainCropRegion(map, 800, 600);
  const east = modelMmToLatLon(30, 0, map, crop, 800, 600);
  const center = modelMmToLatLon(0, 0, map, crop, 800, 600);
  assert.ok(east.lon > center.lon);
  assert.ok(Math.abs(east.lat - center.lat) < 1e-6);
  // The UI's +90° clockwise shape rotation uses the inverse reference bearing.
  map.selection.mapBearingDeg = 270;
  const rotatedCrop = computeTerrainCropRegion(map, 800, 600);
  const south = modelMmToLatLon(30, 0, map, rotatedCrop, 800, 600);
  assert.ok(south.lat < center.lat);
  assert.ok(Math.abs(south.lon - center.lon) < 1e-5);
  const rotatedGrid = heightfieldSampleGeo(rotatedCrop, 5, 5, map, 800, 600);
  Object.assign(map, { mapCenterLat: -33.8688, mapCenterLon: 151.2093, mapZoom: 8, mapBearingDeg: 45 });
  const navigatedCrop = computeTerrainCropRegion(map, 390, 700);
  assert.deepEqual(navigatedCrop, rotatedCrop);
  assert.deepEqual(heightfieldSampleGeo(navigatedCrop, 5, 5, map, 390, 700), rotatedGrid);
  assert.equal(config.gpx.imported, false);
});

test('coordinate input accepts precise decimal positions and rejects positions outside the supported map', () => {
  for (const query of ['40.1872, 44.5152', '40.1872 44.5152', '40.1872;44.5152']) {
    assert.deepEqual(parseMapCoordinates(query), { lat: 40.1872, lon: 44.5152, label: '40.1872, 44.5152' });
  }
  assert.equal(parseMapCoordinates('-33.8688, +151.2093').lat, -33.8688);
  assert.deepEqual(parseMapCoordinates('0, 0'), { lat: 0, lon: 0, label: '0, 0' });
  for (const query of ['90, 44', '-90, 44', '40, 181', '40, -181']) assert.throws(() => parseMapCoordinates(query));
  for (const query of ['', 'Mount Aragats', '12 Baker Street', '40,', 'NaN, 10']) assert.equal(parseMapCoordinates(query), null);
});
