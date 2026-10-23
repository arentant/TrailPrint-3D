import type { AppConfig, GpxPoint } from "../types";
import { simplifyGpxTrack } from "./gpx-simplify";

export function resolveTrailSegments(config: AppConfig): GpxPoint[][] {
  const { gpx, trail } = config;
  if (!gpx.imported) return [];
  const raw = gpx.rawPoints.length > 0 ? gpx.rawPoints : gpx.points;
  const base = gpx.points.length >= 2 ? gpx.points : raw;
  const segments = gpx.segments ?? [trail.gpxSimplify ? raw : base];
  return segments.filter(segment => segment.length >= 2).map(segment => {
    if (!trail.gpxSimplify) return segment;
    const simplified = simplifyGpxTrack(segment);
    return simplified.length >= 2 ? simplified : segment;
  });
}

/** For bounds and point counts only. Geometry must use resolveTrailSegments. */
export function resolveTrailPoints(config: AppConfig): GpxPoint[] {
  return resolveTrailSegments(config).flat();
}
