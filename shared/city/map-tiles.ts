import type { GeoBounds } from '../utils/map-mm-projection';
import { lonLatToTileXY } from '../utils/satellite-tiles';
import { latLngToCrsPoint } from '../utils/leaflet-projection';

export const CITY_STREET_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';
export const CITY_MAP_CREDITS = 'Sources: Esri, HERE, Garmin, Intermap, increment P Corp., GEBCO, USGS, FAO, NPS, NRCAN, GeoBase, IGN, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), © OpenStreetMap contributors, and the GIS User Community';
export const CITY_PICTURE_DPI = 600;
export const MAX_PICTURE_PIXELS = 8192;
export const MAX_PICTURE_TILES = 512;
const MAX_PICTURE_BYTES = 32 * 1024 * 1024;
export interface CityMapTile { x: number; y: number; zoom: number; dataUrl: string }

/** Print resolution depends on paper size, not how many buildings the city has. */
export function cityPictureTileSelection(bounds: GeoBounds, widthMm: number, heightMm: number) {
  const targetPx = Math.min(MAX_PICTURE_PIXELS, Math.max(1024, Math.ceil(Math.max(widthMm, heightMm) / 25.4 * CITY_PICTURE_DPI)));
  let selected: { zoom: number; tl: { x: number; y: number }; br: { x: number; y: number } } | undefined;
  for (let zoom = 0; zoom <= 19; zoom++) {
    const tl = lonLatToTileXY(bounds.minLon, bounds.maxLat, zoom);
    const br = lonLatToTileXY(bounds.maxLon, bounds.minLat, zoom);
    const cols = br.x - tl.x + 1, rows = br.y - tl.y + 1;
    if (cols * rows > MAX_PICTURE_TILES || Math.max(cols, rows) * 256 > MAX_PICTURE_PIXELS) break;
    selected = { zoom, tl, br };
    const nw = latLngToCrsPoint(bounds.maxLat, bounds.minLon, zoom);
    const se = latLngToCrsPoint(bounds.minLat, bounds.maxLon, zoom);
    // Measure pixels covering the map itself, excluding tile padding outside it.
    if (Math.max(se.x - nw.x, se.y - nw.y) >= targetPx) break;
  }
  if (!selected) throw new Error('Could not frame the printable map. Check the map selection.');
  const { tl, br, zoom } = selected;
  const tiles: Array<{ x: number; y: number; zoom: number }> = [];
  for (let y = tl.y; y <= br.y; y++) for (let x = tl.x; x <= br.x; x++) tiles.push({ x, y, zoom });
  return tiles;
}

let cached: { key: string; tiles: CityMapTile[] } | undefined;
export function clearCityPictureTileCache(): void { cached = undefined; }

export async function loadCityPictureTiles(bounds: GeoBounds, widthMm: number, heightMm: number,
  onProgress?: (complete: number, total: number) => void): Promise<CityMapTile[]> {
  const selection = cityPictureTileSelection(bounds, widthMm, heightMm);
  const key = JSON.stringify(selection);
  if (cached?.key === key) return cached.tiles;
  const tiles = new Array<CityMapTile>(selection.length);
  const controller = new AbortController();
  let next = 0, complete = 0, downloadedBytes = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(4, selection.length) }, async () => {
      while (next < selection.length && !controller.signal.aborted) {
        const index = next++, tile = selection[index]!;
        const url = CITY_STREET_TILE_URL.replace('{z}', String(tile.zoom)).replace('{x}', String(tile.x)).replace('{y}', String(tile.y));
        const response = await fetch(url, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
          ...(typeof navigator === 'undefined' || navigator.userAgent.startsWith('Node.js') ? { headers: { 'User-Agent': 'TrailPrint-3D (+https://github.com/arentant/TrailPrint-3D)' } } : {}),
        });
        if (!response.ok) throw new Error(`The street map tile provider failed (${response.status}). Try the map picture again.`);
        const mime = response.headers.get('content-type')?.split(';')[0];
        if (!mime || !['image/png', 'image/jpeg'].includes(mime)) throw new Error('The street map provider returned an invalid image.');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length || bytes.length > 256 * 1024) throw new Error('The street map provider returned an invalid image size.');
        downloadedBytes += bytes.length;
        if (downloadedBytes > MAX_PICTURE_BYTES) throw new Error('The map image download exceeded 32 MB. Choose a smaller print size.');
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
        tiles[index] = { ...tile, dataUrl: `data:${mime};base64,${btoa(binary)}` };
        onProgress?.(++complete, selection.length);
      }
    }));
  } catch (error) {
    controller.abort();
    throw error instanceof Error && error.name !== 'TimeoutError' && error.name !== 'AbortError'
      ? error : new Error('Could not load the street map picture. Check your connection and try again.');
  }
  cached = { key, tiles };
  return tiles;
}
