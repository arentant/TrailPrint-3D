import type { GpxImportResult } from '../types/gpx';
import type { CityPictureConfig } from '../types/city';

export function cityPictureDetails(gpx: Pick<GpxImportResult, 'trackName' | 'distanceKm' | 'activityDate' | 'elapsedSeconds' | 'athleteName'>, fileName?: string): Pick<CityPictureConfig, 'title' | 'athlete' | 'date' | 'distance' | 'duration' | 'pace'> {
  const seconds = gpx.elapsedSeconds;
  const hasTime = seconds !== undefined && Number.isFinite(seconds) && seconds > 0;
  const hasDistance = Number.isFinite(gpx.distanceKm) && gpx.distanceKm > 0;
  const elapsed = hasTime ? Math.round(seconds) : 0;
  const pace = hasTime && hasDistance ? Math.round(seconds / gpx.distanceKm) : 0;
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    title: gpx.trackName || fileName?.replace(/\.gpx$/i, '') || 'My city run',
    athlete: gpx.athleteName ?? '',
    date: gpx.activityDate ?? '',
    distance: hasDistance ? gpx.distanceKm.toFixed(2) : '',
    duration: hasTime ? `${Math.floor(elapsed / 3600)}:${pad(Math.floor(elapsed / 60) % 60)}:${pad(elapsed % 60)}` : '',
    pace: pace > 0 ? `${Math.floor(pace / 60)}:${pad(pace % 60)}` : '',
  };
}
