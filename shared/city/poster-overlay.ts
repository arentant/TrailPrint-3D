import type { CityPictureConfig } from '../types/city';
import type { TerrainCropRegion } from '../types/terrain';

interface PictureStat { key: string; label: string; value: string; suffix: string; icon: string }
const n = (value: number) => String(Math.round(value * 10000) / 10000);
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
const clean = (value: string) => Array.from(String(value ?? '').replace(/[\u0000-\u001f\ufffe\uffff]/g, ' ').trim()).slice(0, 60).join('');

/** Find a horizontal inset that keeps both corners of a card inside the crop. */
function insetSpan(crop: TerrainCropRegion, outline: ReadonlyArray<ReadonlyArray<number>> | null, y: number, height: number, padding: number) {
  const w = crop.widthMm, h = crop.heightMm;
  let left = 0, right = w;
  const samples = [y, y + height];
  if (outline) {
    const vertices = outline.map(([x, py]) => [w / 2 + x, h / 2 - py]);
    samples.push(...vertices.map((p) => p[1]).filter((py) => py > y && py < y + height));
    for (const py of samples) {
      const intersections: number[] = [];
      vertices.forEach(([x1, y1], i) => {
        const [x2, y2] = vertices[(i + 1) % vertices.length];
        if (py < Math.min(y1, y2) || py > Math.max(y1, y2)) return;
        if (Math.abs(y1 - y2) < 1e-8) intersections.push(x1, x2);
        else intersections.push(x1 + (py - y1) / (y2 - y1) * (x2 - x1));
      });
      if (intersections.length) { left = Math.max(left, Math.min(...intersections)); right = Math.min(right, Math.max(...intersections)); }
    }
  } else {
    const r = crop.radiusMm ?? w / 2;
    for (const py of samples) {
      const half = Math.sqrt(Math.max(0, r * r - (py - h / 2) ** 2));
      left = Math.max(left, w / 2 - half); right = Math.min(right, w / 2 + half);
    }
  }
  return { x: left + padding, width: Math.max(0, right - left - padding * 2) };
}

