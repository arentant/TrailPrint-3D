import type { CityMapDataRequest } from '@shared/types/city';
import { IpcException } from '@shared/ipc/types';
import { readCityResponse, validateCityMapRequest } from '@shared/city/map-provider';
export async function loadCityMapData(request: CityMapDataRequest) {
  validateCityMapRequest(request);
  const response = await fetch('/api/city', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request), signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    if (response.status === 401) throw new IpcException('UNAUTHENTICATED', 'Your session has ended. Sign in again to continue.');
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `City map request failed (${response.status}). Try again later.`);
  }
  return readCityResponse(response);
}
