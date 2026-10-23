import { createDefaultConfig, type GpxState } from '../types/config';
import type { GpxFileImport } from '../types/gpx';

/** Accept older single-file states as well as collections. */
export function gpxFiles(gpx: GpxState): GpxFileImport[] {
  if (!gpx.imported) return [];
  if (gpx.files?.length) return gpx.files;
  if (!gpx.bounds) return [];
  return [{ ...gpx, importId: gpx.importId ?? crypto.randomUUID(),
    suggestedCenter: { lat: (gpx.bounds.minLat + gpx.bounds.maxLat) / 2, lon: (gpx.bounds.minLon + gpx.bounds.maxLon) / 2 },
    bounds: gpx.bounds }];
}

export function combineGpxFiles(files: GpxFileImport[]): GpxState {
  if (!files.length) return createDefaultConfig().gpx;
  const pointCount = files.reduce((sum, file) => sum + file.pointCount, 0);
  if (pointCount > 100_000) throw new Error('Use at most 100,000 GPX points across all files in one model');
  const segments = files.flatMap(file => file.segments ?? [file.points]);
  const points = segments.flat();
  const bounds = files.reduce((bounds, file) => ({
    minLat: Math.min(bounds.minLat, file.bounds.minLat), maxLat: Math.max(bounds.maxLat, file.bounds.maxLat),
    minLon: Math.min(bounds.minLon, file.bounds.minLon), maxLon: Math.max(bounds.maxLon, file.bounds.maxLon),
  }), { ...files[0].bounds });
  const single = files.length === 1 ? files[0] : undefined;
  return {
    imported: true, files, importId: single?.importId ?? crypto.randomUUID(),
    fileName: single?.fileName, filePath: single?.filePath,
    trackName: single ? single.trackName : `${files.length} GPX files`,
    activityDate: single?.activityDate, elapsedSeconds: single?.elapsedSeconds, athleteName: single?.athleteName,
    segments, points, rawPoints: points, bounds, pointCount,
    distanceKm: files.reduce((sum, file) => sum + file.distanceKm, 0),
  };
}
