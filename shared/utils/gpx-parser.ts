import type { GpxBounds, GpxPoint } from '@shared/types'
import type { GpxImportResult } from '@shared/types/gpx'
import { IpcException } from '@shared/ipc/types'
import { computeTrackDistanceKm } from '../../electron/main/gpx/distance'

function xmlText(xml: string, tag: string): string | undefined {
  const value = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i').exec(xml)?.[1];
  if (value === undefined) return undefined;
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(value);
  if (cdata) return cdata[1].trim() || undefined;
  return value.replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (match, code: string | undefined, entity: string | undefined) => {
      if (code) {
        const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : match;
      }
      return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[entity!.toLowerCase()]!;
    }).trim() || undefined;
}

function activityDetails(xml: string, pointTag: string) {
  const times = [...xml.matchAll(new RegExp(`<${pointTag}\\b[^>]*>([\\s\\S]*?)<\\/${pointTag}\\s*>`, 'gi'))]
    .map((match) => xmlText(match[1], 'time'))
    .filter((time): time is string => !!time && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(time) && Number.isFinite(Date.parse(time)));
  const metadata = /<metadata\b[^>]*>([\s\S]*?)<\/metadata>/i.exec(xml)?.[1] ?? '';
  const metadataTime = xmlText(metadata.replace(/<author\b[^>]*>[\s\S]*?<\/author>/gi, ''), 'time');
  const firstTime = times[0] ?? (metadataTime && /^\d{4}-\d{2}-\d{2}T/.test(metadataTime) && Number.isFinite(Date.parse(metadataTime)) ? metadataTime : undefined);
  const stamps = times.map((time) => Date.parse(time));
  const ordered = stamps.length >= 2 && stamps.every((stamp, i) => i === 0 || stamp >= stamps[i - 1]);
  const seconds = ordered ? (stamps.at(-1)! - stamps[0]) / 1000 : 0;
  const author = /<author\b[^>]*>([\s\S]*?)<\/author>/i.exec(metadata)?.[1];
  return {
    activityDate: firstTime?.slice(0, 10),
    elapsedSeconds: seconds > 0 ? seconds : undefined,
    athleteName: author ? xmlText(author, 'name') : undefined,
  };
}
function collectSegment(xml: string, tag: string): GpxPoint[] {
  const re = new RegExp(`<${tag}\\b([^>]*?)(?:\\/\\s*>|>([\\s\\S]*?)<\\/${tag}\\s*>)`, 'gi');
  const points: GpxPoint[] = [];
  for (const match of xml.matchAll(re)) {
    const latText = /\blat\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1];
    const lonText = /\blon\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1];
    const lat = Number(latText), lon = Number(lonText);
    if (!latText?.trim() || !lonText?.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new IpcException('GPX_INVALID_COORD', 'The GPX file contains invalid coordinates');
    }
    const elevation = /<ele>([^<]+)<\/ele>/i.exec(match[2] ?? '')?.[1];
    const ele = elevation === undefined ? undefined : Number(elevation);
    const previous = points.at(-1);
    if (previous?.lat === lat && previous.lon === lon) continue;
    points.push(ele !== undefined && Number.isFinite(ele) ? { lat, lon, ele } : { lat, lon });
  }
  return points;
}

function computeBounds(points: GpxPoint[]): GpxBounds {
  let minLat = points[0].lat
  let maxLat = points[0].lat
  let minLon = points[0].lon
  let maxLon = points[0].lon
  for (const p of points) {
    minLat = Math.min(minLat, p.lat)
    maxLat = Math.max(maxLat, p.lat)
    minLon = Math.min(minLon, p.lon)
    maxLon = Math.max(maxLon, p.lon)
  }
  return { minLat, maxLat, minLon, maxLon }
}

function extractTrackName(xml: string): string | undefined {
  const track = /<(?:trk|rte)\b[^>]*>([\s\S]*?)<\/(?:trk|rte)>/i.exec(xml)?.[1];
  const name = track ? xmlText(track.replace(/<(?:trkseg|rtept)\b[\s\S]*/i, ''), 'name') : undefined;
  if (name) return name;
  const metadata = /<metadata\b[^>]*>([\s\S]*?)<\/metadata>/i.exec(xml)?.[1];
  return metadata ? xmlText(metadata.replace(/<author\b[^>]*>[\s\S]*?<\/author>/gi, ''), 'name') : undefined;
}

export function parseGpxXml(xml: string, fileName?: string): GpxImportResult {
  const trimmed = xml.trim()
  if (!trimmed) {
    throw new IpcException('GPX_EMPTY', 'The GPX file is empty')
  }
  if (!trimmed.includes('<gpx') && !trimmed.includes('<trkpt') && !trimmed.includes('<wpt')) {
    throw new IpcException('GPX_INVALID_FORMAT', 'This is not a valid GPX file')
  }

  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new IpcException('GPX_INVALID_FORMAT', 'GPX files with XML entities are not supported');
  let segments = [...xml.matchAll(/<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/gi)].map((m) => collectSegment(m[1], 'trkpt'));
  if (!segments.length) segments = [...xml.matchAll(/<trk\b[^>]*>([\s\S]*?)<\/trk>/gi)].map((m) => collectSegment(m[1], 'trkpt'));
  let pointTag = 'trkpt';
  if (!segments.some((s) => s.length)) { pointTag = 'rtept'; segments = [...xml.matchAll(/<rte\b[^>]*>([\s\S]*?)<\/rte>/gi)].map((m) => collectSegment(m[1], 'rtept')); }
  if (!segments.some((s) => s.length)) { pointTag = 'wpt'; segments = [collectSegment(xml, 'wpt')]; }
  segments = segments.filter((s) => s.length > 0);
  const points = segments.flat();
  if (points.length > 100_000) throw new IpcException('GPX_TOO_LARGE', 'Choose a GPX file with fewer than 100,000 points');
  if (!points.length) throw new IpcException('GPX_NO_TRACK', 'No track points found. Check that the file contains trk, rte, or wpt data.');

  const bounds = computeBounds(points)
  const distanceKm = segments.reduce((sum, segment) => sum + computeTrackDistanceKm(segment), 0)
  const trackName = extractTrackName(xml) ?? fileName?.replace(/\.gpx$/i, '')

  return {
    points,
    segments,
    bounds,
    trackName,
    pointCount: points.length,
    distanceKm,
    ...activityDetails(xml, pointTag),
    suggestedCenter: {
      lat: (bounds.minLat + bounds.maxLat) / 2,
      lon: (bounds.minLon + bounds.maxLon) / 2
    }
  }
}
