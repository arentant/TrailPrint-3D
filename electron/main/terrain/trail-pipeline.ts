import type { AppConfig } from "@shared/types";
import type { TerrainCropRegion, TrailGrooveSpec } from "@shared/types/terrain";
import { projectTrailToModelMm } from "@shared/utils/trail-coords";
import { resolveTrailSegments } from "@shared/utils/trail-resolve";

export { resolveTrailPoints } from "@shared/utils/trail-resolve";

export function buildTrailGrooveSpec(
  config: AppConfig, crop: TerrainCropRegion, viewportWidth: number, viewportHeight: number,
): TrailGrooveSpec | undefined {
  const polylinesMm = buildTrailLinePolylines(config, crop, viewportWidth, viewportHeight);
  if (!polylinesMm.length) return undefined;
  return {
    polylineMm: polylinesMm[0], polylinesMm,
    widthMm: config.trail.trailWidthMm + 2 * config.assembly.trailToleranceMm,
    depthMm: config.trail.trailDepthMm,
  };
}

export function buildTrailLinePolylines(
  config: AppConfig, crop: TerrainCropRegion, viewportWidth: number, viewportHeight: number,
) {
  return resolveTrailSegments(config).map(points => projectTrailToModelMm(points, crop, {
    mapCrop: config.mapCrop, viewportWidth, viewportHeight,
  })).filter(line => line.length >= 2);
}

/** Legacy single-path callers receive the first segment, never joined routes. */
export function buildTrailLinePolyline(
  config: AppConfig, crop: TerrainCropRegion, viewportWidth: number, viewportHeight: number,
) {
  return buildTrailLinePolylines(config, crop, viewportWidth, viewportHeight)[0] ?? [];
}
