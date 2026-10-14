#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { HttpReader } from 'flatgeobuf/lib/mjs/http-reader.js';
import { fromFeature } from 'flatgeobuf/lib/mjs/geojson/feature.js';

const [manifestPath, publicBase] = process.argv.slice(2);
if (!manifestPath) { console.error('Usage: node scripts/water/validate_catalog.mjs <candidate-manifest> [public-bucket-url]'); process.exit(1); }
const absolute = resolve(manifestPath), manifest = JSON.parse(await readFile(absolute, 'utf8'));
if (manifest.schemaVersion !== 1 || !manifest.version || !manifest.datasets?.length) throw new Error('Invalid candidate manifest');
for (const dataset of manifest.datasets) {
  const path = resolve(absolute, '..', dataset.url);
  const file = await stat(path), hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest('hex') !== dataset.sha256 || file.size !== dataset.bytes) throw new Error(`Checksum/size mismatch: ${dataset.url}`);
  const source = { async getRange(begin, length) {
    if (publicBase) {
      const url = new URL(dataset.url, publicBase.endsWith('/') ? publicBase : `${publicBase}/`);
      const response = await fetch(url, { headers: { Range: `bytes=${begin}-${begin + length - 1}` } });
      if (response.status !== 206 || !response.headers.get('content-range')?.startsWith(`bytes ${begin}-`)) { await response.body?.cancel(); throw new Error('Host ignored Range requests'); }
      return response.arrayBuffer();
    }
    const chunks = [];
    for await (const chunk of createReadStream(path, { start: begin, end: begin + length - 1 })) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  } };
  const reader = await HttpReader.openSource(source);
  if (!reader.header.indexNodeSize || reader.header.crs?.code !== 4326 || reader.header.featuresCount !== dataset.featureCount) throw new Error('Invalid index, CRS or feature count');
  const b = dataset.bounds, sample = { minX: b.minLon, minY: b.minLat, maxX: b.minLon + (b.maxLon - b.minLon) / 1000, maxY: b.minLat + (b.maxLat - b.minLat) / 1000 };
  for await (const record of reader.selectBbox(sample)) {
    const feature = fromFeature(record.id, record.feature, reader.header);
    if (!feature.properties.source_id || !feature.geometry) throw new Error('Missing geometry or stable IDs');
  }
  console.log(`Validated ${dataset.id} ${dataset.version}: checksum, index, CRS, feature count and range query`);
}
console.log(publicBase ? 'Remote range checks passed. The candidate manifest can now replace manifest.json.' : 'Local validation passed. Upload immutable files, then repeat with the public bucket URL before updating manifest.json.');
