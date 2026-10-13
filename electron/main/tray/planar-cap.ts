import { ShapeUtils, Vector2 } from "three";
import type { Vec2 } from "../../../shared/utils/tray-footprint";

/** A cap with holes, preserving collinear boundary vertices for a closed mesh. */
export function appendPlanarCap(
  contour: Vec2[], holes: Vec2[][], z: number,
  positions: number[], indices: number[], normalUp = true,
): void {
  const vertex = (p: Vec2) => {
    const index = positions.length / 3;
    positions.push(p.x, p.y, z);
    return index;
  };
  const faceIndices = (a: number, b: number, c: number) => {
    if (normalUp) indices.push(a, b, c);
    else indices.push(a, c, b);
  };
  const outer = contour.map(p => new Vector2(p.x, p.y));
  const inner = holes.map(h => h.map(p => new Vector2(p.x, p.y)));
  const vertices = [...outer, ...inner.flat()];
  for (const face of ShapeUtils.triangulateShape(outer, inner)) {
    const triangle = face.map(i => vertices[i]!);
    const [a, b, c] = triangle as [Vector2, Vector2, Vector2];
    if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 1e-12) continue;
    // Earcut may skip collinear glyph corners or bridge aligned openings.
    // Split those edges so the cap shares every vertex with the adjacent walls.
    const boundary: Vec2[] = [];
    for (let e = 0; e < 3; e++) {
      const p = triangle[e]!, q = triangle[(e + 1) % 3]!;
      const dx = q.x - p.x, dy = q.y - p.y, lengthSq = dx * dx + dy * dy;
      const between = vertices.flatMap(v => {
        const t = ((v.x - p.x) * dx + (v.y - p.y) * dy) / lengthSq;
        if (t <= 1e-8 || t >= 1 - 1e-8 || Math.abs((v.x - p.x) * dy - (v.y - p.y) * dx) > 1e-8 * Math.sqrt(lengthSq)) return [];
        return [{ v, t }];
      }).sort((v, w) => v.t - w.t);
      boundary.push(p);
      for (const { v } of between) {
        const last = boundary[boundary.length - 1]!;
        if (Math.hypot(v.x - last.x, v.y - last.y) > 1e-8) boundary.push(v);
      }
    }
    const ring = boundary.map(vertex);
    if (ring.length === 3) faceIndices(ring[0]!, ring[1]!, ring[2]!);
    else {
      const center = vertex({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 });
      for (let i = 0; i < ring.length; i++) faceIndices(center, ring[i]!, ring[(i + 1) % ring.length]!);
    }
  }
}
