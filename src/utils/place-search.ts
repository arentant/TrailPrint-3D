export interface MapPlace {
  lat: number;
  lon: number;
  label: string;
}

const cache = new Map<string, MapPlace[]>();
const MAX_MAP_LATITUDE = 85.0511287798;

export function validMapCoordinates(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= MAX_MAP_LATITUDE && Math.abs(lon) <= 180;
}

/** Decimal latitude, longitude; coordinates never leave the device. */
export function parseMapCoordinates(query: string): MapPlace | null {
  const match = query.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*[,;\s]\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/);
  if (!match) return null;
  const lat = Number(match[1]), lon = Number(match[2]);
  if (!validMapCoordinates(lat, lon)) throw new Error('Enter latitude between −85.05 and 85.05, and longitude between −180 and 180.');
  return { lat, lon, label: `${lat}, ${lon}` };
}

/** Search only on submission, with a small session cache to avoid repeat requests. */
export async function searchMapPlaces(query: string, signal: AbortSignal): Promise<MapPlace[]> {
  const key = query.trim();
  const cached = cache.get(key);
  if (cached) return cached;
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name: key, count: '5', language: 'en', format: 'json' }).toString();
  const response = await fetch(url, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error('Place search is unavailable. Try again or enter latitude, longitude.');
  const data = await response.json();
  if (data.results !== undefined && !Array.isArray(data.results)) throw new Error('Place search returned an invalid response. Try latitude, longitude.');
  const places: MapPlace[] = [];
  for (const result of data.results ?? []) {
    const lat = result?.latitude, lon = result?.longitude;
    if (!validMapCoordinates(lat, lon)) continue;
    const parts = [result.name, result.admin1, result.country];
    const label = [...new Set(parts.filter((part): part is string => typeof part === 'string' && !!part))].join(', ');
    places.push({ lat, lon, label: label || `${lat}, ${lon}` });
  }
  if (cache.size >= 50) cache.delete(cache.keys().next().value!);
  cache.set(key, places.slice(0, 5));
  return cache.get(key)!;
}
