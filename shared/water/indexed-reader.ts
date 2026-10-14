import { HttpReader } from 'flatgeobuf/lib/mjs/http-reader.js';
import { fromFeature } from 'flatgeobuf/lib/mjs/geojson/feature.js';
import type { GpxBounds } from '../types/config';
import type { WaterAttribution, WaterFeature } from '../types/water';
import { validateWaterGeometry } from './catalog';

/** Reject servers that ignore Range, before they can download a global file. */
export async function readIndexedWater(url: string, bounds: GpxBounds, source: WaterAttribution, signal?: AbortSignal): Promise<WaterFeature[]> {
  let downloaded = 0;
  let reserved = 0;
  const reader = await HttpReader.openSource({ async getRange(begin, length) {
    signal?.throwIfAborted();
    if (length > 24 * 1024 * 1024 || downloaded + reserved + length > 48 * 1024 * 1024) throw new Error('Water crop download is too large. Zoom in.');
    reserved += length;
    const response = await fetch(url, { headers: { Range: `bytes=${begin}-${begin + length - 1}` }, signal });
    if (response.status !== 206 || !response.headers.get('content-range')?.startsWith(`bytes ${begin}-`)) {
      await response.body?.cancel(); throw new Error('Water host must support HTTP range requests and expose Content-Range.');
    }
    if (Number(response.headers.get('content-length')) > length) { await response.body?.cancel(); throw new Error('Invalid water range response.'); }
    const stream = response.body?.getReader();
    if (!stream) throw new Error('Empty water range response.');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await stream.read(); if (done) break;
        size += value.byteLength;
        if (size > length) throw new Error('Invalid water range response.');
        chunks.push(value);
      }
    } catch (error) { await stream.cancel().catch(() => {}); throw error; }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    downloaded += size; reserved -= length; return bytes.buffer;
  } });
  if (!reader.header.indexNodeSize || reader.header.crs?.code !== 4326) throw new Error('Water dataset needs a spatial index and EPSG:4326 coordinates.');
  const result: WaterFeature[] = [];
  for await (const item of reader.selectBbox({ minX: bounds.minLon, minY: bounds.minLat, maxX: bounds.maxLon, maxY: bounds.maxLat })) {
    signal?.throwIfAborted();
    const feature = fromFeature(item.id, item.feature, reader.header);
    const p = feature.properties;
    validateWaterGeometry(feature.geometry);
    if (!p?.source_id || !['lake', 'reservoir', 'river', 'sea'].includes(p.category)) throw new Error('Dataset is missing stable source IDs or categories.');
    const widthM = Number(p.width_m);
    result.push({ id: `${source.id}:${p.source_id}`, sourceId: String(p.source_id), name: String(p.name || `Unnamed ${p.category}`),
      category: p.category, geometry: feature.geometry, source, complete: p.complete !== false && p.complete !== 0,
      ...(widthM > 0 && Number.isFinite(widthM) ? { widthM } : {}) });
    if (result.length > 10_000) throw new Error('Too many water features. Zoom in.');
  }
  return result;
}
