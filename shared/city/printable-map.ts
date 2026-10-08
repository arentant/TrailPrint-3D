import type { CityGenerateRequest, CityPictureConfig } from '../types/city';
import type { TerrainCropRegion } from '../types/terrain';
import { cityFootprint, cityProjector } from './geometry';
import { CITY_MAP_CREDITS, type CityMapTile } from './map-tiles';
import { tileXToLon, tileYToLat } from '../utils/satellite-tiles';
import { renderCityPosterOverlay } from './poster-overlay';

const number = (value: number) => {
  if (!Number.isFinite(value)) throw new Error('The map contains invalid coordinates.');
  return String(Math.round(value * 10000) / 10000);
};

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
const clean = (value: string, limit = 80) => Array.from(String(value ?? '').replace(/[\u0000-\u001f\ufffe\uffff]/g, ' ').trim()).slice(0, limit).join('');

export function cityPictureLayout(crop: TerrainCropRegion, picture?: CityPictureConfig) {
  const editorial = picture?.enabled && (!picture.layout || picture.layout === 'editorial');
  const margin = editorial ? crop.widthMm * 0.065 : 0;
  const header = editorial ? crop.widthMm * 0.25 : 0;
  const footer = editorial ? crop.widthMm * (clean(picture.athlete) ? 0.34 : 0.24) : 0;
  return { margin, header, footer, width: crop.widthMm + margin * 2, height: crop.heightMm + margin * 2 + header + footer };
}

