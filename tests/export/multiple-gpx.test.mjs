import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const compiled = await build({
  stdin: { contents: `export * from './shared/utils/gpx-collection'; export * from './shared/utils/gpx-parser';
    export * from './shared/types/config'; export * from './shared/utils/trail-resolve';
    export * from './electron/main/gpx/hydrate-gpx-config'; export * from './electron/main/gpx/gpx-session-cache';`, resolveDir: resolve('.') },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const api = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);
function file(name, lat) {
  return { ...api.parseGpxXml(`<gpx><trk><name>${name}</name>
    <trkseg><trkpt lat="${lat}" lon="44.5"/><trkpt lat="${lat}" lon="44.501"/></trkseg>
    <trkseg><trkpt lat="${lat}" lon="44.503"/><trkpt lat="${lat}" lon="44.504"/></trkseg>
    </trk></gpx>`), fileName: `${name}.gpx`, importId: name };
}

test('combined bounds and distance include every file without bridging gaps', () => {
  const files = [file('north', 40.2), file('south', 40.1)];
  const gpx = api.combineGpxFiles(files);
  assert.deepEqual(gpx.bounds, { minLat: 40.1, maxLat: 40.2, minLon: 44.5, maxLon: 44.504 });
  assert.equal(gpx.pointCount, 8);
  assert.equal(gpx.distanceKm, files[0].distanceKm + files[1].distanceKm);
  assert.equal(gpx.filePath, undefined);
  assert.equal(gpx.fileName, undefined);
  for (const simplify of [false, true]) {
    const config = api.createDefaultConfig(); config.gpx = gpx; config.trail.gpxSimplify = simplify;
    assert.deepEqual(api.resolveTrailSegments(config), files.flatMap(file => file.segments));
  }
  const remaining = api.combineGpxFiles(gpx.files.filter(file => file.importId !== 'north'));
  assert.equal(remaining.trackName, 'south');
  assert.equal(remaining.fileName, 'south.gpx');
  assert.deepEqual(remaining.bounds, files[1].bounds);
  assert.equal(remaining.distanceKm, files[1].distanceKm);
  assert.equal(api.combineGpxFiles([]).imported, false);
});

test('legacy single-file imports survive adding another file and collections have a total point limit', () => {
  const single = api.combineGpxFiles([file('one', 40.1)]); delete single.files;
  const combined = api.combineGpxFiles([...api.gpxFiles(single), file('two', 40.2)]);
  assert.equal(combined.files.length, 2);
  assert.equal(combined.segments.length, 4);
  assert.throws(() => api.combineGpxFiles([{ ...file('large', 40.1), pointCount: 100_000 }, file('extra', 40.2)]), /100,000/);
});

test('desktop restores every file from its own cache and refuses partial restoration', async () => {
  const files = [file('north', 40.2), file('south', 40.1)];
  files.forEach(api.setGpxSessionCache);
  const config = api.createDefaultConfig(); config.gpx = api.combineGpxFiles(files);
  const expected = structuredClone(config.gpx.segments);
  config.gpx.points = []; config.gpx.rawPoints = []; config.gpx.segments = [];
  config.gpx.files = files.map(file => ({ ...file, points: [], segments: [] }));
  const hydrated = await api.hydrateGpxConfig(config);
  assert.deepEqual(hydrated.gpx.segments, expected);
  assert.equal(hydrated.gpx.pointCount, 8);
  api.clearGpxSessionCache(); api.setGpxSessionCache(files[0]);
  await assert.rejects(api.hydrateGpxConfig(config), /south.gpx/);
});
