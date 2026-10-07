import type { CityGenerateRequest } from '../types/city';
import type { TerrainCropRegion } from '../types/terrain';
import { cityFootprint, cityProjector } from './geometry';
import { CITY_MAP_CREDITS, type CityMapTile } from './map-tiles';
import { tileXToLon, tileYToLat } from '../utils/satellite-tiles';

const number = (value: number) => {
  if (!Number.isFinite(value)) throw new Error('The map contains invalid coordinates.');
  return String(Math.round(value * 10000) / 10000);
};

/** Self-contained vector picture. One viewBox unit is one printed millimeter. */
export function renderPrintableCityMap(request: CityGenerateRequest, crop: TerrainCropRegion, tiles: CityMapTile[]): string {
  const project = cityProjector(request, crop);
  const path = (line: number[][], close = false) => line.map(([lon, lat], i) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) throw new Error('The map contains invalid coordinates.');
    const [x, y] = project(lon, lat);
    return `${i ? 'L' : 'M'}${number(x)} ${number(y)}`;
  }).join(' ') + (close ? ' Z' : '');
  const outline = cityFootprint(request, crop);
  const footprint = outline
    ? `<path d="${outline.map(([x, y], i) => `${i ? 'L' : 'M'}${number(x)} ${number(y)}`).join(' ')} Z"/>`
    : `<circle r="${number(crop.radiusMm ?? crop.widthMm / 2)}"/>`;
  const images = tiles.map((tile) => {
    if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(tile.dataUrl)) throw new Error('Invalid street map tile image.');
    const west = tileXToLon(tile.x, tile.zoom), north = tileYToLat(tile.y, tile.zoom);
    const [x, y] = project(west, north);
    const [rightX, rightY] = project(tileXToLon(tile.x + 1, tile.zoom), north);
    const [bottomX, bottomY] = project(west, tileYToLat(tile.y + 1, tile.zoom));
    // Tile pixels and GPX coordinates use the same Mercator-to-model transform.
    const matrix = [(rightX - x) / 256, (rightY - y) / 256, (bottomX - x) / 256, (bottomY - y) / 256, x, y];
    return `<image width="256" height="256" transform="matrix(${matrix.join(' ')})" href="${tile.dataUrl}"/>`;
  }).join('\n');
  const gpx = request.config.gpx;
  const segments = (gpx.segments ?? [gpx.rawPoints?.length ? gpx.rawPoints : gpx.points]).filter((s) => s.length >= 2);
  const routes = segments.map((s) => `<path d="${path(s.map((p) => [p.lon, p.lat]))}"/>`).join('\n');
  const width = crop.widthMm, height = crop.heightMm;
  const cx = width / 2, cy = height / 2;
  // Paper always uses a high-contrast route, independent of 3D material colors.
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${number(width)}mm" height="${number(height)}mm" viewBox="0 0 ${number(width)} ${number(height)}" role="img" aria-label="City running map">
<metadata>${CITY_MAP_CREDITS}</metadata>
<rect width="100%" height="100%" fill="white"/>
<g transform="translate(${number(cx)} ${number(cy)}) scale(1 -1)">
  <defs><clipPath id="city-footprint" clipPathUnits="userSpaceOnUse">${footprint}</clipPath></defs>
  <g clip-path="url(#city-footprint)">
    <g fill="#fafaf7">${footprint}</g>
    <g id="street-map">${images}</g>
    <g id="running-route" fill="none" stroke="#fc4c02" stroke-width="${number(request.config.city.routeWidthMm)}" stroke-linejoin="round" stroke-linecap="round">${routes}</g>
  </g>
</g>
</svg>\n`;
}
