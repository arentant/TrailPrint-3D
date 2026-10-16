import { Color, SRGBColorSpace, type Curve, type Vector2 } from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { ModelLogoAsset } from '@shared/types/config';
import type { LogoTraceMode } from '@shared/utils/logo-trace';
import { getManifold } from '@/browser/manifold-runtime';

const TOO_DETAILED = 'This logo is too detailed. Use a simpler, high-contrast SVG or PNG.';
const elements = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'title', 'desc']);
const attributes = new Set(['id', 'version', 'xmlns', 'viewBox', 'width', 'height', 'preserveAspectRatio',
  'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points', 'transform', 'fill', 'fill-rule', 'stroke']);

/** Preserve filled vector artwork. Browser-rendered effects keep the raster import path. */
export async function traceSvgLogo(source: string, name: string, mode: LogoTraceMode): Promise<ModelLogoAsset | null> {
  const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
  const box = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (!box || box.length !== 4 || !box.every(Number.isFinite) || box[2]! <= 0 || box[3]! <= 0) return null;
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (!elements.has(element.localName) || element !== root && element.localName === 'svg') return null;
    for (const attribute of element.attributes) {
      if (!attributes.has(attribute.name) || attribute.value.includes('%')) return null;
    }
    if (element.hasAttribute('stroke') && element.getAttribute('stroke') !== 'none') return null;
    const fill = element.getAttribute('fill')?.toLowerCase();
    if (fill && fill !== 'none' && !/^#(?:[\da-f]{3}|[\da-f]{6})$/.test(fill) && !Object.hasOwn(Color.NAMES, fill)) return null;
    if (element.hasAttribute('fill-rule') && !['nonzero', 'evenodd'].includes(element.getAttribute('fill-rule')!)) return null;
  }

  const { paths } = new SVGLoader().parse(source);
  // Work in viewBox units so tessellation accuracy does not depend on the SVG's units.
  // At a 200 mm viewBox width this is at most 0.005 mm per curve segment.
  const scale = Math.max(box[2]!, box[3]!);
  const tolerance = 0.000025;
  let count = 0;
  const point = (p: Vector2): [number, number] => [(p.x - box[0]!) / scale, (p.y - box[1]!) / scale];
  const distanceSquared = (p: number[], a: number[], b: number[]) => {
    const dx = b[0]! - a[0]!, dy = b[1]! - a[1]!;
    const t = Math.max(0, Math.min(1, ((p[0]! - a[0]!) * dx + (p[1]! - a[1]!) * dy) / (dx * dx + dy * dy || 1)));
    return (p[0]! - a[0]! - t * dx) ** 2 + (p[1]! - a[1]! - t * dy) ** 2;
  };
  const flatten = (curve: Curve<Vector2>, loop: [number, number][], start = 0, end = 1, depth = 0) => {
    const a = point(curve.getPoint(start)), b = point(curve.getPoint(end));
    const flat = [0.25, 0.5, 0.75].every(t => distanceSquared(point(curve.getPoint(start + (end - start) * t)), a, b) <= tolerance ** 2);
    if (!flat) {
      if (depth >= 16) throw new Error(TOO_DETAILED);
      const middle = (start + end) / 2;
      flatten(curve, loop, start, middle, depth + 1); flatten(curve, loop, middle, end, depth + 1);
    } else {
      if (++count > 40_000) throw new Error(TOO_DETAILED);
      loop.push(b);
    }
  };
  const artwork = paths.filter(path => path.userData?.style.fill !== 'none').map(path => ({
    path,
    loops: path.subPaths.map(subpath => {
      if (!subpath.curves.length) return [];
      const loop = [point(subpath.curves[0]!.getPoint(0))];
      for (const curve of subpath.curves) flatten(curve, loop);
      return loop.filter((p, i) => {
        const next = loop[(i + 1) % loop.length]!;
        return Math.hypot(p[0] - next[0], p[1] - next[1]) > 1e-12;
      });
    }).filter(loop => loop.length >= 3),
  }));
  // The browser clips the root viewport; let it handle artwork crossing that boundary.
  if (artwork.some(({ loops }) => loops.some(loop => loop.some(p => p[0] < 0 || p[1] < 0 || p[0] > box[2]! / scale || p[1] > box[3]! / scale)))) return null;

  const { CrossSection } = await getManifold();
  let section = CrossSection.square(0);
  try {
    for (const { path, loops } of artwork) {
      if (!loops.length) continue;
      const color = path.color.getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace);
      const light = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
      const selected = mode === 'opaque' || (mode === 'light' ? light : 1 - light) >= 0.5;
      const shape = new CrossSection(loops, path.userData?.style.fillRule === 'evenodd' ? 'EvenOdd' : 'NonZero');
      try {
        // Respect paint order, opaque cutouts and overlapping paths before storing EvenOdd contours.
        const next = selected ? section.add(shape) : section.subtract(shape);
        section.delete(); section = next;
      } finally { shape.delete(); }
    }
    const loops = section.toPolygons();
    if (!loops.length) throw new Error('No logo shapes found. Try Light shapes or Opaque shapes, or choose a high-contrast logo.');
    if (loops.length > 256 || loops.reduce((total, loop) => total + loop.length, 0) > 8000) throw new Error(TOO_DETAILED);
    const points = loops.flat();
    const minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0]));
    const minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1]));
    const width = maxX - minX, height = maxY - minY;
    return { name: name.slice(0, 160), aspectRatio: width / height, traceMode: mode,
      contours: loops.map(loop => loop.map(p => ({ x: (p[0] - (minX + maxX) / 2) / width, y: ((minY + maxY) / 2 - p[1]) / width }))) };
  } finally { section.delete(); }
}
