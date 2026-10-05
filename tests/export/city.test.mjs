import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import Module from 'manifold-3d';
import { compactCityMap } from '../city-fixture.mjs';

const compiled = await build({
  stdin: { contents: `export * from './shared/city/geometry'; export * from './shared/types/city';
    export * from './shared/utils/crop-region'; export * from './shared/utils/map-mm-projection';
    export * from './shared/utils/mesh-manifold'; export * from './shared/utils/binary-stl';
    export * from './shared/utils/gpx-parser'; export * from './electron/main/gpx/gpx-session-cache';
    export * from './electron/main/gpx/hydrate-gpx-config';`, resolveDir: resolve('.') },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const api = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);
let wasm;
before(async () => { wasm = await Module(); wasm.setup(); });
function request(shape = 'rectangle', real = false, bearing = 0) {
  const config = api.createDefaultCityConfig();
  Object.assign(config.mapCrop, { shape, lengthMm: 100, widthMm: 80, radiusMm: 50, polygonSideLengthMm: 40, polygonSides: 6, mapCenterLat: 40.18, mapCenterLon: 44.51, mapZoom: 16, mapBearingDeg: bearing });
  config.city.surface = real ? 'real' : 'flat';
  config.terrain.openTopographyApiKey = 'test';
  const req = { config, viewportWidth: 800, viewportHeight: 600 };
  const crop = api.computeTerrainCropRegion(config.mapCrop, 800, 600);
  const geo = ([x, y]) => api.modelMmToLatLon(x, y, config.mapCrop, crop, 800, 600);
  const segments = [ [[-35,-20],[25,20],[-25,20],[35,-20]], [[-20,-10],[-10,-10],[-10,0],[-20,0],[-20,-10]], [[60,25],[20,25],[60,30],[20,30]] ];
  config.gpx = { imported: true, importId: 'fixture', segments: segments.map(s => s.map(geo)), points: segments.flat().map(geo), rawPoints: segments.flat().map(geo), bounds: null, pointCount: segments.flat().length, distanceKm: 1 };
  const elements = []; let id = 1;
  const way = (ring, tags = {}) => {
    const nodes = ring.map((point) => { const { lat, lon } = geo(point); const node = { type: 'node', id: id++, lat, lon }; elements.push(node); return node.id; });
    if (ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) nodes[nodes.length - 1] = nodes[0];
    const feature = { type: 'way', id: id++, nodes, tags }; elements.push(feature); return feature.id;
  };
  const outer = way([[-5,-5],[10,-5],[10,12],[-5,12],[-5,-5]]);
  const inner = way([[0,0],[5,0],[5,6],[0,6],[0,0]]);
  elements.push({ type: 'relation', id: id++, tags: { type: 'multipolygon', building: 'yes', height: '20' }, members: [{ type: 'way', ref: outer, role: 'outer' }, { type: 'way', ref: inner, role: 'inner' }] });
  way([[12,-10],[22,-10],[22,0],[12,0],[12,-10]], { building: 'yes', height: '80' });
  way([[12,-10],[22,-10],[22,0],[12,0],[12,-10]], { 'building:part': 'yes', height: '10' });
  way([[40,0],[65,0],[65,10],[40,10],[40,0]], { building: 'yes', 'building:levels': '4' });
  way([[-60,-25],[60,-25]], { highway: 'footway' });
  way([[-40,15],[40,15]], { highway: 'residential' });
  way([[-40,13],[40,13]], { highway: 'residential', bridge: 'yes' });
  const cols = real ? 24 : 2, rows = real ? 20 : 2;
  const heights = Float64Array.from({ length: cols * rows }, (_, i) => real ? (i % cols) / cols * 5 + Math.floor(i / cols) / rows * 2 : 0);
  return { req, crop, data: compactCityMap({ elements }), originalData: { elements }, heights, cols, rows };
}
function generate(fixture) { return api.buildCityGeometry(wasm, fixture.req, fixture.crop, fixture.data, fixture.heights, fixture.cols, fixture.rows); }
for (const real of [false, true]) test(`cached ${real ? 'Real' : 'Flat'} city matches fresh geometry through trail edits and restores narrowed grooves`, () => {
  const f = request('circle', real, 37), builder = api.createCityGeometryBuilder(wasm);
  const stages = [];
  const build = () => builder.build(f.req, f.crop, f.data, f.heights, f.cols, f.rows, (stage) => stages.push(stage));
  try {
    const initial = build();
    for (const [field, value] of [['routeWidthMm', 3], ['routeClearanceMm', 0.3], ['routeSeatDepthMm', 1], ['routeReliefMm', 1.4]]) {
      f.req.config.city[field] = value;
      assert.deepEqual(build(), generate(f));
    }
    Object.assign(f.req.config.city, { routeWidthMm: 1.2, routeClearanceMm: 0.15, routeSeatDepthMm: 0.6, routeReliefMm: 0.8 });
    assert.deepEqual(build(), initial, 'narrowing restores buildings and roads cut by the wider groove');
    f.req.config.gpx.segments = f.req.config.gpx.segments.slice(0, 1);
    assert.deepEqual(build(), generate(f), 'changed route keeps the city and updates segment counts');
    assert.equal(stages.filter((s) => s === 'city').length, 1);
    assert.equal(stages.filter((s) => s === 'trail').length, 7);
  } finally { builder.dispose(); }
});
test('cached city invalidates on changed geometry inputs and releases retained native solids', () => {
  const live = new Set();
  const track = (value) => {
    if (!value || !(value instanceof wasm.Manifold || value instanceof wasm.CrossSection) || live.has(value)) return value;
    live.add(value);
    const destroy = value.delete;
    value.delete = () => { assert.ok(live.delete(value), 'native wrapper deleted once'); destroy.call(value); };
    for (const method of ['extrude', 'translate', 'simplify', 'intersect', 'subtract']) {
      if (typeof value[method] !== 'function') continue;
      const original = value[method];
      value[method] = (...args) => track(original.apply(value, args));
    }
    return value;
  };
  const trackedClass = (Native) => new Proxy(Native, {
    construct(target, args) { return track(Reflect.construct(target, args)); },
    get(target, name) {
      const value = Reflect.get(target, name);
      return ['circle', 'union'].includes(name) ? (...args) => track(value.apply(target, args)) : value;
    },
  });
  const runtime = { ...wasm, Manifold: trackedClass(wasm.Manifold), CrossSection: trackedClass(wasm.CrossSection) };
  const f = request('rectangle', true), builder = api.createCityGeometryBuilder(runtime);
  let prepared = 0;
  const build = () => builder.build(f.req, f.crop, f.data, f.heights, f.cols, f.rows, (stage) => { if (stage === 'city') prepared++; });
  try {
    build(); assert.equal(live.size, 3);
    const first = new Set(live);
    f.req.config.city.routeWidthMm = 2; build(); assert.deepEqual(live, first);
    const route = f.req.config.gpx.segments;
    f.req.config.gpx.segments = [[{lat:0,lon:0},{lat:0.001,lon:0}]];
    assert.throws(build, /outside the crop/); assert.deepEqual(live, first);
    f.req.config.gpx.segments = route; assert.deepEqual(build(), generate(f));
    assert.equal(prepared, 1, 'route failure preserves the reusable city');
    for (const change of [
      () => { f.req.config.city.buildingHeightExaggeration = 2; },
      () => { f.req.config.city.roadReliefMm = 0.8; },
      () => { f.req.config.terrain.baseSolidThicknessMm = 4; },
      () => { f.data = structuredClone(f.data); },
      () => { f.heights = Float64Array.from(f.heights, (h) => h * 2); },
      () => { f.req.config.mapCrop.mapCenterLat += 0.0001; },
      () => { f.req.config.city.buildingsVisible = false; },
    ]) {
      const previous = new Set(live);
      change(); assert.deepEqual(build(), generate(f));
      assert.equal(live.size, 3); assert.ok([...previous].every((value) => !live.has(value)), 'old solids released on invalidation');
    }
    assert.equal(prepared, 8);
    f.data = { elements: [{ type:'way', id:1, tags:{highway:'footway'}, geometry:[{lat:NaN,lon:0},{lat:0,lon:0}] }] };
    assert.throws(build, /invalid geometry/); assert.equal(live.size, 0, 'failed preparation releases all solids');
  } finally { builder.dispose(); builder.dispose(); }
  assert.equal(live.size, 0);
});
function solid(mesh) { return new wasm.Manifold(new wasm.Mesh({ numProp: 3, vertProperties: Float32Array.from(mesh.positions), triVerts: Uint32Array.from(mesh.indices) })); }
function assertClosed(mesh) {
  assert.ok(mesh.positions.every(Number.isFinite));
  const analysis = api.analyzeMesh(mesh);
  assert.equal(analysis.boundaryEdges, 0, JSON.stringify(analysis));
  assert.equal(analysis.nonManifoldEdges, 0);
  const s = solid(mesh); assert.equal(s.status(), 'NoError'); assert.ok(s.volume() > 0); s.delete();
  const stl = api.encodeBinaryStl(mesh);
  const view = new DataView(stl.buffer);
  assert.equal(stl.length, 84 + view.getUint32(80, true) * 50);
  const decodedPositions=[], decodedIndices=[], vertices=new Map();
  for(let t=0;t<view.getUint32(80,true);t++) for(let v=0;v<3;v++) {
    const offset=84+t*50+12+v*12;
    const point=[view.getFloat32(offset,true),view.getFloat32(offset+4,true),view.getFloat32(offset+8,true)];
    const key=point.join(',');
    if(!vertices.has(key)){vertices.set(key,decodedPositions.length/3);decodedPositions.push(...point);}
    decodedIndices.push(vertices.get(key));
  }
  const roundTrip=solid({...mesh,positions:decodedPositions,indices:decodedIndices});
  assert.equal(roundTrip.status(),'NoError','STL round trip retains a closed solid');
  const original=solid(mesh);
  assert.ok(Math.abs(roundTrip.volume()-original.volume())<0.001);
  original.delete();roundTrip.delete();
  for (let i = 0; i < mesh.indices.length; i++) for (let c = 0; c < 3; c++) {
    const triangle = Math.floor(i / 3), vertex = i % 3;
    assert.equal(view.getFloat32(84 + triangle * 50 + 12 + vertex * 12 + c * 4, true), Math.fround(mesh.positions[mesh.indices[i] * 3 + c]));
  }
}
for (const [shape, rounded] of [['circle', false], ['rectangle', false], ['rectangle', true], ['polygon', false], ['polygon', true]]) {
  for (const real of [false, true]) test(`${shape}${rounded ? ' rounded' : ''}, rotated, ${real ? 'Real terrain' : 'Flat'} produces closed aligned STL parts`, () => {
    const f = request(shape, real, 37);
    if (rounded) { f.req.config.mapCrop.cornerRadiusMm = 5; f.crop = api.computeTerrainCropRegion(f.req.config.mapCrop, 800, 600); }
    const model = generate(f);
    assertClosed(model.cityMesh); assertClosed(model.routeMesh);
    assert.equal(model.featureCounts.buildings, shape === 'polygon' ? 2 : 3); assert.equal(model.featureCounts.roads, 2);
    assert.equal(model.featureCounts.routeSegments, 3);
    const city = solid(model.cityMesh), route = solid(model.routeMesh), collision = city.intersect(route);
    // Float32 STL remeshing of coincident crop walls can produce microscopic CSG slivers.
    assert.ok(Math.abs(collision.volume()) < Math.max(1e-3, route.volume() * 1e-4), `route collision ${collision.volume()}`);
    collision.delete(); route.delete(); city.delete();
  });
}
test('courtyards stay empty above the base and building parts replace tall parent shells', () => {
  const f = request(); f.req.config.gpx.segments = [[{ ...api.modelMmToLatLon(-40,-30,f.req.config.mapCrop,f.crop,800,600) }, { ...api.modelMmToLatLon(40,-30,f.req.config.mapCrop,f.crop,800,600) }]];
  const model = generate(f), city = solid(model.cityMesh);
  const check = (x, y, z) => { const cube = wasm.Manifold.cube([0.2,0.2,0.2]).translate([x,y,z]); const hit = city.intersect(cube); const v = hit.volume(); hit.delete(); cube.delete(); return v; };
  assert.ok(check(2,3,0.1) < 1e-7, 'courtyard has no building');
  assert.ok(check(-3,3,0.1) > 0, 'outer courtyard wall is present');
  assert.ok(check(17,-5,4) < 1e-7, 'parent shell does not swallow its shorter building part');
  city.delete();
});
test('building heights prefer meters, support feet, then levels, then the documented fallback', () => {
  for (const [tags, height] of [[{ height:'12 m','building:levels':'9' },12],[{ height:'30 ft' },9.144],[{height:'bad','building:levels':'4'},12],[{height:'-1'},8],[{height:'12;14'},8]]) assert.ok(Math.abs(api.buildingHeightM(tags,8).height - height) < 1e-9);
});
test('compact complete geometry preserves the node-format city and courtyard meshes', () => {
  const f=request();const compact=generate(f);const original=generate({...f,data:f.originalData});
  assert.deepEqual(compact.featureCounts,original.featureCounts);
  assert.deepEqual(compact.cityMesh,original.cityMesh);assert.deepEqual(compact.routeMesh,original.routeMesh);
});
test('dense map candidates are filtered by print scale before the solid feature limit', () => {
  const f=request();
  const geometry=[[-49,-39],[-48.9,-39],[-48.9,-38.9],[-49,-38.9],[-49,-39]].map(([x,y])=>api.modelMmToLatLon(x,y,f.req.config.mapCrop,f.crop,800,600));
  f.data.elements.push(...Array.from({length:35_001},(_,id)=>({type:'way',id:id+1000,tags:{building:'yes'},geometry})));
  const result=generate(f);assert.equal(result.featureCounts.buildings,3);assert.ok(result.featureCounts.omitted>=35_001);
  assertClosed(result.cityMesh);assertClosed(result.routeMesh);
});
test('GPX order, segment boundaries, self-closing points and loops are retained', () => {
  const parsed = api.parseGpxXml(`<gpx><trk><trkseg><trkpt lon="1" lat="1"/><trkpt lat="2" lon="2"/><trkpt lon="1" lat="1"/></trkseg><trkseg><trkpt lat="40" lon="40"/><trkpt lat="40.001" lon="40"/></trkseg></trk></gpx>`);
  assert.deepEqual(parsed.segments.map(s => s.length), [3,2]);
  assert.deepEqual(parsed.points.map(p => p.lat), [1,2,1,40,40.001]);
  assert.ok(parsed.distanceKm < 400);
});
test('desktop hydration is scoped by import identity and preserves framing', async () => {
  const first = api.parseGpxXml('<gpx><trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg></trk></gpx>');
  const second = api.parseGpxXml('<gpx><trk><trkseg><trkpt lat="40" lon="40"/><trkpt lat="41" lon="41"/></trkseg></trk></gpx>');
  api.setGpxSessionCache({ ...first, importId:'mountain' }); api.setGpxSessionCache({ ...second, importId:'city' });
  const config = api.createDefaultCityConfig(); config.gpx.imported = true; config.gpx.importId = 'mountain';
  const hydrated = await api.hydrateGpxConfig(config);
  assert.equal(hydrated.gpx.points[0].lat, 1); assert.deepEqual(hydrated.mapCrop, config.mapCrop);
  config.gpx.importId = 'missing'; assert.equal((await api.hydrateGpxConfig(config)).gpx.points.length, 0);
  api.clearGpxSessionCache();
});

test('a representative marathon GPX exports without bridging or dropping laps', async () => {
  const parsed = api.parseGpxXml(await readFile('fixtures/city-marathon.gpx','utf8'));
  assert.ok(Math.abs(parsed.distanceKm - 42.195) < 0.3);
  assert.equal(parsed.segments.length, 1); assert.equal(parsed.points.length, 4001);
  const f = request(); f.req.config.mapCrop.mapZoom = 13;
  f.crop = api.computeTerrainCropRegion(f.req.config.mapCrop,800,600);
  f.req.config.gpx = { ...f.req.config.gpx, ...parsed, rawPoints: parsed.points, imported:true };
  const result = generate(f); assertClosed(result.cityMesh); assertClosed(result.routeMesh);
});

for(const sides of [3,4,5,7,8]) for(const real of [false,true]) test(`${sides}-sided footprint retains its full rotated outline on ${real ? 'Real' : 'Flat'} terrain`,()=>{
  const f=request('polygon',real,123); f.req.config.mapCrop.polygonSides=sides;
  f.crop=api.computeTerrainCropRegion(f.req.config.mapCrop,800,600);
  const outline=api.cityFootprint(f.req,f.crop);
  f.crop.widthMm=Math.max(f.crop.widthMm,...outline.map(([x])=>Math.abs(x)*2));
  f.crop.heightMm=Math.max(f.crop.heightMm,...outline.map(([,y])=>Math.abs(y)*2));
  const model=generate(f);assertClosed(model.cityMesh);assertClosed(model.routeMesh);
  const footprint=new wasm.CrossSection(outline,'EvenOdd');
  const base=solid(model.cityMesh),slice=wasm.Manifold.cube([300,300,0.1]).translate([-150,-150,-2.9]);
  const bottom=base.intersect(slice);
  assert.ok(Math.abs(bottom.volume()/0.1-footprint.area())<0.02,'the entire footprint is supported by the base');
  bottom.delete();slice.delete();base.delete();footprint.delete();
});
