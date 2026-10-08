import type { CityGenerateRequest } from '../types/city';
import { computeTerrainCropRegion } from '../utils/crop-region';
import { cityFootprint } from './geometry';

/** Shared by picture preview, print export and city geometry. */
export function citySelectionCrop(request: CityGenerateRequest) {
  const crop = computeTerrainCropRegion(request.config.mapCrop, request.viewportWidth, request.viewportHeight);
  const outline = cityFootprint(request, crop);
  if (outline) {
    crop.widthMm = Math.max(crop.widthMm, ...outline.map(([x]) => Math.abs(x) * 2));
    crop.heightMm = Math.max(crop.heightMm, ...outline.map(([, y]) => Math.abs(y) * 2));
  }
  return crop;
}
