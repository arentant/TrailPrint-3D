import type { TerrainCropRegion, TerrainGenerateRequest, TerrainMeshPayload, TrailGrooveSpec } from '@shared/types/terrain';
import { buildWaterGeometry } from '@shared/water/geometry';
import { loadCityMapData } from './city-map-provider';
import { getManifold } from './manifold-runtime';

export async function generateWaterAssembly(
  request: TerrainGenerateRequest,
  crop: TerrainCropRegion,
  terrain: TerrainMeshPayload,
  trail: Array<{ x: number; y: number }>,
  groove?: TrailGrooveSpec,
) {
  const data = await loadCityMapData({ bounds: { minLat: crop.minLat, maxLat: crop.maxLat, minLon: crop.minLon, maxLon: crop.maxLon },
    buildings: false, roads: false, water: true });
  return buildWaterGeometry(await getManifold(), request, crop, data, terrain, trail, groove);
}
