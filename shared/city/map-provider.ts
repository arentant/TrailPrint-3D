import type { CityMapData, CityMapDataRequest } from '../types/city.js';

export const MAX_CITY_BYTES = 24 * 1024 * 1024;
export const MAX_CITY_ELEMENTS = 180_000;
// Overpass pretty-prints JSON; the normalized response below remains capped at 24 MB.
const MAX_CITY_DOWNLOAD_BYTES = 48 * 1024 * 1024;
// Overpass requires scripts to identify the application instead of using a stock client UA.
const CITY_USER_AGENT = 'TrailPrint-3D (+https://github.com/arentant/TrailPrint-3D)';
export class CityProviderError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

export function validateCityMapRequest(value: unknown): asserts value is CityMapDataRequest {
  const r = value as CityMapDataRequest;
  const b = r?.bounds;
  const finite = (n: unknown, limit: number) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit;
  if (!b || !finite(b.minLat, 85) || !finite(b.maxLat, 85) || !finite(b.minLon, 180) || !finite(b.maxLon, 180) ||
      b.minLat >= b.maxLat || b.minLon >= b.maxLon || typeof r.buildings !== 'boolean' || typeof r.roads !== 'boolean') {
    throw new CityProviderError('Invalid city crop bounds or layer settings', 400);
  }
  const widthKm = (b.maxLon - b.minLon) * 111.32 * Math.cos((b.maxLat + b.minLat) / 2 * Math.PI / 180);
  const heightKm = (b.maxLat - b.minLat) * 111.32;
  if (widthKm * heightKm > 2500 || widthKm > 100 || heightKm > 100) {
    throw new CityProviderError('The city selection is too large. Zoom in or crop to a smaller area (up to 2,500 km²).', 413);
  }
}

export function validateCityMapData(value: unknown): asserts value is CityMapData {
  const data = value as CityMapData & { remark?: string };
  if (!data || !Array.isArray(data.elements)) throw new CityProviderError('The map provider returned malformed data. Try again.');
  if (data.remark) throw new CityProviderError('The map provider could not complete this selection. Try a smaller area or try again later.');
  if (data.elements.length > MAX_CITY_ELEMENTS) throw new CityProviderError('Too many map features. Zoom in or choose a smaller city selection.', 413);
  let coordinates = 0;
  const validateGeometry = (geometry: unknown) => {
    if (geometry === undefined) return;
    if (!Array.isArray(geometry)) throw new CityProviderError('The map provider returned malformed geometry.');
    for (const point of geometry) {
      // Overpass uses null for a missing node; osmtogeojson marks that way incomplete.
      if (point === null) continue;
      if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon) || Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180) {
        throw new CityProviderError('The map provider returned invalid coordinates.');
      }
    }
  };
  for (const value of data.elements) {
    const e = value as { type?: string; id?: number; lat?: number; lon?: number; nodes?: unknown[]; members?: unknown[]; geometry?: unknown[] };
    if (!e || !['node', 'way', 'relation'].includes(e.type ?? '') || !Number.isSafeInteger(e.id)) throw new CityProviderError('The map provider returned malformed map elements.');
    if (e.type === 'node' && (!Number.isFinite(e.lat) || !Number.isFinite(e.lon) || Math.abs(e.lat!) > 90 || Math.abs(e.lon!) > 180)) {
      throw new CityProviderError('The map provider returned invalid coordinates.');
    }
    for (const list of [e.nodes, e.members, e.geometry]) {
      if (list !== undefined && !Array.isArray(list)) throw new CityProviderError('The map provider returned malformed geometry.');
      coordinates += list?.length ?? 0;
    }
    validateGeometry(e.geometry);
    for (const member of e.members ?? []) {
      const m = member as { geometry?: unknown[] };
      if (!m) throw new CityProviderError('The map provider returned malformed geometry.');
      validateGeometry(m.geometry);
      coordinates += m.geometry?.length ?? 0;
    }
    if (coordinates > 1_000_000) throw new CityProviderError('Map geometry is too detailed. Choose a smaller selection.', 413);
  }
}

export async function readCityResponse(response: Response, maxBytes = MAX_CITY_BYTES): Promise<CityMapData> {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new CityProviderError('The map download is too large. Choose a smaller selection.', 413);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new CityProviderError('The map provider returned an empty response.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new CityProviderError('The map download is too large. Choose a smaller selection.', 413);
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let data: unknown;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new CityProviderError('The map provider returned malformed data. Try again later.'); }
  validateCityMapData(data);
  return data;
}

const cache = new Map<string, { data: CityMapData; time: number; size: number }>();
const inFlight = new Map<string, Promise<CityMapData>>();
let cacheBytes = 0;
export function clearCityMapCache(): void { cache.clear(); cacheBytes = 0; }

export async function fetchCityMapData(request: CityMapDataRequest, endpoint = 'https://overpass-api.de/api/interpreter'): Promise<CityMapData> {
  validateCityMapRequest(request);
  const url = new URL(endpoint);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new CityProviderError('Configure a valid city map provider endpoint.');
  if (!request.buildings && !request.roads) return { elements: [] };
  const key = JSON.stringify([endpoint, request]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < 10 * 60_000) { cache.delete(key); cache.set(key, hit); return hit.data; }
  const pending = inFlight.get(key);
  if (pending) return pending;
  const operation = (async () => {
    const b = request.bounds;
    const bbox = `${b.minLat},${b.minLon},${b.maxLat},${b.maxLon}`;
    const layers = [request.buildings ? `wr[building][building!=no](${bbox});wr["building:part"]["building:part"!=no](${bbox});` : '',
      request.roads ? `way[highway](${bbox});` : ''].join('');
    // Keep every relation/member way, with complete coordinates on each way.
    // Individual node records are redundant for osmtogeojson and swamp dense crops.
    // Relations reference these ways instead of duplicating their coordinates again.
    const query = `[out:json][timeout:90][maxsize:67108864];(${layers});(._;>>;)->.complete;way.complete;out body geom;rel.complete;out body;`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': CITY_USER_AGENT, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(100_000),
        redirect: 'error',
      });
    }
    catch { throw new CityProviderError('Could not reach the city map provider. Try again later or select a smaller area.'); }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 406) throw new CityProviderError('The city map provider rejected this application request (406). If this continues, check the provider’s access policy or configure CITY_OVERPASS_URL for your own Overpass endpoint.');
      throw new CityProviderError(response.status === 429 ? 'The city map provider is rate limited. Try again later.' : `The city map provider failed (${response.status}). Try again later.`, response.status === 429 ? 429 : 502);
    }
    const data = await readCityResponse(response, MAX_CITY_DOWNLOAD_BYTES);
    const json = JSON.stringify(data);
    if (new TextEncoder().encode(json).byteLength > MAX_CITY_BYTES) throw new CityProviderError('The map data is too large. Choose a smaller selection.', 413);
    const size = json.length * 2;
    if (hit) { cache.delete(key); cacheBytes -= hit.size; }
    cache.set(key, { data, time: Date.now(), size }); cacheBytes += size;
    while (cache.size > 8 || cacheBytes > 48 * 1024 * 1024) {
      const first = cache.keys().next().value!;
      cacheBytes -= cache.get(first)!.size; cache.delete(first);
    }
    return data;
  })();
  inFlight.set(key, operation);
  try { return await operation; } finally { inFlight.delete(key); }
}
