import type { ManifoldToplevel, Vec2, CrossSection } from 'manifold-3d';

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
