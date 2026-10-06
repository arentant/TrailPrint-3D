import type { CityGenerateRequest, CityGenerateResponse, CityGenerateProgress, CityMapData } from '@shared/types/city';
import type { ManifoldToplevel } from 'manifold-3d';
import { computeTerrainCropRegion } from '@shared/utils/crop-region';
import { heightfieldGeoBounds } from '@shared/utils/map-mm-projection';
import { gridResolutionForQuality, demFetchTimeoutMs } from '@shared/utils/terrain-mesh-quality';
import { createCityGeometryBuilder, cityFootprint } from '@shared/city/geometry';
import { validateCityMapRequest } from '@shared/city/map-provider';
import { sampleDemGrid } from '../terrain/dem-provider';
import { prepareElevationHeightfield } from '../terrain/prepare-heightfield';
import { hydrateGpxConfig } from '../gpx/hydrate-gpx-config';
import { getManifold } from './manifold-runtime';
import { loadCityMapData } from './city-map-provider';

export function validateCityGeneration(request: CityGenerateRequest): void {
  const config = request?.config;
  if (!config?.gpx?.imported || !(config.gpx.segments?.some((s) => s.length >= 2) || config.gpx.points?.length >= 2 || config.gpx.rawPoints?.length >= 2)) throw new Error('Import a GPX running route with at least two points.');
  const valid = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;
  const t = config.terrain, c = config.city, m = config.mapCrop;
  if (!t || !c || !m || !['flat', 'real'].includes(c.surface)) throw new Error('Choose Flat or Real terrain.');
  if (!valid(request.viewportWidth, 64, 16384) || !valid(request.viewportHeight, 64, 16384)) throw new Error('The map viewport is too small. Resize the window.');
  if (!['circle', 'rectangle', 'polygon'].includes(m.shape) || ![m.radiusMm, m.lengthMm, m.widthMm, m.polygonSideLengthMm].every((v) => valid(v, 10, 500)) || !valid(m.polygonSides, 3, 8) || !Number.isInteger(m.polygonSides) || !valid(m.cornerRadiusMm, 0, 250) || !valid(m.mapZoom, 1, 22) || !valid(m.mapBearingDeg, -360, 360)) throw new Error('Check the city footprint dimensions and map framing.');
  if (!valid(t.baseSolidThicknessMm, 1, 20) || !valid(c.routeSeatDepthMm, 0.1, t.baseSolidThicknessMm - 0.4) || !valid(c.routeWidthMm, 0.4, 10) || !valid(c.routeReliefMm, 0.2, 10) || !valid(c.routeClearanceMm, 0, 1)) throw new Error('Check route dimensions. Keep at least 0.4 mm of base below the route seat.');
  if (!valid(c.buildingHeightExaggeration, 0.1, 10) || !valid(c.fallbackBuildingHeightM, 1, 100) || !valid(c.roadReliefMm, 0.1, 3)) throw new Error('Check building heights and road relief.');
  if (c.surface === 'real') {
    if (!t.openTopographyApiKey?.trim()) throw new Error('Enter your OpenTopography API key to use Real terrain.');
    if (!valid(t.zExaggeration, 0.1, 10) || !['standard', 'high', 'ultra', 'extreme', 'studio', 'custom'].includes(t.meshQuality) || !['raw', 'light', 'medium', 'heavy'].includes(t.smoothing)) throw new Error('Check terrain quality, smoothing and elevation scale.');
  }
}

