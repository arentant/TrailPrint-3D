import type { ModelLogoAsset } from '../types/config';

type Point = { x: number; y: number };
export type LogoTraceMode = 'dark' | 'light' | 'opaque';
const MAX_EDGES = 40_000;
const MAX_POINTS = 8_000;

function simplifyLine(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const first = points[0]!, last = points[points.length - 1]!;
  const dx = last.x - first.x, dy = last.y - first.y, length = dx * dx + dy * dy;
  let maximum = tolerance * tolerance, split = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i]!;
    const t = length ? Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / length)) : 0;
    const distance = (point.x - first.x - t * dx) ** 2 + (point.y - first.y - t * dy) ** 2;
    if (distance > maximum) { maximum = distance; split = i; }
  }
  if (split < 0) return [first, last];
  return [...simplifyLine(points.slice(0, split + 1), tolerance).slice(0, -1), ...simplifyLine(points.slice(split), tolerance)];
}

function simplifyLoop(points: Point[]): Point[] {
  let split = 1, maximum = 0;
  for (let i = 1; i < points.length; i++) {
    const distance = (points[i]!.x - points[0]!.x) ** 2 + (points[i]!.y - points[0]!.y) ** 2;
    if (distance > maximum) { maximum = distance; split = i; }
  }
  return [...simplifyLine(points.slice(0, split + 1), 0.55).slice(0, -1),
    ...simplifyLine([...points.slice(split), points[0]!], 0.55).slice(0, -1)];
}

/** Trace filled pixel boundaries, including counters, without a remote service. */
export function traceLogoPixels(rgba: Uint8ClampedArray, width: number, height: number, name: string,
  mode: LogoTraceMode = 'dark'): ModelLogoAsset {
  if (![width, height].every(v => Number.isInteger(v) && v > 0 && v <= 512) || rgba.length !== width * height * 4) throw new Error('The logo image could not be read.');
  const pixels = new Uint8Array(width * height);
  let minX = width, maxX = 0, minY = height, maxY = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, alpha = rgba[i + 3]! / 255;
    const light = (0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!) / 255;
    const weight = mode === 'opaque' ? alpha : alpha * (mode === 'light' ? light : 1 - light);
    if (weight < 0.5) continue;
    pixels[y * width + x] = 1;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x + 1); minY = Math.min(minY, y); maxY = Math.max(maxY, y + 1);
  }
  if (minX === width) throw new Error('No logo shapes found. Try Light shapes or Opaque shapes, or choose a high-contrast logo.');
  const edges = new Map<number, number[]>();
  const stride = width + 1;
  let edgeCount = 0;
  const add = (x: number, y: number, nx: number, ny: number) => {
    if (++edgeCount > MAX_EDGES) throw new Error('This logo is too detailed. Use a simpler, high-contrast SVG or PNG.');
    const key = y * stride + x, next = ny * stride + nx;
    const existing = edges.get(key);
    if (existing) existing.push(next); else edges.set(key, [next]);
  };
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && pixels[y * width + x] === 1;
  for (let y = minY; y < maxY; y++) for (let x = minX; x < maxX; x++) if (filled(x, y)) {
    if (!filled(x, y - 1)) add(x, y, x + 1, y);
    if (!filled(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!filled(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!filled(x - 1, y)) add(x, y + 1, x, y);
  }
  const point = (key: number): Point => ({ x: key % stride, y: Math.floor(key / stride) });
  const direction = (a: number, b: number) => b === a + 1 ? 0 : b === a + stride ? 1 : b === a - 1 ? 2 : 3;
  const contours: Point[][] = [];
  let count = 0;
  while (edges.size) {
    const start = edges.keys().next().value!;
    let current = start, previousDirection = -1;
    const loop: Point[] = [];
    do {
      loop.push(point(current));
      const candidates = edges.get(current);
      if (!candidates?.length || loop.length > MAX_EDGES) throw new Error('The logo outline could not be closed. Try a cleaner image.');
      // At diagonal contacts, follow the right turn to keep distinct outlines.
      const rank = (next: number) => {
        const turn = (direction(current, next) - previousDirection + 4) % 4;
        return [1, 0, 3, 2][turn]!;
      };
      if (candidates.length > 1 && previousDirection >= 0) candidates.sort((a, b) => rank(a) - rank(b));
      const next = candidates.shift()!;
      if (!candidates.length) edges.delete(current);
      previousDirection = direction(current, next); current = next;
    } while (current !== start);
    const simplified = simplifyLoop(loop);
    if (simplified.length < 3) continue;
    count += simplified.length;
    if (count > MAX_POINTS || contours.length >= 256) throw new Error('This logo has too many outlines. Use a simpler logo with fewer small details.');
    contours.push(simplified.map(p => ({ x: (p.x - (minX + maxX) / 2) / (maxX - minX), y: ((minY + maxY) / 2 - p.y) / (maxX - minX) })));
  }
  if (!contours.length) throw new Error('The logo is too small to trace. Choose a clearer image.');
  return { name: name.slice(0, 160), aspectRatio: (maxX - minX) / (maxY - minY), traceMode: mode, contours };
}
