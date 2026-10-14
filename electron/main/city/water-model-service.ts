import type { TerrainCropRegion, TerrainGenerateRequest, TerrainMeshPayload, TrailGrooveSpec } from '@shared/types/terrain';
import { buildWaterGeometry } from '@shared/water/geometry';
import { fetchWaterCatalog } from './water-catalog-service';
import { waterCatalogKey } from '@shared/water/catalog';
import { getManifold } from './manifold-runtime';

export async function generateWaterAssembly(
  request: TerrainGenerateRequest,
  crop: TerrainCropRegion,
  terrain: TerrainMeshPayload,
  trail: Array<{ x: number; y: number }>,
  groove?: TrailGrooveSpec,
  seaLevelMm?: number,
) {
  const catalogRequest = { mapCrop: request.config.mapCrop, viewportWidth: request.viewportWidth, viewportHeight: request.viewportHeight };
  const data = request.waterCatalog?.key === waterCatalogKey(catalogRequest) ? request.waterCatalog : await fetchWaterCatalog(catalogRequest);
  const result = buildWaterGeometry(await getManifold(), request, crop, data, terrain, trail, groove, seaLevelMm);
  return { ...result, waterCoverageErrors: data.errors, waterWarnings: [...result.waterWarnings, ...data.errors.map(e => `${e.source}: ${e.message}`)] };
}
