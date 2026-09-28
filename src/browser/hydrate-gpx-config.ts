import type { AppConfig } from '@shared/types'
import { resolveTrailPoints } from '@shared/utils/trail-resolve'

export async function hydrateGpxConfig(config: AppConfig): Promise<AppConfig> {
  if (config.gpx.imported && resolveTrailPoints(config).length < 2) {
    throw new Error('Import your GPX file again to restore its track points')
  }
  return config
}
