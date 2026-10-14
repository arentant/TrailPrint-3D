import osmtogeojson from 'osmtogeojson';
import type { CityMapData, CityMapDataRequest } from '../types/city';
import type { WaterAttribution, WaterCatalog, WaterCatalogRequest, WaterFeature, WaterGeometry, WaterManifest } from '../types/water';
import { computeTerrainCropRegion } from '../utils/crop-region';
import { readIndexedWater } from './indexed-reader';
import { cropSelectionFrame } from '../utils/crop-selection';

export const OSM_WATER_ATTRIBUTION: WaterAttribution = { id: 'osm', version: 'live',
  attribution: '© OpenStreetMap contributors', license: 'ODbL', url: 'https://www.openstreetmap.org/copyright' };

export function waterCatalogKey(request: WaterCatalogRequest): string {
  const frame = cropSelectionFrame(request.mapCrop, request.viewportWidth, request.viewportHeight);
  return JSON.stringify([{ ...frame.mapCrop, mapPaneX: frame.mapCrop.mapPaneX ?? 0, mapPaneY: frame.mapCrop.mapPaneY ?? 0 }, frame.width, frame.height]);
}

export function validateWaterGeometry(geometry: unknown): asserts geometry is WaterGeometry {
  const g = geometry as WaterGeometry;
  const depths: Record<string, number> = { LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 };
  if (!g || !depths[g.type]) throw new Error('Unsupported water geometry.');
  let count = 0;
  const visit = (value: unknown, depth: number) => {
    if (!Array.isArray(value) || value.length < (depth === 0 ? 2 : 1)) throw new Error('Incomplete water geometry.');
    if (depth) { value.forEach(v => visit(v, depth - 1)); return; }
    if (!Number.isFinite(value[0]) || !Number.isFinite(value[1]) || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) throw new Error('Invalid water coordinates.');
    if (++count > 1_000_000) throw new Error('Water feature is too detailed.');
  };
  visit(g.coordinates, depths[g.type]!);
}

export function osmWaterFeatures(data: CityMapData, version = 'live'): WaterFeature[] {
  const converted = osmtogeojson(data as Parameters<typeof osmtogeojson>[0], { flatProperties: false });
  const features: WaterFeature[] = [];
  for (const feature of converted.features) {
    const p = feature.properties as { tags?: Record<string, string>; tainted?: boolean; id?: number; type?: string };
    const t = p.tags ?? {};
    if (t.natural !== 'water' && t.landuse !== 'reservoir' && !['riverbank', 'river', 'stream', 'canal'].includes(t.waterway ?? '')) continue;
    try { validateWaterGeometry(feature.geometry); } catch { continue; }
    const rawId = String(feature.id ?? `${p.type}/${p.id}`);
    const width = /^\s*(\d+(?:\.\d+)?)\s*(m|ft)?\s*$/.exec(t.width ?? t['width:waterway'] ?? '');
    const widthM = width ? Number(width[1]) * (width[2] === 'ft' ? 0.3048 : 1) : undefined;
    features.push({ id: `osm:${rawId}`, sourceId: rawId, name: t.name || t['name:en'] || `Unnamed ${t.water || t.waterway || 'water'}`,
      category: t.water === 'reservoir' || t.landuse === 'reservoir' ? 'reservoir'
        : t.water === 'river' || t.water === 'stream' || t.water === 'canal' || t.waterway ? 'river' : 'lake',
      geometry: feature.geometry, complete: !p.tainted && (!feature.geometry.type.includes('Line') || ['river', 'stream', 'canal'].includes(t.waterway ?? '')),
      source: { ...OSM_WATER_ATTRIBUTION, version },
      ...(widthM && widthM > 0 ? { widthM } : {}) });
  }
  return features;
}

export function validateWaterManifest(value: unknown): asserts value is WaterManifest {
  const m = value as WaterManifest;
  if (m?.schemaVersion !== 1 || !m.version || !Array.isArray(m.datasets) || m.datasets.length > 64) throw new Error('Invalid water catalog manifest.');
  for (const d of m.datasets) {
    if (!['hydrolakes', 'grwl', 'coastline', 'osm'].includes(d.id) || !d.version || !d.attribution || !d.license || !d.sourceUrl ||
      !/^[a-f0-9]{64}$/.test(d.sha256) || !(d.bytes > 0) || !(d.featureCount > 0) || !d.url ||
      !d.bounds || !Object.values(d.bounds).every(Number.isFinite) || d.bounds.minLon >= d.bounds.maxLon || d.bounds.minLat >= d.bounds.maxLat) {
      throw new Error('Water manifest contains an unvalidated dataset.');
    }
  }
}

