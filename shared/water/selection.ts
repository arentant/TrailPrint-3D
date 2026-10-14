import type { CrossSection, ManifoldToplevel, Vec2 } from 'manifold-3d';
import type { AppConfig } from '../types/config';
import type { TerrainCropRegion } from '../types/terrain';
import type { WaterFeature, WaterFeatureStatus } from '../types/water';
import { normalizeWaterConfig } from '../types/config';
import { cityProjector } from '../city/geometry';
import { buildFootprintPolygonMm } from '../utils/footprint';
import { strokeSection } from './stroke';
import { metersPerDegreeLon } from '../utils/map-projection';

export interface PreparedWaterFeature {
  feature: WaterFeature;
  status: WaterFeatureStatus;
  reviewPolygonsMm: number[][][];
  parts: Array<{ insert: CrossSection; pocket: CrossSection }>;
}

/** One planar selection pipeline for map review, preview and every export. */
export function prepareWaterSelection(wasm: ManifoldToplevel, request: { config: AppConfig; viewportWidth: number; viewportHeight: number }, crop: TerrainCropRegion,
  features: WaterFeature[], trail: Array<{ x: number; y: number }>) {
  const { CrossSection: CS } = wasm;
  const allocations = new Set<CrossSection>();
  const own = (s: CrossSection) => { allocations.add(s); return s; };
  const dispose = () => { for (const s of allocations) s.delete(); allocations.clear(); };
  const settings = normalizeWaterConfig(request.config.water);
  const clearance = request.config.printMode === 'fused' ? 0 : settings.clearanceMm;
  const project = cityProjector(request, crop);
  const projectedOrigin = project(crop.centerLon, crop.centerLat);
  const projectedMeter = project(crop.centerLon + 1 / metersPerDegreeLon(crop.centerLat), crop.centerLat);
  const mmPerM = Math.hypot(projectedMeter[0] - projectedOrigin[0], projectedMeter[1] - projectedOrigin[1]);
  const stroke = (points: Vec2[], width: number) => own(strokeSection(wasm, points, width));
  const entries: PreparedWaterFeature[] = [];
  try {
    const vertices = buildFootprintPolygonMm(crop);
    const outer = vertices ? own(new CS([vertices.map((v): Vec2 => [v.x, v.y])], 'EvenOdd')) : own(CS.circle(crop.radiusMm!, 128));
    const footprint = own(outer.offset(-0.6, 'Round', 2, 24));
    const trailWidth = request.config.trail.trailWidthMm + (request.config.printMode === 'fused' ? 0 : 2 * request.config.assembly.trailToleranceMm + 0.1);
    const corridor = stroke(trail.map(p => [p.x, p.y]), trailWidth);
    let occupied = own(new CS([[]]));
    const priority = (f: WaterFeature) => f.category === 'sea' ? 5 : !f.geometry.type.includes('Line') ? (f.source.id === 'osm' ? 0 : 1) : f.source.id === 'osm' ? 2 : 3;
    const widthSources = features.filter(f => f.source.id === 'grwl' && f.widthM && f.complete).flatMap(f => {
      const g = f.geometry;
      const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      return lines.map(line => ({ feature: f, points: line.map(([lon, lat]) => project(lon!, lat!)) }));
    });
    const pointDistance = (p: Vec2, points: Vec2[]) => {
      let distance = Infinity;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!, b = points[i]!, dx = b[0] - a[0], dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        distance = Math.min(distance, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
      }
      return distance;
    };
    const sorted = [...features].sort((a, b) => priority(a) - priority(b) || a.id.localeCompare(b.id));
    for (const feature of sorted) {
      const status: WaterFeatureStatus = { featureId: feature.id, state: 'included', areaMm2: 0, exaggerated: false, partIndices: [] };
      const entry: PreparedWaterFeature = { feature, status, reviewPolygonsMm: [], parts: [] }; entries.push(entry);
      if (!feature.complete) { status.state = 'incomplete'; status.reason = 'Incomplete source geometry'; continue; }
      const g = feature.geometry;
      const sections: CrossSection[] = [];
      if (g.type === 'LineString' || g.type === 'MultiLineString') {
        const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
        let widthM = feature.widthM;
        if (!widthM && feature.source.id === 'osm') {
          const samples = lines.flatMap(line => [line[0]!, line[Math.floor(line.length / 2)]!, line[line.length - 1]!]).map(([lon, lat]) => project(lon!, lat!));
          const matches = widthSources.filter(candidate => samples.every(p => pointDistance(p, candidate.points) <= Math.max(candidate.feature.widthM! * mmPerM / 2, .2)));
          if (matches.length) widthM = Math.max(...matches.map(m => m.feature.widthM!));
        }
        const actualWidth = (widthM ?? 0) * mmPerM;
        const width = Math.max(actualWidth * settings.riverWidthMultiplier, settings.minimumRiverWidthMm + 2 * clearance);
        status.printedWidthMm = width - 2 * clearance;
        status.exaggerated = !widthM || status.printedWidthMm > actualWidth + 1e-6;
        for (const line of lines) sections.push(stroke(line.map(([lon, lat]) => project(lon!, lat!)), width));
      } else {
        const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        for (const polygon of polygons) sections.push(own(new CS(polygon.map(ring => ring.map(([lon, lat]) => project(lon!, lat!))), 'EvenOdd')));
      }
      const raw = own(CS.union(sections));
      const clippedRaw = own(raw.intersect(footprint));
      const clipped = own(clippedRaw.simplify(0.02));
      entry.reviewPolygonsMm = clipped.toPolygons();
      status.areaMm2 = clipped.area();
      if (clipped.isEmpty()) { status.state = 'outside-crop'; status.reason = 'Outside the protective crop border'; continue; }
      // Reserve source coverage even when excluded. A fallback cannot restore a
      // deselected body. Complete OSM outlines take precedence over large lakes.
      const overlap = own(clipped.intersect(occupied));
      const unique = own(clipped.subtract(occupied));
      const merged = own(occupied.add(clipped)); occupied = merged;
      if (unique.isEmpty() || (feature.source.id === 'hydrolakes' && overlap.area() >= clipped.area() * 0.5)) {
        status.state = 'covered'; status.reason = 'Already covered by a preferred source'; continue;
      }
      if (settings.excludedFeatureIds.includes(feature.id)) { status.state = 'excluded'; status.reason = 'Excluded from this model'; continue; }
      if (!settings.categories.includes(feature.category)) { status.state = 'category-disabled'; status.reason = `${feature.category} category disabled`; continue; }
      const reserved = request.config.printMode === 'fused' ? unique : own(unique.subtract(corridor));
      const insetRaw = own(reserved.offset(-clearance, 'Round', 2, 24));
      const inset = own(insetRaw.simplify(0.02));
      let omitted = 0;
      for (const part of inset.decompose()) {
        own(part);
        const core = own(part.offset(-settings.minimumWidthMm / 2, 'Round', 2, 24));
        if (part.area() < settings.minimumAreaMm2 || core.isEmpty()) { omitted++; continue; }
        const expanded = own(part.offset(clearance, 'Round', 2, 24));
        const pocketRaw = own(expanded.intersect(reserved));
        const pocket = clearance === 0 ? part : own(pocketRaw.simplify(0.02));
        entry.parts.push({ insert: part, pocket });
      }
      if (!entry.parts.length) { status.state = 'too-small'; status.reason = 'No printable area remains after clearance, width filtering and trail support'; }
      else if (omitted) status.reason = `${omitted} small pieces omitted after clearance`;
    }
    return { entries, corridor, dispose };
  } catch (error) { dispose(); throw error; }
}
