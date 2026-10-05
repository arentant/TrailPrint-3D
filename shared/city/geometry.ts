import osmtogeojson from 'osmtogeojson';
import type { CrossSection, Manifold, ManifoldToplevel, Vec2 } from 'manifold-3d';
import type { CityGenerateRequest, CityGenerateResponse, CityMapData } from '../types/city';
import type { TerrainCropRegion, TerrainMeshPayload } from '../types/terrain';
import { maskMmScale } from '../utils/map-mm-projection';
import { latLngToCrsPoint, computePixelOrigin } from '../utils/leaflet-projection';
import { layerPointToContainerPoint } from '../utils/map-rotate-projection';
import { buildFootprintPolygonMm } from '../utils/footprint';
import { buildMaskGeometry } from '../utils/mask-geometry';
import { sampleHeightBilinearMm } from '../utils/heightfield-mesh';

function cityProjector(request: CityGenerateRequest, crop: TerrainCropRegion) {
  const { mapCrop } = request.config;
  const { viewportWidth: w, viewportHeight: h } = request;
  const origin = computePixelOrigin(mapCrop, w, h);
  const scale = maskMmScale(mapCrop, crop, w, h);
  return (lon: number, lat: number): Vec2 => {
    const p = latLngToCrsPoint(lat, lon, mapCrop.mapZoom);
    const screen = layerPointToContainerPoint(p.x - origin.x, p.y - origin.y, mapCrop.mapBearingDeg, w, h);
    return [(screen.x - scale.cx) * scale.scaleX, (scale.cy - screen.y) * scale.scaleY];
  };
}

export function cityProject(request: CityGenerateRequest, crop: TerrainCropRegion, lon: number, lat: number): Vec2 {
  return cityProjector(request, crop)(lon, lat);
}

/** Use the screen mask's orientation, including odd-sided polygons. */
export function cityFootprint(request: CityGenerateRequest, crop: TerrainCropRegion): Vec2[] | null {
  const mask = buildMaskGeometry(request.config.mapCrop, request.viewportWidth, request.viewportHeight);
  if (mask.vertices) {
    const scale = maskMmScale(request.config.mapCrop, crop, request.viewportWidth, request.viewportHeight);
    return mask.vertices.map((v) => [(v.x - scale.cx) * scale.scaleX, (scale.cy - v.y) * scale.scaleY]);
  }
  return buildFootprintPolygonMm(crop)?.map((v) => [v.x, v.y]) ?? null;
}

