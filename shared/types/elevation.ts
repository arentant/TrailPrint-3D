/** Each float32 response fits below the hosting limit, even without compression. */
export const MAX_ELEVATION_RESPONSE_SAMPLES = 1024 * 1024;

/** Rows within the original grid; coordinates still use its full dimensions. */
export interface ElevationSampleWindow {
  rowStart: number;
  rowCount: number;
}
