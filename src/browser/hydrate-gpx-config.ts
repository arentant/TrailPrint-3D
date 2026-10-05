import type { GpxState } from '@shared/types';
export async function hydrateGpxConfig<T extends { gpx: GpxState }>(config: T): Promise<T> {
  if (config.gpx.imported && (config.gpx.rawPoints?.length ?? config.gpx.points?.length ?? 0) < 2) {
    throw new Error('Import your GPX file again to restore its track points');
  }
  return config;
}
