import type { ManifoldToplevel, Vec2, CrossSection } from 'manifold-3d';

export type TrailPathsMm = Array<{ x: number; y: number }> | Array<Array<{ x: number; y: number }>>;

/** Union independent strokes, including overlaps, without connecting their endpoints. */
export function strokeTrailPaths(wasm: ManifoldToplevel, trail: TrailPathsMm, width: number): CrossSection {
  const paths = (Array.isArray(trail[0]) ? trail : [trail]) as Array<Array<{ x: number; y: number }>>;
  const sections: CrossSection[] = [];
  try {
    for (const path of paths) sections.push(strokeSection(wasm, path.map(p => [p.x, p.y]), width));
    return wasm.CrossSection.union(sections);
  } finally { sections.forEach(section => section.delete()); }
}

export function strokeSection(wasm: ManifoldToplevel, points: Vec2[], width: number): CrossSection {
  const { CrossSection: CS } = wasm;
  const radius = width / 2, circle = CS.circle(radius, 16), sections: CrossSection[] = [];
  try {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!, length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 1e-8) continue;
      const nx = (b[1] - a[1]) / length * radius, ny = -(b[0] - a[0]) / length * radius;
      sections.push(new CS([[[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]], 'EvenOdd'),
        circle.translate(a), circle.translate(b));
    }
    return CS.union(sections);
  } finally { circle.delete(); sections.forEach(s => s.delete()); }
}