function pictureStats(picture: CityPictureConfig) {
  const date = clean(picture.date, 20);
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const dateLabel = parts && months[Number(parts[2]) - 1] ? `${parts[3]} ${months[Number(parts[2]) - 1]} ${parts[1]}` : date;
  return [
    { key: 'distance', label: 'DISTANCE', value: clean(picture.distance, 20), suffix: ' km', icon: '<path d="M5 5a2 2 0 1 0 0 .1M19 17a2 2 0 1 0 0 .1M7 5h8a4 4 0 0 1 0 8H9a4 4 0 0 0 0 8h8"/>' },
    { key: 'date', label: 'DATE', value: dateLabel, suffix: '', icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M7 15h2M13 15h2M7 18h2"/>' },
    { key: 'duration', label: 'ELAPSED', value: clean(picture.duration, 20), suffix: '', icon: '<circle cx="12" cy="14" r="8"/><path d="M9 2h6M12 2v4M18 6l2-2M12 10v4l3 2"/>' },
    { key: 'pace', label: 'PACE', value: clean(picture.pace, 20), suffix: ' /km', icon: '<path d="m3 16 5-5 4 3 7-9M14 5h5v5M3 21h18"/>' },
  ].filter((stat) => stat.value);
}

function titleLines(title: string) {
  const words = title.split(/\s+/), lines = [''];
  for (const word of words) {
    if (lines[0].length && lines[0].length + word.length > 21 && lines.length === 1) lines.push(word);
    else lines[lines.length - 1] += (lines[lines.length - 1] ? ' ' : '') + word;
  }
  return lines;
}

function posterLettering(picture: CityPictureConfig, crop: TerrainCropRegion): string {
  const { margin, header, height } = cityPictureLayout(crop, picture);
  const w = crop.widthMm, unit = w / 120;
  const dark = picture.theme === 'midnight';
  const ink = dark ? '#f6f2e9' : '#202c2b', muted = dark ? '#a8b8b4' : '#657671', rule = dark ? '#3c504b' : '#d3d9d1';
  const text = (x: number, y: number, value: string, size: number, attrs = '') => `<text x="${number(x)}" y="${number(y)}" font-size="${number(size)}" ${attrs}>${escape(value)}</text>`;
  const label = (x: number, y: number, value: string) => text(x, y, value, 2.1 * unit, `fill="${muted}" letter-spacing="${number(0.4 * unit)}" font-weight="600"`);
  const title = clean(picture.title).toUpperCase();
  const lines = titleLines(title);
  const titleSize = Math.min(10 * unit, w / Math.max(...lines.map((line) => Array.from(line).length * 0.66), 1));
  let content = label(margin, margin + 2.5 * unit, 'ROUTE JOURNAL');
  content += `<rect x="${number(margin + w - 8 * unit)}" y="${number(margin)}" width="${number(8 * unit)}" height="${number(1.3 * unit)}" fill="#fc4c02"/>`;
  lines.forEach((line, i) => { content += text(margin, margin + (lines.length > 1 ? 14 : 20) * unit + i * 10.5 * unit, line, titleSize, 'font-weight="750"'); });
  const top = margin + header + crop.heightMm + 5 * unit;
  content += `<path d="M${number(margin)} ${number(top)} H${number(margin + w)}" stroke="${rule}" stroke-width="${number(0.25 * unit)}"/>`;
  const athlete = clean(picture.athlete, 60);
  if (athlete) {
    content += label(margin, top + 6 * unit, 'RUN BY');
    content += text(margin, top + 12 * unit, athlete, Math.min(4.6 * unit, w / Math.max(Array.from(athlete).length * 0.6, 1)), 'font-weight="600"');
  }
  const stats = pictureStats(picture);
  const cell = w / Math.max(stats.length, 1), y = top + (athlete ? 20 : 9) * unit;
  stats.forEach((stat, i) => {
    const x = margin + cell * i;
    content += label(x, y, stat.label);
    const value = stat.value + stat.suffix;
    content += text(x, y + 6.5 * unit, value, Math.min((stat.label === 'DATE' ? 3.3 : 4.4) * unit, (cell - 2 * unit) / Math.max(Array.from(value).length * 0.64, 1)), 'font-weight="650"');
  });
  content += text(margin, height - 3 * unit, 'Map © Esri · OpenStreetMap contributors', 1.75 * unit, `fill="${muted}"`);
  return `<g id="poster-details" data-layout="editorial" fill="${ink}" font-family="Avenir Next, Avenir, Montserrat, sans-serif">${content}</g>`;
}

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
  const picture = request.config.picture;
  const { width, height, margin, header } = cityPictureLayout(crop, picture);
  const cx = margin + crop.widthMm / 2, cy = margin + header + crop.heightMm / 2;
  const overlay = picture?.enabled && (picture.layout === 'cards' || picture.layout === 'minimal');
  // Paper always uses a high-contrast route, independent of 3D material colors.
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${number(width)}mm" height="${number(height)}mm" viewBox="0 0 ${number(width)} ${number(height)}" role="img" aria-label="City running map">
<metadata>${CITY_MAP_CREDITS}</metadata>
<rect width="100%" height="100%" fill="${picture?.enabled ? picture.theme === 'midnight' ? '#192b28' : '#f6f3eb' : 'white'}"/>
${overlay ? `<defs><clipPath id="poster-overlay-footprint" clipPathUnits="userSpaceOnUse" transform="translate(${number(cx)} ${number(cy)}) scale(1 -1)">${footprint}</clipPath></defs>` : ''}
<g transform="translate(${number(cx)} ${number(cy)}) scale(1 -1)">
  <defs><clipPath id="city-footprint" clipPathUnits="userSpaceOnUse">${footprint}</clipPath></defs>
  <g clip-path="url(#city-footprint)">
    <g fill="#fafaf7">${footprint}</g>
    <g id="street-map">${images}</g>
    <g id="running-route" fill="none" stroke="#fc4c02" stroke-width="${number(request.config.city.routeWidthMm)}" stroke-linejoin="round" stroke-linecap="round">${routes}</g>
  </g>
</g>
${picture?.enabled ? overlay ? renderCityPosterOverlay(picture, crop, outline, pictureStats(picture), titleLines(clean(picture.title))) : posterLettering(picture, crop) : ''}
</svg>\n`;
}