let cached: { key: string; result: CityGenerateResponse } | undefined;
// One selection per runtime: trail/solid edits reuse inputs independently of the finalized mesh.
let cachedMap: { key: string; data: CityMapData } | undefined;
let cachedDem: { key: string; elevations: Float64Array } | undefined;
let cachedHeights: { key: string; heights: Float64Array } | undefined;
const flatHeights = new Float64Array(4);
let geometry: { wasm: ManifoldToplevel; builder: ReturnType<typeof createCityGeometryBuilder> } | undefined;
let queue = Promise.resolve();
export function clearCityModelCache(): void {
  cached = undefined; cachedMap = undefined; cachedDem = undefined; cachedHeights = undefined;
  geometry?.builder.dispose(); geometry = undefined;
}
/** Serializes Manifold jobs; retains one finalized model, uncut city, map and elevation grid. */
export function generateCityModel(request: CityGenerateRequest, onProgress?: (p: CityGenerateProgress) => void): Promise<CityGenerateResponse> {
  const job = queue.then(async () => {
    const started = Date.now();
    const config = await hydrateGpxConfig(request.config);
    request = { config, viewportWidth: request.viewportWidth, viewportHeight: request.viewportHeight };
    validateCityGeneration(request);
    // Preview colors do not affect the STL geometry or invalidate its cache.
    const { colors: _colors, ...geometryConfig } = config;
    const key = JSON.stringify({ ...request, config: geometryConfig });
    if (cached?.key === key) { onProgress?.({ phase: 'done', progress: 1, message: 'City model ready' }); return cached.result; }
    cached = undefined;
    onProgress?.({ phase: 'prepare', progress: 0.02, message: 'Preparing city crop…' });
    const crop = computeTerrainCropRegion(config.mapCrop, request.viewportWidth, request.viewportHeight);
    const outline = cityFootprint(request, crop);
    if (outline) {
      // The DEM rectangle must cover the full asymmetric footprint too.
      crop.widthMm = Math.max(crop.widthMm, ...outline.map(([x]) => Math.abs(x) * 2));
      crop.heightMm = Math.max(crop.heightMm, ...outline.map(([, y]) => Math.abs(y) * 2));
    }
    const bounds = heightfieldGeoBounds(crop, 2, 2, config.mapCrop, request.viewportWidth, request.viewportHeight, 0.00015);
    const mapRequest = { bounds, buildings: config.city.buildingsVisible, roads: config.city.roadsVisible };
    validateCityMapRequest(mapRequest);
    const mapKey = JSON.stringify(mapRequest);
    let data: CityMapData;
    if (cachedMap?.key === mapKey) data = cachedMap.data;
    else {
      cachedMap = undefined;
      onProgress?.({ phase: 'map', progress: 0.08, message: 'Fetching OpenStreetMap buildings and roads…' });
      data = await loadCityMapData(mapRequest);
      cachedMap = { key: mapKey, data };
    }
    let cols = 2, rows = 2, heights = flatHeights;
    if (config.city.surface === 'real') {
      ({ cols, rows } = gridResolutionForQuality(crop.widthMm, crop.heightMm, config.terrain.meshQuality, config.terrain.meshQualityCustom));
      // Bound solid boolean work before allocating a potentially huge DEM mesh.
      if (cols * rows > 262_144) throw new Error('City Real terrain supports up to 512 × 512 samples. Choose Extreme quality or a custom grid up to 512.');
      const demKey = JSON.stringify([crop, cols, rows, config.mapCrop, request.viewportWidth, request.viewportHeight,
        config.terrain.demDataset, config.terrain.openTopographyApiKey]);
      if (cachedDem?.key !== demKey) {
        cachedDem = undefined; cachedHeights = undefined;
        onProgress?.({ phase: 'dem', progress: 0.3, message: 'Fetching Real terrain elevation…' });
        const dem = await sampleDemGrid(crop, cols, rows, config.mapCrop, request.viewportWidth, request.viewportHeight, {
          dataset: config.terrain.demDataset, openTopographyApiKey: config.terrain.openTopographyApiKey,
          fetchTimeoutMs: demFetchTimeoutMs(config.terrain.meshQuality, config.terrain.meshQualityCustom),
        });
        cachedDem = { key: demKey, elevations: dem.elevations.slice() };
      }
      const heightKey = JSON.stringify([demKey, config.terrain.smoothing, config.terrain.zExaggeration,
        config.terrain.meshQuality, config.terrain.meshQualityCustom]);
      if (cachedHeights?.key !== heightKey) {
        // Preparation normalizes elevations in place; keep the raw grid intact for later edits.
        heights = prepareElevationHeightfield(cachedDem.elevations.slice(), cols, rows, crop, config.terrain);
        cachedHeights = { key: heightKey, heights };
      } else heights = cachedHeights.heights;
    }
    const wasm = await getManifold();
    if (geometry?.wasm !== wasm) {
      geometry?.builder.dispose();
      geometry = { wasm, builder: createCityGeometryBuilder(wasm) };
    }
    const model = geometry.builder.build(request, crop, data, heights, cols, rows, (stage) => {
      onProgress?.({ phase: 'geometry', progress: stage === 'city' ? 0.55 : 0.8,
        message: stage === 'city' ? 'Fusing city buildings and roads…' : 'Updating the running trail and seating groove…' });
    });
    const result = { ...model, generationMs: Date.now() - started };
    cached = { key, result };
    onProgress?.({ phase: 'done', progress: 1, message: 'City model ready' });
    return result;
  });
  queue = job.then(() => {}, () => {});
  return job;
}