const cache = new Map<string, { value: WaterCatalog; time: number }>();
export async function loadWaterCatalog(request: WaterCatalogRequest, options: {
  loadOsm: (request: CityMapDataRequest, options?: { signal?: AbortSignal; refresh?: boolean }) => Promise<CityMapData>;
  manifestUrl?: string;
  signal?: AbortSignal;
}): Promise<WaterCatalog> {
  options.signal?.throwIfAborted();
  const key = waterCatalogKey(request), cacheKey = `${options.manifestUrl ?? ''}:${key}`;
  const hit = cache.get(cacheKey);
  if (!request.refresh && hit && Date.now() - hit.time < 5 * 60_000) return hit.value;
  const crop = computeTerrainCropRegion(request.mapCrop, request.viewportWidth, request.viewportHeight);
  const bounds = { minLat: crop.minLat, maxLat: crop.maxLat, minLon: crop.minLon, maxLon: crop.maxLon };
  const value: WaterCatalog = { key, features: [], sources: [], errors: [], fetchedAt: new Date().toISOString() };
  const tasks: Array<Promise<void>> = [];
  tasks.push((async () => {
    try {
      const data = await options.loadOsm({ bounds, buildings: false, roads: false, water: true }, { signal: options.signal, refresh: request.refresh });
      const version = data.osm3s?.timestamp_osm_base ?? value.fetchedAt;
      value.features.push(...osmWaterFeatures(data, version));
      value.sources.push({ ...OSM_WATER_ATTRIBUTION, version });
    } catch (error) { value.errors.push({ source: 'OpenStreetMap', message: error instanceof Error ? error.message : String(error) }); }
  })());
  tasks.push((async () => {
    if (!options.manifestUrl) {
      value.errors.push({ source: 'Indexed water catalog', message: 'Large-lake, river-width and sea coverage is not configured.' }); return;
    }
    try {
      const response = await fetch(options.manifestUrl, { signal: options.signal, cache: request.refresh ? 'reload' : 'default' });
      if (!response.ok) throw new Error(`Water catalog manifest failed (${response.status}).`);
      if (Number(response.headers.get('content-length')) > 256_000) throw new Error('Water manifest is too large.');
      const manifest: unknown = await response.json(); validateWaterManifest(manifest);
      await Promise.all(manifest.datasets.map(async dataset => {
        if (dataset.bounds.maxLat < bounds.minLat || dataset.bounds.minLat > bounds.maxLat || dataset.bounds.maxLon < bounds.minLon || dataset.bounds.minLon > bounds.maxLon) return;
        const source = { id: dataset.id, version: dataset.version, attribution: dataset.attribution, license: dataset.license, url: dataset.sourceUrl };
        try {
          const features = await readIndexedWater(new URL(dataset.url, options.manifestUrl).href, bounds, source, options.signal);
          value.features.push(...features); value.sources.push(source);
        } catch (error) { value.errors.push({ source: `${dataset.id} ${dataset.version}`, message: error instanceof Error ? error.message : String(error) }); }
      }));
    } catch (error) { value.errors.push({ source: 'Indexed water catalog', message: error instanceof Error ? error.message : String(error) }); }
  })());
  await Promise.all(tasks);
  options.signal?.throwIfAborted();
  value.features = [...new Map(value.features.map(f => [f.id, f])).values()].sort((a, b) => a.id.localeCompare(b.id));
  value.sources = [...new Map(value.sources.map(source => [`${source.id}:${source.version}:${source.url}`, source])).values()];
  if (value.features.length > 10_000) throw new Error('Too many water features. Choose a smaller crop.');
  if (!value.errors.length) {
    cache.set(cacheKey, { value, time: Date.now() });
    while (cache.size > 8) cache.delete(cache.keys().next().value!);
  }
  return value;
}
