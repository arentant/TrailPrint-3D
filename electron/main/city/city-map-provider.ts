import type { CityMapDataRequest } from '@shared/types/city';
import { fetchCityMapData } from '@shared/city/map-provider';
export function loadCityMapData(request: CityMapDataRequest, options: { signal?: AbortSignal; refresh?: boolean } = {}) {
  return fetchCityMapData(request, process.env.CITY_OVERPASS_URL || undefined, options);
}
