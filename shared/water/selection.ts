import type { TrailPathsMm } from './stroke';
import type { CrossSection, ManifoldToplevel, Vec2 } from 'manifold-3d';
import type { AppConfig } from '../types/config';
import type { TerrainCropRegion } from '../types/terrain';
import type { WaterFeature, WaterFeatureStatus } from '../types/water';
import { normalizeWaterConfig } from '../types/config';
import { cityProjector } from '../city/geometry';
import { buildFootprintPolygonMm } from '../utils/footprint';
import { strokeSection, strokeTrailPaths } from './stroke';
import { metersPerDegreeLon } from '../utils/map-projection';

export interface PreparedWaterFeature {
  feature: WaterFeature;
  status: WaterFeatureStatus;
  reviewPolygonsMm: number[][][];
}
export interface PreparedWaterPart {
  insert: CrossSection;
  pocket: CrossSection;
  featureIds: string[];
  sea: boolean;
}

/** One planar selection pipeline for map review, preview and every export. */
export function prepareWaterSelection(wasm: ManifoldToplevel, request: { config: AppConfig; viewportWidth: number; viewportHeight: number }, crop: TerrainCropRegion,
  features: WaterFeature[], trail: TrailPathsMm) {
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
  const parts: PreparedWaterPart[] = [];
  const candidates: Array<{ entry: PreparedWaterFeature; section: CrossSection; bounds: ReturnType<CrossSection['bounds']> }> = [];
  try {
    const vertices = buildFootprintPolygonMm(crop);
    const outer = vertices ? own(new CS([vertices.map((v): Vec2 => [v.x, v.y])], 'EvenOdd')) : own(CS.circle(crop.radiusMm!, 128));
    const footprint = own(outer.offset(-0.6, 'Round', 2, 24));
    const trailWidth = request.config.trail.trailWidthMm + (request.config.printMode === 'fused' ? 0 : 2 * request.config.assembly.trailToleranceMm + 0.1);
    const corridor = own(strokeTrailPaths(wasm, trail, trailWidth));
    let occupied = own(new CS([[]]));
    let sourcePriority = -1;
    let sourceCoverage: CrossSection[] = [];
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
      const nextPriority = priority(feature);
      if (nextPriority !== sourcePriority) {
        // Hidden preferred sources still block lower-priority fallbacks. Within
        // one source tier, only kept features claim geometry: hiding an
        // overlapping record must not erase another record the user kept.
        if (sourceCoverage.length) occupied = own(CS.union([occupied, ...sourceCoverage]));
        sourceCoverage = [];
        sourcePriority = nextPriority;
      }
      const status: WaterFeatureStatus = { featureId: feature.id, state: 'included', areaMm2: 0, exaggerated: false, partIndices: [] };
      const entry: PreparedWaterFeature = { feature, status, reviewPolygonsMm: [] }; entries.push(entry);
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
      sourceCoverage.push(clipped);
      const overlap = own(clipped.intersect(occupied));
      const unique = own(clipped.subtract(occupied));
      if (unique.isEmpty() || (feature.source.id === 'hydrolakes' && overlap.area() >= clipped.area() * 0.5)) {
        status.state = 'covered'; status.reason = 'Already covered by a preferred source'; continue;
      }
      if (settings.excludedFeatureIds.includes(feature.id)) { status.state = 'excluded'; status.reason = 'Excluded from this model'; continue; }
      if (!settings.categories.includes(feature.category)) { status.state = 'category-disabled'; status.reason = `${feature.category} category disabled`; continue; }
      occupied = own(occupied.add(clipped));
      const reserved = request.config.printMode === 'fused' ? unique : own(unique.subtract(corridor));
      candidates.push({ entry, section: reserved, bounds: reserved.bounds() });
    }
    const retained = new Set<string>(), omitted = new Map<string, number>();
    const intersecting = (section: CrossSection, group: typeof candidates) => {
      const bounds = section.bounds();
      return group.filter(candidate => {
        if ([0, 1].some(axis => bounds.max[axis]! <= candidate.bounds.min[axis]! || bounds.min[axis]! >= candidate.bounds.max[axis]!)) return false;
        const overlap = section.intersect(candidate.section);
        try { return overlap.area() > 1e-8; } finally { overlap.delete(); }
      });
    };
    // Offset the selected wet footprint once. Offsetting adjoining OSM ways
    // separately creates an artificial gap of twice the fitting clearance.
    // Sea and inland water retain their distinct surface-height rules.
    for (const sea of [false, true]) {
      const group = candidates.filter(candidate => (candidate.entry.feature.category === 'sea') === sea);
      if (!group.length) continue;
      const reserved = own(CS.union(group.map(candidate => candidate.section)));
      const insetRaw = own(reserved.offset(-clearance, 'Round', 2, 24));
      const inset = own(insetRaw.simplify(0.02));
      for (const part of inset.decompose()) {
        own(part);
        const members = intersecting(part, group);
        const core = own(part.offset(-settings.minimumWidthMm / 2, 'Round', 2, 24));
        if (part.area() < settings.minimumAreaMm2 || core.isEmpty()) {
          for (const member of members) omitted.set(member.entry.feature.id, (omitted.get(member.entry.feature.id) ?? 0) + 1);
          continue;
        }
        const expanded = own(part.offset(clearance, 'Round', 2, 24));
        const pocketRaw = own(expanded.intersect(reserved));
        const pocket = clearance === 0 ? part : own(pocketRaw.simplify(0.02));
        const featureIds = members.map(member => member.entry.feature.id);
        featureIds.forEach(id => retained.add(id));
        parts.push({ insert: part, pocket, featureIds, sea });
      }
    }
    for (const { entry } of candidates) {
      if (!retained.has(entry.feature.id)) { entry.status.state = 'too-small'; entry.status.reason = 'No printable area remains after clearance, width filtering and trail support'; }
      else if (omitted.has(entry.feature.id)) entry.status.reason = `${omitted.get(entry.feature.id)} small pieces omitted after clearance`;
    }
    return { entries, parts, corridor, dispose };
  } catch (error) { dispose(); throw error; }
}
