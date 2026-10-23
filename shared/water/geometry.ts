import type { TrailPathsMm } from './stroke';
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import type { CityMapData } from '../types/city';
import type { WaterCatalog, WaterFeatureStatus, WaterPartMapping, WaterAttribution, WaterFeatureSummary } from '../types/water';
import type { TerrainCropRegion, TerrainGenerateRequest, TerrainMeshPayload, TrailGrooveSpec } from '../types/terrain';
import { waterMeshPayload } from './mesh-payload';
import { osmWaterFeatures } from './catalog';
import { prepareWaterSelection } from './selection';
import { normalizeWaterConfig } from '../types/config';

export interface WaterGeometryResult {
  mesh: TerrainMeshPayload;
  waterMeshes: TerrainMeshPayload[];
  waterWarnings: string[];
  waterFeatureStatuses: WaterFeatureStatus[];
  waterFeatureDetails: WaterFeatureSummary[];
  waterPartMappings: WaterPartMapping[];
  waterAttribution: WaterAttribution[];
}

/** Flat seats for inland DEM surfaces; sea tops use the terrain's sea-level transform. */
export function buildWaterGeometry(wasm: ManifoldToplevel, request: TerrainGenerateRequest, crop: TerrainCropRegion,
  data: CityMapData | WaterCatalog, terrain: TerrainMeshPayload, trail: TrailPathsMm,
  groove?: TrailGrooveSpec, seaLevelMm?: number): WaterGeometryResult {
  const settings = normalizeWaterConfig(request.config.water);
  const features = 'features' in data ? data.features : osmWaterFeatures(data);
  const selection = prepareWaterSelection(wasm, request, crop, features, trail);
  const result: WaterGeometryResult = { mesh: terrain, waterMeshes: [], waterWarnings: [],
    waterFeatureStatuses: selection.entries.map(e => e.status), waterPartMappings: [],
    waterFeatureDetails: features.map(({ geometry: _geometry, complete: _complete, ...feature }) => feature),
    waterAttribution: 'sources' in data ? data.sources : [...new Map(features.map(f => [f.source.id, f.source])).values()] };
  const allocations = new Set<CrossSection | Manifold>();
  const own = <T extends CrossSection | Manifold>(value: T): T => { allocations.add(value); return value; };
  const drop = (value: CrossSection | Manifold) => { if (allocations.delete(value)) value.delete(); };
  const { Manifold: Solid, Mesh } = wasm;
  const extrude = (section: CrossSection, bottom: number, top: number) => {
    const raw = own(section.extrude(top - bottom));
    const positioned = own(raw.translate([0, 0, bottom])); drop(raw); return positioned;
  };
  const payload = (solid: Manifold, bottomZ: number): TerrainMeshPayload => {
    if (solid.status() !== 'NoError' || solid.isEmpty() || solid.volume() <= 0) throw new Error('Could not build a closed water assembly. Try a lower mesh quality.');
    return waterMeshPayload(solid, terrain, bottomZ);
  };
  try {
    const sourceMesh = new Mesh({ numProp: 3, vertProperties: new Float32Array(terrain.positions), triVerts: new Uint32Array(terrain.indices) });
    sourceMesh.merge();
    const source = own(new Solid(sourceMesh));
    if (source.status() !== 'NoError') throw new Error('Terrain could not be prepared for water pockets. Choose a lower mesh quality.');
    let main = source;
    const maxZ = Math.max(source.boundingBox().max[2] + 1, (seaLevelMm ?? 0) + 1);
    const statusesById = new Map(result.waterFeatureStatuses.map(status => [status.featureId, status]));
    for (const part of selection.parts) {
      const statuses = part.featureIds.map(id => statusesById.get(id)!);
      const fullPrism = extrude(part.pocket, terrain.bottomZ, maxZ);
      const fullWater = own(source.intersect(fullPrism)); drop(fullPrism);
      if (fullWater.isEmpty()) { statuses.forEach(status => { status.reason = 'No terrain beneath this part'; }); drop(fullWater); continue; }
      const waterMesh = fullWater.getMesh();
      let minSurface = Infinity;
      for (let i = 2; i < waterMesh.vertProperties.length; i += waterMesh.numProp) {
        const z = waterMesh.vertProperties[i]!;
        if (z > terrain.bottomZ + 1e-4) minSurface = Math.min(minSurface, z);
      }
      const sea = part.sea;
      if (sea && !Number.isFinite(seaLevelMm)) throw new Error('Sea water requires the terrain elevation transformation.');
      const floor = Math.min(minSurface, sea ? seaLevelMm! : Infinity) - settings.thicknessMm;
      if (!Number.isFinite(floor) || floor < terrain.bottomZ + 0.4 - 1e-4) throw new Error('A water pocket would leave too little material beneath it. Increase terrain base thickness or reduce water thickness.');
      const prism = extrude(part.insert, floor, sea ? seaLevelMm! : maxZ);
      const insert = sea ? prism : own(source.intersect(prism));
      if (!sea) drop(prism);
      if (insert.isEmpty()) { statuses.forEach(status => { status.reason = 'Empty part after terrain intersection'; }); drop(insert); drop(fullWater); continue; }
      // A pocket is cut only after its printable insert exists.
      const insertPayload = payload(insert, floor);
      const pocket = extrude(part.pocket, floor, maxZ);
      const cutMain = own(main.subtract(pocket)); if (main !== source) drop(main); main = cutMain;
      drop(pocket);
      const partIndex = result.waterMeshes.length;
      result.waterMeshes.push(insertPayload);
      statuses.forEach(status => status.partIndices.push(partIndex));
      result.waterPartMappings.push({ partIndex, featureIds: part.featureIds });
      drop(insert); drop(fullWater);
      if (result.waterMeshes.length > 200) throw new Error('Too many water parts. Increase minimum area or select a smaller crop.');
    }
    for (const status of result.waterFeatureStatuses) {
      if (status.state === 'included' && !status.partIndices.length) { status.state = 'too-small'; status.reason ??= 'No printable part remains'; }
    }
    if (result.waterMeshes.length) {
      if (groove && !selection.corridor.isEmpty()) {
        const grooveSection = own(selection.corridor.offset(-0.05, 'Round', 2, 16));
        const cutter = extrude(grooveSection, groove.floorZMm ?? -groove.depthMm, maxZ);
        const grooved = own(main.subtract(cutter)); if (main !== source) drop(main); main = grooved;
        drop(cutter); drop(grooveSection);
      }
      result.mesh = payload(main, terrain.bottomZ);
    } else result.waterWarnings.push(features.length ? 'No printable water remains for the current selection and print scale.' : 'No water features found in the available sources.');
    const omitted = result.waterFeatureStatuses.filter(s => ['too-small', 'incomplete'].includes(s.state));
    if (omitted.length) result.waterWarnings.push(`${omitted.length} incomplete or small water areas were omitted. Inserts need at least ${settings.minimumWidthMm} mm of printable width after clearance.`);
    return result;
  } finally { selection.dispose(); for (const value of allocations) value.delete(); }
}
