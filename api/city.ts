import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { requireSession } from '../server/auth.js';
import { CityProviderError, fetchCityMapData, validateCityMapRequest } from '../shared/city/map-provider.js';

export const config = { maxDuration: 120 };
const MAX_BODY = 2048;
async function readJson(req: IncomingMessage & { body?: unknown }): Promise<unknown> {
  if (req.body !== undefined) {
    if (Buffer.byteLength(typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) > MAX_BODY) throw new CityProviderError('City request is too large', 413);
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new CityProviderError('City request is too large', 413);
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export default async function city(req: IncomingMessage & { body?: unknown }, res: ServerResponse): Promise<void> {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.writeHead(405, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Use POST for city requests' })); return; }
  if (!await requireSession(req, res)) return;
  let body: unknown;
  try { body = await readJson(req); validateCityMapRequest(body); }
  catch (error) { res.writeHead(error instanceof CityProviderError ? error.status : 400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid city request' })); return; }
  try {
    const data = await fetchCityMapData(body, process.env.CITY_OVERPASS_URL || undefined);
    const output = gzipSync(Buffer.from(JSON.stringify(data)));
    if (output.length > 4_400_000) throw new CityProviderError('The city response is too large. Zoom in or choose a smaller selection.', 413);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': output.length }).end(output);
  } catch (error) {
    res.writeHead(error instanceof CityProviderError ? error.status : 502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error instanceof Error ? error.message : 'The city map request failed. Try again later.' }));
  }
}
