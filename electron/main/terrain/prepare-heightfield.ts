import type { TerrainConfig, TerrainMeshQuality } from '@shared/types/config';
import type { TerrainCropRegion } from '@shared/types/terrain';
import { terrainMeshQualitySpec } from '@shared/utils/terrain-mesh-quality';
import { metersPerDegreeLat, metersPerDegreeLon } from '@shared/utils/map-projection';
import { applyTerrainSmoothing, fillDemHoles } from './smoothing';
/**
 * DEM 海拔 (m) → 模型 Z 抬升 (mm)，原地写入 elevations。
 * 全图最低海拔归一为 Z=0（基础顶面基准）；基础厚度在 Z=0 以下。
 */
export function elevationsToHeightMmInPlace(
  elevations: Float64Array,
  crop: TerrainCropRegion,
  zExaggeration: number,
  meshQuality: TerrainMeshQuality | undefined,
  meshQualityCustom: TerrainConfig["meshQualityCustom"],
): { baseM: number } {
  const zCapMm = terrainMeshQualitySpec(meshQuality, meshQualityCustom).zCapMm;
  let minM = Infinity;
  let maxZ = 0;
  for (let i = 0; i < elevations.length; i++) {
    const v = elevations[i]!;
    if (Number.isFinite(v) && v < minM) minM = v;
  }
  if (!Number.isFinite(minM)) minM = 0;
  const baseM = minM;

  const latMid = (crop.minLat + crop.maxLat) / 2;
  const geoW = Math.max(
    (crop.maxLon - crop.minLon) * metersPerDegreeLon(latMid),
    1,
  );
  const geoH = Math.max((crop.maxLat - crop.minLat) * metersPerDegreeLat(), 1);
  const horizMm = Math.max(crop.widthMm, crop.heightMm, 20);
  const mmPerMeter = horizMm / Math.max(geoW, geoH);

  for (let i = 0; i < elevations.length; i++) {
    const v = elevations[i]!;
    const relM = Number.isFinite(v) ? v - baseM : 0;
    const z = relM * mmPerMeter * zExaggeration;
    elevations[i] = z;
    if (z > maxZ) maxZ = z;
  }

  const scale = maxZ > zCapMm ? zCapMm / maxZ : 1;
  if (scale !== 1) {
    for (let i = 0; i < elevations.length; i++) {
      elevations[i] = elevations[i]! * scale;
    }
  }
  return { baseM };
}

export function prepareElevationHeightfield(elevations: Float64Array, cols: number, rows: number, crop: TerrainCropRegion, terrain: TerrainConfig): Float64Array {
  if (!elevations.some(Number.isFinite)) throw new Error('No elevation data was found. Choose another area or dataset.');
  fillDemHoles(elevations, cols, rows);
  const heights = applyTerrainSmoothing(elevations, cols, rows, terrain.smoothing);
  elevationsToHeightMmInPlace(heights, crop, terrain.zExaggeration, terrain.meshQuality, terrain.meshQualityCustom);
  return heights;
}