export function buildingHeightM(tags: Record<string, string>, fallback: number): { height: number; fallback: boolean } {
  const height = /^\s*(\d+(?:\.\d+)?)\s*(m|ft|feet|')?\s*$/i.exec(tags.height ?? '');
  const meters = height ? Number(height[1]) * (/^(ft|feet|')$/i.test(height[2] ?? '') ? 0.3048 : 1) : NaN;
  if (Number.isFinite(meters) && meters > 0 && meters <= 1000) return { height: meters, fallback: false };
  const levels = Number(tags['building:levels']);
  if (Number.isFinite(levels) && levels > 0 && levels <= 250) return { height: levels * 3, fallback: false };
  return { height: fallback, fallback: true };
}

type Feature = { geometry: { type: string; coordinates: any }; properties: { tags?: Record<string, string>; tainted?: boolean }; id?: string };
type Scoped = Manifold | CrossSection;

/** A watertight rectangular solid with a triangulated DEM top and flat bottom. */
function terrainSolidMesh(crop: TerrainCropRegion, heights: Float64Array, cols: number, rows: number, thickness: number): TerrainMeshPayload {
  const positions: number[] = [], indices: number[] = [];
  const n = cols * rows;
  for (const top of [true, false]) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    positions.push((c / (cols - 1) - 0.5) * crop.widthMm, (r / (rows - 1) - 0.5) * crop.heightMm, top ? heights[r * cols + c]! : -thickness);
  }
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
    indices.push(a, b, d, b, e, d, n + a, n + d, n + b, n + b, n + d, n + e);
  }
  const perimeter: number[] = [];
  for (let c = 0; c < cols - 1; c++) perimeter.push(c);
  for (let r = 0; r < rows - 1; r++) perimeter.push(r * cols + cols - 1);
  for (let c = cols - 1; c > 0; c--) perimeter.push((rows - 1) * cols + c);
  for (let r = rows - 1; r > 0; r--) perimeter.push(r * cols);
  for (let i = 0; i < perimeter.length; i++) {
    const a = perimeter[i]!, b = perimeter[(i + 1) % perimeter.length]!;
    indices.push(n + a, n + b, b, n + a, b, a);
  }
  return { positions, indices, minSurfaceZ: 0, bottomZ: -thickness, gridCols: cols, gridRows: rows };
}

type PreparedCity = {
  footprint: CrossSection;
  terrain: Manifold;
  city: Manifold;
  maxSurface: number;
  strokeEdges: number;
  counts: CityGenerateResponse['featureCounts'];
  warnings: string[];
};
type GeometryResult = Omit<CityGenerateResponse, 'generationMs'>;
type GeometryInputs = [request: CityGenerateRequest, crop: TerrainCropRegion, data: CityMapData, heights: Float64Array, cols: number, rows: number];

/** Cold build for callers that do not retain native geometry between requests. */
export function buildCityGeometry(wasm: ManifoldToplevel, ...inputs: GeometryInputs): GeometryResult {
  return buildGeometry(wasm, ...inputs);
}

/** Retains one uncut city. Trail edits always cut a fresh groove into that original solid. */
export function createCityGeometryBuilder(wasm: ManifoldToplevel) {
  let cached: { key: string; data: CityMapData; heights: Float64Array; prepared: PreparedCity } | undefined;
  const dispose = () => {
    if (!cached) return;
    for (const value of new Set([cached.prepared.footprint, cached.prepared.terrain, cached.prepared.city])) value.delete();
    cached = undefined;
  };
  return {
    dispose,
    build(...args: [...GeometryInputs, onStage?: (stage: 'city' | 'trail') => void]): GeometryResult {
      const [request, crop, data, heights, cols, rows, onStage] = args;
      const { routeWidthMm, routeSeatDepthMm, routeReliefMm, routeClearanceMm, ...city } = request.config.city;
      const key = JSON.stringify([crop, request.config.mapCrop, request.viewportWidth, request.viewportHeight,
        request.config.terrain.baseSolidThicknessMm, city, cols, rows]);
      if (cached && (cached.key !== key || cached.data !== data || cached.heights !== heights)) dispose();
      if (!cached) onStage?.('city');
      return buildGeometry(wasm, request, crop, data, heights, cols, rows, cached?.prepared,
        (prepared) => { cached = { key, data, heights, prepared }; }, () => onStage?.('trail'));
    },
  };
}

function buildGeometry(wasm: ManifoldToplevel, request: CityGenerateRequest, crop: TerrainCropRegion, data: CityMapData, heights: Float64Array, cols: number, rows: number,
  prepared?: PreparedCity, retain?: (city: PreparedCity) => void, onTrail?: () => void): GeometryResult {
  const { CrossSection: CS, Manifold: Solid, Mesh } = wasm;
  const allocations = new Set<Scoped>();
  const own = <T extends Scoped>(value: T): T => { allocations.add(value); return value; };
  const drop = (value: Scoped) => { allocations.delete(value); value.delete(); };
  const warnings: string[] = prepared ? [...prepared.warnings] : [];
  const counts = prepared ? { ...prepared.counts } : { buildings: 0, roads: 0, routeSegments: 0, omitted: 0 };
  const settings = request.config.city;
  const baseThickness = request.config.terrain.baseSolidThicknessMm;
  let maxSurface = prepared?.maxSurface ?? 0;
  if (!prepared) for (const h of heights) maxSurface = Math.max(maxSurface, h);
  const project = cityProjector(request, crop);
  const extrusion = (section: CrossSection, bottom: number, top: number) => {
    const raw = own(section.extrude(top - bottom));
    const solid = own(raw.translate([0, 0, bottom])); drop(raw); return solid;
  };
  const contours = (rings: Vec2[][]) => own(new CS(rings, 'EvenOdd'));
  const projectLine = (line: number[][]) => line.map(([lon, lat]) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('The map data contains invalid geometry coordinates.');
    return project(lon, lat);
  });
  let strokeEdges = prepared?.strokeEdges ?? 0;
  // Capsules are unioned in 2D, retaining loops, crossings and separate segments.
  const stroke = (lines: Vec2[][], width: number, clip: CrossSection): CrossSection => {
    const shapes: CrossSection[] = [];
    const radius = width / 2;
    const circle = own(CS.circle(radius, 12));
    for (const line of lines) for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!, b = line[i]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 1e-8) continue;
      if (Math.min(a[0], b[0]) > crop.widthMm / 2 + radius || Math.max(a[0], b[0]) < -crop.widthMm / 2 - radius ||
          Math.min(a[1], b[1]) > crop.heightMm / 2 + radius || Math.max(a[1], b[1]) < -crop.heightMm / 2 - radius) continue;
      if (++strokeEdges > 100_000) throw new Error('Too many printable road or route segments. Select a smaller city area.');
      const nx = (b[1] - a[1]) / length * radius, ny = -(b[0] - a[0]) / length * radius;
      shapes.push(contours([[[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]]));
      shapes.push(own(circle.translate(a)), own(circle.translate(b)));
    }
    drop(circle);
    const combined = own(CS.union(shapes)); shapes.forEach(drop);
    const result = own(combined.intersect(clip)); drop(combined); return result;
  };
  try {
    if (!prepared) {
      const footprintVertices = cityFootprint(request, crop);
      const footprint = footprintVertices ? contours([footprintVertices]) : own(CS.circle(crop.radiusMm!, 256));
      const clipSolid = extrusion(footprint, -baseThickness - 1, maxSurface + 2000);
      let terrain: Manifold;
      if (settings.surface === 'flat') terrain = extrusion(footprint, -baseThickness, 0);
      else {
        const payload = terrainSolidMesh(crop, heights, cols, rows, baseThickness);
        const mesh = new Mesh({ numProp: 3, vertProperties: new Float32Array(payload.positions), triVerts: new Uint32Array(payload.indices) });
        const raw = own(new Solid(mesh));
        if (raw.status() !== 'NoError') throw new Error('Could not build a closed terrain solid. Choose a lower mesh quality.');
        terrain = own(raw.intersect(clipSolid)); drop(raw);
      }
      const geojson = osmtogeojson(data as Parameters<typeof osmtogeojson>[0], { flatProperties: false }) as unknown as { features: Feature[] };
      type Building = { section: CrossSection; height: number; part: boolean };
      const buildings: Building[] = [];
      const roads: Array<{ lines: Vec2[][]; width: number }> = [];
      const scale = maskMmScale(request.config.mapCrop, crop, request.viewportWidth, request.viewportHeight);
      const metersPerPixel = 156543.03392804097 * Math.cos(crop.centerLat * Math.PI / 180) / 2 ** request.config.mapCrop.mapZoom;
      const mmPerMeter = scale.scaleX / metersPerPixel;
      let fallbackCount = 0, unsupported = 0, simplifiedDetails = 0;
      for (const feature of geojson.features) {
        const tags = feature.properties.tags ?? {};
        const g = feature.geometry;
        if (feature.properties.tainted) { counts.omitted++; continue; }
        if (settings.buildingsVisible && ((tags.building && tags.building !== 'no') || (tags['building:part'] && tags['building:part'] !== 'no'))) {
          const polygons: number[][][][] = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
          if (!polygons.length) { counts.omitted++; continue; }
          const pieces: CrossSection[] = [];
          for (const polygon of polygons) {
            const rings = polygon.map(projectLine);
            const section = contours(rings);
            const simplified = own(section.simplify(0.05)); simplifiedDetails += Math.max(0, section.numVert() - simplified.numVert()); drop(section);
            const clipped = own(simplified.intersect(footprint)); drop(simplified);
            pieces.push(clipped);
          }
          const section = own(CS.union(pieces)); pieces.forEach(drop);
          if (section.area() < 0.16) { drop(section); counts.omitted++; continue; }
          const height = buildingHeightM(tags, settings.fallbackBuildingHeightM);
          if (height.fallback) fallbackCount++;
          buildings.push({ section, height: Math.max(0.4, height.height * settings.buildingHeightExaggeration * mmPerMeter), part: !!tags['building:part'] && tags['building:part'] !== 'no' });
          if (buildings.length > 35_000) throw new Error('Too many printable buildings to process. Reduce the model size or select a smaller area.');
        }
        if (settings.roadsVisible && tags.highway && !['proposed', 'construction'].includes(tags.highway)) {
          if (tags.tunnel === 'yes' || tags.bridge === 'yes' || tags.covered === 'yes') { unsupported++; counts.omitted++; continue; }
          const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates[0]] : [];
          if (!lines.length) { counts.omitted++; continue; }
          const mappedWidth = Number(tags.width);
          const widthM = Number.isFinite(mappedWidth) && mappedWidth > 0 && mappedWidth < 100 ? mappedWidth : /footway|path|pedestrian|steps|cycleway/.test(tags.highway) ? 2 : /motorway|trunk|primary/.test(tags.highway) ? 12 : 6;
          roads.push({ lines: lines.map(projectLine), width: Math.max(0.4, widthM * mmPerMeter) });
        }
      }
      const solidFeatures: Manifold[] = [terrain];
      const parts = own(CS.union(buildings.filter((b) => b.part).map((b) => b.section)));
      for (const building of buildings) {
        const section = building.part ? building.section : own(building.section.subtract(parts));
        if (section.area() >= 0.16) {
          // Extrusion extends down through the base, so flat roofs remain supported on relief.
          const polygons = section.toPolygons();
          let roof = 0;
          // Bound the roof height over its footprint while avoiding a full-grid scan for each building.
          const bounds = section.bounds();
          const cMin = Math.max(0, Math.floor((bounds.min[0] / crop.widthMm + 0.5) * (cols - 1)));
          const cMax = Math.min(cols - 1, Math.ceil((bounds.max[0] / crop.widthMm + 0.5) * (cols - 1)));
          const rMin = Math.max(0, Math.floor((bounds.min[1] / crop.heightMm + 0.5) * (rows - 1)));
          const rMax = Math.min(rows - 1, Math.ceil((bounds.max[1] / crop.heightMm + 0.5) * (rows - 1)));
          for (let r = rMin; r <= rMax; r++) for (let c = cMin; c <= cMax; c++) roof = Math.max(roof, heights[r * cols + c]!);
          for (const ring of polygons) for (const [x, y] of ring) roof = Math.max(roof, sampleHeightBilinearMm(x, y, heights, cols, rows, crop));
          if (!polygons.length) continue;
          solidFeatures.push(extrusion(section, -baseThickness + 0.05, Math.max(roof, 0) + building.height)); counts.buildings++;
        }
        if (!building.part) drop(section);
      }
      drop(parts); buildings.forEach((b) => drop(b.section));
      const roadSections: CrossSection[] = [];
      for (const road of roads) {
        const section = stroke(road.lines, road.width, footprint);
        if (!section.isEmpty()) {
          const simplified = own(section.simplify(0.05));
          simplifiedDetails += Math.max(0, section.numVert() - simplified.numVert());
          roadSections.push(simplified); counts.roads++;
        }
        drop(section);
      }
      if (roadSections.length) {
        const section = own(CS.union(roadSections)); roadSections.forEach(drop);
        const prism = extrusion(section, -baseThickness + 0.05, maxSurface + settings.roadReliefMm + 1);
        const raisedTerrain = own(terrain.translate([0, 0, settings.roadReliefMm]));
        solidFeatures.push(own(prism.intersect(raisedTerrain))); drop(raisedTerrain); drop(prism); drop(section);
      }
      const city = own(Solid.union(solidFeatures));
      // Evaluate the city union once before retaining it; subsequent booleans reuse its result.
      if (city.status() !== 'NoError' || city.isEmpty() || city.volume() <= 0) throw new Error('City is not a closed printable solid. Adjust the crop or city settings.');
      if (city.numTri() > 2_000_000) throw new Error('The model is too complex. Choose a smaller area or lower mesh quality.');
      if (simplifiedDetails) warnings.push(`${simplifiedDetails} sub-print-scale building/road vertices were simplified at 0.05 mm; route coordinates are retained.`);
      if (fallbackCount) warnings.push(`${fallbackCount} buildings use the ${settings.fallbackBuildingHeightM} m fallback height; mapped levels use 3 m per level.`);
      if (counts.omitted) warnings.push(`${counts.omitted} incomplete or sub-print-scale details were omitted (0.05 mm simplification, 0.16 mm² building minimum).`);
      if (unsupported) warnings.push(`${unsupported} bridges, tunnels or covered roads were omitted; road relief is supported on the base.`);
      if (!counts.buildings && settings.buildingsVisible) warnings.push('No printable buildings were found in this crop.');
      if (!counts.roads && settings.roadsVisible) warnings.push('No printable roads were found in this crop.');
      prepared = { footprint, terrain, city, maxSurface, strokeEdges, counts: { ...counts }, warnings: [...warnings] };
      if (retain) {
        retain(prepared);
        // Ownership passes to the builder. All other native allocations remain temporary.
        allocations.delete(footprint); allocations.delete(terrain); allocations.delete(city);
      }
    }
    const { footprint, terrain, city } = prepared;
    onTrail?.();
    const rawSegments = request.config.gpx.segments ?? [request.config.gpx.rawPoints?.length ? request.config.gpx.rawPoints : request.config.gpx.points];
    const segments = rawSegments.filter((s) => s.length >= 2).map((s) => s.map((p) => project(p.lon, p.lat)));
    counts.routeSegments = segments.length;
    const routeSection = stroke(segments, settings.routeWidthMm, footprint);
    if (routeSection.isEmpty()) throw new Error('The running route is outside the crop. Fit the track or pan the map.');
    const grooveSection = stroke(segments, settings.routeWidthMm + settings.routeClearanceMm * 2, footprint);
    const belowSeat = own(terrain.translate([0, 0, -settings.routeSeatDepthMm]));
    const aboveRoute = own(terrain.translate([0, 0, settings.routeReliefMm]));
    const slab = own(aboveRoute.subtract(belowSeat));
    const routePrism = extrusion(routeSection, -baseThickness, maxSurface + settings.routeReliefMm + 1);
    const route = own(routePrism.intersect(slab));
    const groovePrism = extrusion(grooveSection, -baseThickness, maxSurface + 2000);
    // Cut all buildings and road relief above the terrain-following seat, leaving the route visible.
    // 0.01 mm of vertical fit clearance avoids coplanar floor contact after STL float32 rounding.
    const grooveFloor = own(terrain.translate([0, 0, -settings.routeSeatDepthMm - 0.01]));
    const cutter = own(groovePrism.subtract(grooveFloor));
    const main = own(city.subtract(cutter));
    const payload = (solid: Manifold, name: string): TerrainMeshPayload => {
      if (solid.status() !== 'NoError' || solid.isEmpty() || solid.volume() <= 0) throw new Error(`${name} is not a closed printable solid. Adjust the crop or route settings.`);
      const mesh = solid.getMesh();
      const positions: number[] = [];
      for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) positions.push(mesh.vertProperties[i]!, mesh.vertProperties[i + 1]!, mesh.vertProperties[i + 2]!);
      if (!positions.every(Number.isFinite) || mesh.triVerts.length > 6_000_000) throw new Error('The model is too complex. Choose a smaller area or lower mesh quality.');
      return { positions, indices: Array.from(mesh.triVerts), minSurfaceZ: 0, bottomZ: -baseThickness, gridCols: cols, gridRows: rows };
    };
    return { crop, cityMesh: payload(main, 'City'), routeMesh: payload(route, 'Route'), featureCounts: counts, warnings };
  } finally { for (const value of allocations) value.delete(); }
}
