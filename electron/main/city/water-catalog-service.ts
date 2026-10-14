import type { WaterCatalogRequest } from '@shared/types/water';
import { loadWaterCatalog } from '@shared/water/catalog';
import { loadCityMapData } from './city-map-provider';
declare const __TRAILPRINT_WATER_CATALOG_URL__: string;
export function fetchWaterCatalog(request: WaterCatalogRequest, signal?: AbortSignal) {
  const builtUrl = typeof __TRAILPRINT_WATER_CATALOG_URL__ === 'string' ? __TRAILPRINT_WATER_CATALOG_URL__ : '';
  return loadWaterCatalog(request, { loadOsm: loadCityMapData, manifestUrl: process.env.WATER_CATALOG_URL || builtUrl || undefined, signal });
}