export function renderCityPosterOverlay(picture: CityPictureConfig, crop: TerrainCropRegion,
  outline: ReadonlyArray<ReadonlyArray<number>> | null, stats: PictureStat[], lines: string[]) {
  const w = crop.widthMm, h = crop.heightMm;
  const mapTop = outline ? Math.min(...outline.map(([, y]) => h / 2 - y)) : 0;
  const mapBottom = outline ? Math.max(...outline.map(([, y]) => h / 2 - y)) : h;
  const mapHeight = mapBottom - mapTop, u = Math.min(w / 120, mapHeight / 100);
  const minimal = picture.layout === 'minimal', dark = picture.theme === 'midnight';
  const ink = dark ? '#f6f2e9' : '#20332c', muted = dark ? '#b7c8c0' : '#5b7164';
  const surface = dark ? '#192b28' : '#fffdf7';
  const rect = (x: number, y: number, width: number, height: number, key: string) =>
    '<rect data-overlay-card="' + key + '" x="' + n(x) + '" y="' + n(y) + '" width="' + n(width) + '" height="' + n(height) + '" rx="' + n(2.4 * u) + '" fill="' + surface + '" fill-opacity=".94" stroke="' + ink + '" stroke-opacity=".14" stroke-width="' + n(.2 * u) + '"/>';
  const text = (x: number, y: number, value: string, size: number, attrs = '') =>
    '<text x="' + n(x) + '" y="' + n(y) + '" font-size="' + n(size) + '" ' + attrs + '>' + escape(value) + '</text>';
  const headerHeight = (lines.length > 1 ? 27 : 20) * u;
  const top = crop.shape === 'rectangle' ? 6 * u : mapTop + mapHeight * .1;
  const header = insetSpan(crop, outline, top, headerHeight, 3 * u);
  const hasTitle = lines.some((line) => line.trim());
  let content = '';
  if (minimal) {
    content += '<defs><linearGradient id="poster-map-wash" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + surface + '" stop-opacity=".96"/><stop offset=".32" stop-color="' + surface + '" stop-opacity=".72"/><stop offset=".48" stop-color="' + surface + '" stop-opacity="0"/><stop offset=".58" stop-color="' + surface + '" stop-opacity="0"/><stop offset=".82" stop-color="' + surface + '" stop-opacity=".88"/><stop offset="1" stop-color="' + surface + '" stop-opacity=".98"/></linearGradient></defs>';
    content += '<rect width="' + n(w) + '" height="' + n(h) + '" fill="url(#poster-map-wash)"/>';
  }
  if (hasTitle && header.width > 0) {
    if (!minimal) content += rect(header.x, top, header.width, headerHeight, 'title');
    const headerU = Math.min(u, header.width / 12);
    const x = minimal ? w / 2 : header.x + 4 * headerU;
    content += text(x, top + 5 * headerU, minimal ? 'THE CITY · THE RUN' : 'ROUTE JOURNAL', 1.7 * headerU,
      'fill="' + muted + '" letter-spacing="' + n(.5 * headerU) + '" font-weight="600"' + (minimal ? ' text-anchor="middle"' : ''));
    const displayLines = minimal ? lines : lines.map((line) => line.toUpperCase());
    const titleSize = Math.min((minimal ? 8 : 6.8) * headerU, (header.width - 8 * headerU) / Math.max(1, ...displayLines.map((line) => Array.from(line).length * .66)));
    displayLines.forEach((line, i) => {
      content += text(x, top + (13.4 + i * 7.3) * headerU, line, titleSize,
        'font-weight="' + (minimal ? '500' : '750') + '"' + (minimal ? ' font-family="Baskerville, Georgia, serif" text-anchor="middle"' : ''));
    });
    if (minimal) content += '<path d="M' + n(w / 2 - 5 * u) + ' ' + n(top + headerHeight + u) + 'h' + n(10 * u) + '" stroke="#fc4c02" stroke-width="' + n(.7 * u) + '"/>';
  }
  let statsU = u, statsHeight = (minimal ? 19 : 24) * statsU;
  const statsY = crop.shape === 'rectangle' ? h - 6 * u - statsHeight : mapTop + mapHeight * (crop.polygonSides === 3 ? .5 : .71);
  let span = insetSpan(crop, outline, statsY, statsHeight, 3 * u);
  // Narrow polygon corners need smaller cards; adapt the whole card, including its icon.
  for (let i = 0; i < 4; i++) {
    const availableCell = span.width / Math.max(stats.length, 1);
    statsU = Math.min(statsU, availableCell / 12);
    statsHeight = (minimal ? 19 : 24) * statsU;
    span = insetSpan(crop, outline, statsY, statsHeight, 3 * u);
  }
  const athlete = clean(picture.athlete);
  if (athlete) {
    const nameY = statsY - 10 * u, nameHeight = 8 * u;
    const nameSpan = insetSpan(crop, outline, nameY, nameHeight, 3 * u);
    if (minimal) content += text(w / 2, statsY - 4 * u, athlete, Math.min(4 * u, nameSpan.width / Math.max(Array.from(athlete).length * .6, 1)), 'text-anchor="middle" font-weight="600"');
    else {
      const nameU = Math.min(u, nameSpan.width / 22);
      const nameWidth = Math.min(nameSpan.width, 22 * nameU + Array.from(athlete).length * 1.9 * nameU);
      content += rect(nameSpan.x, nameY, nameWidth, nameHeight, 'athlete');
      content += text(nameSpan.x + 3 * nameU, nameY + 5 * u, 'RUN BY', 1.4 * nameU, 'fill="' + muted + '" letter-spacing="' + n(.2 * nameU) + '"');
      content += text(nameSpan.x + 16 * nameU, nameY + 5.3 * u, athlete, Math.min(3.2 * nameU, (nameWidth - 19 * nameU) / Math.max(Array.from(athlete).length * .6, 1)), 'font-weight="600"');
    }
  }
  const gap = minimal ? 0 : 1.5 * statsU;
  const cell = (span.width - gap * Math.max(0, stats.length - 1)) / Math.max(stats.length, 1);
  stats.forEach((stat, i) => {
    const x = span.x + i * (cell + gap), center = x + cell / 2;
    if (!minimal) content += rect(x, statsY, cell, statsHeight, stat.key);
    else if (i > 0) content += '<path d="M' + n(x) + ' ' + n(statsY + 3 * statsU) + 'v' + n(13 * statsU) + '" stroke="' + muted + '" stroke-opacity=".3" stroke-width="' + n(.2 * statsU) + '"/>';
    content += '<g transform="translate(' + n(center - 2.5 * statsU) + ' ' + n(statsY + 2.5 * statsU) + ') scale(' + n(5 * statsU / 24) + ')" stroke="' + muted + '" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round">' + stat.icon + '</g>';
    content += text(center, statsY + 10.8 * statsU, stat.label, 1.45 * statsU, 'text-anchor="middle" letter-spacing="' + n(.22 * statsU) + '" fill="' + muted + '" font-weight="600"');
    const value = stat.value + stat.suffix;
    content += text(center, statsY + 17 * statsU, value, Math.min((stat.key === 'date' ? 3 : 3.8) * statsU, (cell - 3 * statsU) / Math.max(Array.from(value).length * .64, 1)), 'text-anchor="middle" font-weight="650"');
  });
  const creditY = crop.shape === 'rectangle' ? h - 2 * u : mapTop + mapHeight * .96;
  const credit = 'Map © Esri · OpenStreetMap contributors';
  const creditSpan = insetSpan(crop, outline, creditY - 1.5 * u, 1.5 * u, 2 * u);
  content += text(w / 2, creditY, credit, Math.min(1.15 * u, creditSpan.width / (credit.length * .6)), 'text-anchor="middle" fill="' + muted + '"');
  return '<g id="poster-details" data-layout="' + picture.layout + '" clip-path="url(#poster-overlay-footprint)" fill="' + ink + '" font-family="Avenir Next, Avenir, Montserrat, sans-serif">' + content + '</g>';
}
