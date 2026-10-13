import osmtogeojson from 'osmtogeojson';
import type { CrossSection, Manifold, ManifoldToplevel, Vec2 } from 'manifold-3d';
import type { CityMapData } from '../types/city';
import type { TerrainCropRegion, TerrainGenerateRequest, TerrainMeshPayload, TrailGrooveSpec } from '../types/terrain';
import { cityProjector } from '../city/geometry';
import { buildFootprintPolygonMm } from '../utils/footprint';
import { waterMeshPayload } from './mesh-payload';

type WaterFeature = {
  geometry?: { type: string; coordinates: number[][][] | number[][][][] };
  properties: { tags?: Record<string, string>; tainted?: boolean };
};
export interface WaterGeometryResult {
  mesh: TerrainMeshPayload;
  waterMeshes: TerrainMeshPayload[];
  waterPinMeshes: TerrainMeshPayload[];
  waterWarnings: string[];
}

function contains(rings: Vec2[][], point: Vec2): boolean {
  let inside = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
        point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Place up to two dowels, leaving material around sockets and between them. */
function pinLocations(section: CrossSection, radius: number): Vec2[] {
  const safe = section.offset(-radius - 0.6, 'Round', 2, 24);
  try {
    if (safe.isEmpty()) return [];
    const { min, max } = safe.bounds(), rings = safe.toPolygons();
    const candidates: Vec2[] = [];
    for (let y = 0; y <= 32; y++) for (let x = 0; x <= 32; x++) {
      const point: Vec2 = [min[0] + (max[0] - min[0]) * x / 32, min[1] + (max[1] - min[1]) * y / 32];
      if (contains(rings, point)) candidates.push(point);
    }
    if (!candidates.length) return [];
    const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const farthest = (point: Vec2) => candidates.reduce((best, p) => distance(p, point) > distance(best, point) ? p : best);
    const a = farthest(candidates[0]!), b = farthest(a);
    return distance(a, b) >= radius * 2 + 0.6 ? [a, b] : [a];
  } finally { safe.delete(); }
}

/**
 * Split the existing terrain solid along mapped water outlines. Each insert
 * retains the exact DEM top and gets a flat seat with matching dowel sockets.
 * The original trail corridor stays in the terrain, clear of all water parts.
 */
export function buildWaterGeometry(
  wasm: ManifoldToplevel,
  request: TerrainGenerateRequest,
  crop: TerrainCropRegion,
  data: CityMapData,
  terrain: TerrainMeshPayload,
  trail: Array<{ x: number; y: number }>,
  groove?: TrailGrooveSpec,
): WaterGeometryResult {
  const settings = request.config.water;
  const result: WaterGeometryResult = { mesh: terrain, waterMeshes: [], waterPinMeshes: [], waterWarnings: [] };
  const allocations = new Set<CrossSection | Manifold>();
  const own = <T extends CrossSection | Manifold>(value: T): T => { allocations.add(value); return value; };
  const drop = (value: CrossSection | Manifold) => { if (allocations.delete(value)) value.delete(); };
  const { CrossSection: CS, Manifold: Solid, Mesh } = wasm;
  const project = cityProjector(request, crop);
  const extrude = (section: CrossSection, bottom: number, top: number) => {
    const raw = own(section.extrude(top - bottom));
    const positioned = own(raw.translate([0, 0, bottom])); drop(raw); return positioned;
  };
  const payload = (solid: Manifold, bottomZ: number): TerrainMeshPayload => {
    if (solid.status() !== 'NoError' || solid.isEmpty() || solid.volume() <= 0) {
      throw new Error('Could not build a closed water assembly. Try a lower mesh quality or a larger water area.');
    }
    return waterMeshPayload(solid, terrain, bottomZ);
  };
  let omitted = 0;
  try {
    const vertices = buildFootprintPolygonMm(crop);
    const outerFootprint = vertices
      ? own(new CS([vertices.map((v): Vec2 => [v.x, v.y])], 'EvenOdd'))
      : own(CS.circle(crop.radiusMm!, Math.max(64, terrain.gridCols)));
    // Retain a protective terrain wall around the crop. Besides supporting the
    // inserts, this avoids coincident Boolean edges on the outside of the model.
    const footprint = own(outerFootprint.offset(-0.6, 'Round', 2, 24));
    const geojson = osmtogeojson(data as Parameters<typeof osmtogeojson>[0], { flatProperties: false }) as unknown as { features: WaterFeature[] };
    const sections: CrossSection[] = [];
    for (const feature of geojson.features) {
      const tags = feature.properties.tags ?? {};
      if (tags.natural !== 'water' && tags.waterway !== 'riverbank' && tags.landuse !== 'reservoir') continue;
      const geometry = feature.geometry;
      if (feature.properties.tainted || !geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) { omitted++; continue; }
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates as number[][][]] : geometry.coordinates as number[][][][];
      for (const polygon of polygons) {
        const rings = polygon.map((ring) => ring.map(([lon, lat]): Vec2 => {
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error('The water map contains invalid coordinates.');
          return project(lon!, lat!);
        }));
        const raw = own(new CS(rings, 'EvenOdd'));
        const clipped = own(raw.intersect(footprint)); drop(raw);
        const simplified = own(clipped.simplify(0.02)); drop(clipped);
        sections.push(simplified);
      }
    }
    if (!sections.length) {
      result.waterWarnings.push('No mapped inland water areas were found in this crop. Lakes, reservoirs and river polygons are supported; coastlines and river centerlines are not included.');
      if (omitted) result.waterWarnings.push(`${omitted} incomplete water features were omitted.`);
      return result;
    }
    let combined = own(CS.union(sections)); sections.forEach(drop);
    let trailCorridor: CrossSection | undefined;
    // Reserve the entire trail groove, including fitting clearance. Its support
    // remains in Terrain_Main even where a trail crosses a lake or river.
    if (trail.length >= 2) {
      const radius = request.config.trail.trailWidthMm / 2 + request.config.assembly.trailToleranceMm + 0.05;
      const strokes: CrossSection[] = [];
      const circle = own(CS.circle(radius, 16));
      for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1]!, b = trail[i]!, length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length < 1e-8) continue;
        const nx = (b.y - a.y) / length * radius, ny = -(b.x - a.x) / length * radius;
        strokes.push(own(new CS([[[a.x + nx, a.y + ny], [b.x + nx, b.y + ny], [b.x - nx, b.y - ny], [a.x - nx, a.y - ny]]], 'EvenOdd')),
          own(circle.translate([a.x, a.y])), own(circle.translate([b.x, b.y])));
      }
      const corridor = own(CS.union(strokes)); strokes.forEach(drop); drop(circle);
      const reserved = own(combined.subtract(corridor)); drop(combined); combined = reserved;
      trailCorridor = corridor;
    }
    const sourceMesh = new Mesh({ numProp: 3, vertProperties: new Float32Array(terrain.positions), triVerts: new Uint32Array(terrain.indices) });
    sourceMesh.merge();
    const source = own(new Solid(sourceMesh));
    if (source.status() !== 'NoError') throw new Error('Terrain could not be prepared for water pockets. Choose a lower mesh quality.');
    let main = source;
    const maxZ = source.boundingBox().max[2] + 1;
    const socketRadius = settings.pinDiameterMm / 2 + settings.clearanceMm;
    for (const section of combined.decompose()) {
      own(section);
      const inset = own(section.offset(-settings.clearanceMm, 'Round', 2, 24));
      // Insetting can split a narrow isthmus; each piece gets its own pins and STL.
      const pieces = inset.decompose().map(own);
      const pinGroups = pieces.map((part) => pinLocations(part, socketRadius));
      if (!pieces.length || pinGroups.some((pins) => !pins.length)) { omitted++; drop(inset); drop(section); pieces.forEach(drop); continue; }
      const fullPrism = extrude(section, terrain.bottomZ, maxZ);
      const fullWater = own(source.intersect(fullPrism)); drop(fullPrism);
      if (fullWater.isEmpty()) { omitted++; drop(fullWater); drop(inset); drop(section); pieces.forEach(drop); continue; }
      const waterMesh = fullWater.getMesh();
      let minSurface = Infinity;
      for (let i = 2; i < waterMesh.vertProperties.length; i += waterMesh.numProp) {
        const z = waterMesh.vertProperties[i]!;
        if (z > terrain.bottomZ + 1e-4) minSurface = Math.min(minSurface, z);
      }
      const floor = minSurface - settings.thicknessMm;
      if (!Number.isFinite(floor) || floor - settings.pinDepthMm < terrain.bottomZ + 0.4 - 1e-4) {
        throw new Error('A water pocket would leave too little material beneath its pins. Increase terrain base thickness or reduce water thickness/socket depth.');
      }
      const pocket = extrude(section, floor, maxZ);
      const cutMain = own(main.subtract(pocket)); if (main !== source) drop(main); main = cutMain; drop(pocket);
      for (let p = 0; p < pieces.length; p++) {
        const part = pieces[p]!;
        const prism = extrude(part, floor, maxZ);
        let insert = own(source.intersect(prism)); drop(prism);
        for (const [x, y] of pinGroups[p]!) {
          const socketCircle = own(CS.circle(socketRadius, 32));
          const socketSection = own(socketCircle.translate([x, y])); drop(socketCircle);
          // Extra 0.01 mm at the interface removes coplanar boolean faces.
          const lowerSocket = extrude(socketSection, floor - settings.pinDepthMm, floor + 0.01);
          const upperSocket = extrude(socketSection, floor - 0.01, floor + settings.pinDepthMm);
          const nextMain = own(main.subtract(lowerSocket)); drop(main); main = nextMain;
          const nextInsert = own(insert.subtract(upperSocket)); drop(insert); insert = nextInsert;
          const pinCircle = own(CS.circle(settings.pinDiameterMm / 2, 32));
          const pinSection = own(pinCircle.translate([x, y]));
          const pin = extrude(pinSection, floor - settings.pinDepthMm + 0.05, floor + settings.pinDepthMm - 0.05);
          result.waterPinMeshes.push(payload(pin, floor - settings.pinDepthMm + 0.05));
          drop(pin); drop(pinSection); drop(pinCircle); drop(lowerSocket); drop(upperSocket); drop(socketSection);
        }
        result.waterMeshes.push(payload(insert, floor)); drop(insert); drop(part);
      }
      drop(fullWater); drop(inset); drop(section);
      if (result.waterMeshes.length > 200) throw new Error('Too many water inserts. Select a smaller area.');
    }
    if (result.waterMeshes.length) {
      if (groove && trailCorridor) {
        const grooveSection = own(trailCorridor.offset(-0.05, 'Round', 2, 16));
        const cutter = extrude(grooveSection, groove.floorZMm ?? -groove.depthMm, maxZ);
        const grooved = own(main.subtract(cutter)); if (main !== source) drop(main); main = grooved;
        drop(cutter); drop(grooveSection);
      }
      result.mesh = payload(main, terrain.bottomZ);
    }
    else result.waterWarnings.push('No water areas are large enough for alignment pins at this print scale. Increase the print size or reduce the pin diameter.');
    if (omitted) result.waterWarnings.push(`${omitted} incomplete or small water areas were omitted because they cannot hold alignment sockets.`);
    return result;
  } finally { for (const value of allocations) value.delete(); }
}
