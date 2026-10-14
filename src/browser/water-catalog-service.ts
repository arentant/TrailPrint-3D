import type { WaterCatalogRequest } from '@shared/types/water';
import { loadWaterCatalog } from '@shared/water/catalog';
import { loadCityMapData } from './city-map-provider';
export function fetchWaterCatalog(request: WaterCatalogRequest, signal?: AbortSignal) {
  return loadWaterCatalog(request, { loadOsm: loadCityMapData, manifestUrl: import.meta.env.VITE_WATER_CATALOG_URL || undefined, signal });
}
