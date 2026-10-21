import type { CityGenerateRequest, CityPictureMap, CityPictureImage } from '../types/city';
import type { GeoBounds } from '../utils/map-mm-projection';
import { heightfieldGeoBounds } from '../utils/map-mm-projection';
import { latLngToCrsPoint, crsPointToLatLng } from '../utils/leaflet-projection';
import { citySelectionCrop } from './selection-crop';
import { cityProjector } from './geometry';
import { validateCityMapRequest } from './map-provider';

export const CITY_PICTURE_STYLE = 'https://tiles.openfreemap.org/styles/positron';
export const CITY_MAP_CREDITS = 'OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors · https://www.openstreetmap.org/copyright';
export const CITY_PICTURE_DPI = 600;
export const CITY_PICTURE_PNG_PIXELS = 4096;
export const MAX_PICTURE_PIXELS = 8192;
export const MAX_PICTURE_BYTES = 32 * 1024 * 1024;
const STYLE_DPI = 96;

export type { CityPictureMap } from '../types/city';

export function cityPictureMapPlan(request: CityGenerateRequest, dpi?: number) {
  const crop = citySelectionCrop(request);
  // Small prints still need enough source pixels for a crisp 4K PNG. Size this
  // against the map footprint so poster text/layout edits can reuse the background.
  dpi ??= Math.max(CITY_PICTURE_DPI, CITY_PICTURE_PNG_PIXELS * 25.4 / Math.max(crop.widthMm, crop.heightMm));
  const bounds = heightfieldGeoBounds(crop, 2, 2, request.config.mapCrop, request.viewportWidth, request.viewportHeight, 0);
  validateCityMapRequest({ bounds, buildings: false, roads: false });
  if (![crop.widthMm, crop.heightMm, dpi].every(v => Number.isFinite(v) && v > 0)) throw new Error('Check the map print dimensions.');
  const project = cityProjector(request, crop);
  const nw = project(bounds.minLon, bounds.maxLat), ne = project(bounds.maxLon, bounds.maxLat), sw = project(bounds.minLon, bounds.minLat);
  // Keep cartographic scale (labels, line widths, detail) independent of output DPI.
  const width = Math.max(1, Math.ceil(Math.hypot(ne[0] - nw[0], ne[1] - nw[1]) / 25.4 * STYLE_DPI));
  const height = Math.max(1, Math.ceil(Math.hypot(sw[0] - nw[0], sw[1] - nw[1]) / 25.4 * STYLE_DPI));
  const tl = latLngToCrsPoint(bounds.maxLat, bounds.minLon, 0), br = latLngToCrsPoint(bounds.minLat, bounds.maxLon, 0);
  const scale = Math.min(width / (br.x - tl.x), height / (br.y - tl.y));
  const zoom = Math.log2(scale) - 1; // MapLibre uses a 512px world; Leaflet uses 256px.
  if (!Number.isFinite(zoom) || zoom < 0 || zoom > 24) throw new Error('Choose a city-sized map selection.');
  const cx = (tl.x + br.x) / 2, cy = (tl.y + br.y) / 2;
  const center = crsPointToLatLng(cx, cy, 0);
  // Account for integer CSS dimensions, so embedding never stretches the geography.
  const topLeft = crsPointToLatLng(cx - width / scale / 2, cy - height / scale / 2, 0);
  const bottomRight = crsPointToLatLng(cx + width / scale / 2, cy + height / scale / 2, 0);
  const imageBounds = { minLon: topLeft.lon, maxLat: topLeft.lat, maxLon: bottomRight.lon, minLat: bottomRight.lat };
  const pixelRatio = Math.min(dpi / STYLE_DPI, MAX_PICTURE_PIXELS / Math.max(width, height));
  const pixelWidth = Math.round(width * pixelRatio), pixelHeight = Math.round(height * pixelRatio);
  // This identity crosses IPC. Renderer-only styling must not change its format:
  // the renderer can hot-reload while the export process keeps running.
  const key = JSON.stringify([CITY_PICTURE_STYLE, imageBounds, pixelWidth, pixelHeight]);
  return { bounds: imageBounds, center: [center.lon, center.lat] as [number, number], zoom, width, height, pixelRatio, pixelWidth, pixelHeight, key };
}

/** Validate the renderer-to-worker/IPC boundary, including stale or preview images. */
export function validateCityPictureMap(value: unknown, request: CityGenerateRequest): asserts value is CityPictureMap {
  const map = value as CityPictureMap | undefined;
  const plan = cityPictureMapPlan(request);
  if (!map || map.key !== plan.key || map.pixelWidth !== plan.pixelWidth || map.pixelHeight !== plan.pixelHeight ||
      !map.bounds || (Object.keys(plan.bounds) as Array<keyof GeoBounds>).some(k => map.bounds[k] !== plan.bounds[k])) {
    throw new Error('The print-resolution map is missing or out of date. Reopen the map picture and try again.');
  }
  validateCityPictureImage(map);
}

export function validateCityPictureImage(map: CityPictureImage): void {
  if (!Number.isInteger(map.pixelWidth) || !Number.isInteger(map.pixelHeight) || Math.min(map.pixelWidth, map.pixelHeight) < 1 ||
      Math.max(map.pixelWidth, map.pixelHeight) > MAX_PICTURE_PIXELS || typeof map.dataUrl !== 'string' ||
      map.dataUrl.length > Math.ceil(MAX_PICTURE_BYTES / 3) * 4 + 22 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(map.dataUrl)) {
    throw new Error('Invalid printable map image. Try generating the picture again.');
  }
  // Check the PNG IHDR without decoding or copying the entire high-resolution image.
  const header = Uint8Array.from(atob(map.dataUrl.slice(22, 66)), c => c.charCodeAt(0));
  const view = new DataView(header.buffer);
  if (header.length < 24 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a ||
      view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452 ||
      view.getUint32(16) !== map.pixelWidth || view.getUint32(20) !== map.pixelHeight) {
    throw new Error('The map image does not match its print resolution. Try generating the picture again.');
  }
}
