import type { GpxBounds, GpxPoint } from '@shared/types'
import type { GpxImportResult } from '@shared/types/gpx'
import { IpcException } from '@shared/ipc/types'
import { computeTrackDistanceKm } from '../../electron/main/gpx/distance'

const NAME_RE = /<name>([^<]+)<\/name>/i;
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
  const trkName = xml.match(/<trk>[\s\S]*?<name>([^<]+)<\/name>/i)
  if (trkName) return trkName[1].trim()
  const metaName = xml.match(/<metadata>[\s\S]*?<name>([^<]+)<\/name>/i)
  if (metaName) return metaName[1].trim()
  const docName = xml.match(NAME_RE)
  return docName ? docName[1].trim() : undefined
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
  if (!segments.some((s) => s.length)) segments = [...xml.matchAll(/<rte\b[^>]*>([\s\S]*?)<\/rte>/gi)].map((m) => collectSegment(m[1], 'rtept'));
  if (!segments.some((s) => s.length)) segments = [collectSegment(xml, 'wpt')];
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
    suggestedCenter: {
      lat: (bounds.minLat + bounds.maxLat) / 2,
      lon: (bounds.minLon + bounds.maxLon) / 2
    }
  }
}

