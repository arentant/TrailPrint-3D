import type { TerrainMeshPayload } from "../../../shared/types/terrain";
import type { Vec2, TrayFootprint } from "../../../shared/utils/tray-footprint";
import type { TrayTextShape } from "../../../shared/utils/tray-text-layout";
import { weldMeshVertices } from "../../../shared/utils/mesh-manifold";
import { appendPlanarCap } from "./planar-cap";

/** Raised letters as closed printable solids, seated exactly on the base rim. */
export function buildTrayTextMesh(shapes: TrayTextShape[], rimZ: number, reliefMm: number): TerrainMeshPayload {
  const positions: number[] = [], indices: number[] = [];
  for (const shape of shapes) {
    appendPlanarCap(shape.contour, shape.holes, rimZ, positions, indices, false);
    appendPlanarCap(shape.contour, shape.holes, rimZ + reliefMm, positions, indices);
    for (const loop of [shape.contour, ...shape.holes]) {
      const low = loop.map(p => { const i = positions.length / 3; positions.push(p.x, p.y, rimZ); return i; });
      const high = loop.map(p => { const i = positions.length / 3; positions.push(p.x, p.y, rimZ + reliefMm); return i; });
      for (let i = 0; i < loop.length; i++) {
        const j = (i + 1) % loop.length;
        indices.push(low[i]!, low[j]!, high[i]!, low[j]!, high[j]!, high[i]!);
      }
    }
  }
  return weldMeshVertices({ positions, indices, minSurfaceZ: rimZ + reliefMm, bottomZ: rimZ, gridCols: 0, gridRows: 0 }, 1e-5);
}

/** Replace the rim cap with lettering joined to the tray, with no internal faces. */
export function applyTrayText(
  mesh: TerrainMeshPayload,
  footprint: TrayFootprint,
  shapes: TrayTextShape[],
  rimZ: number,
  reliefMm: number,
): TerrainMeshPayload {
  if (!shapes.length) return mesh;
  const positions = [...mesh.positions];
  const indices: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const triangle = mesh.indices.slice(t, t + 3);
    if (!triangle.every(i => Math.abs(positions[i * 3 + 2]! - rimZ) < 1e-6)) indices.push(...triangle);
  }
  function vertex(p: Vec2, z: number): number {
    const index = positions.length / 3;
    positions.push(p.x, p.y, z);
    return index;
  }
  function cap(contour: Vec2[], holes: Vec2[][], z: number): void {
    appendPlanarCap(contour, holes, z, positions, indices);
  }
  function wall(loop: Vec2[]): void {
    const low = loop.map(p => vertex(p, rimZ));
    const high = loop.map(p => vertex(p, rimZ + reliefMm));
    for (let i = 0; i < loop.length; i++) {
      const j = (i + 1) % loop.length;
      indices.push(low[i]!, low[j]!, high[i]!, low[j]!, high[j]!, high[i]!);
    }
  }
  cap(footprint.outer, [footprint.recessInner, ...shapes.map(s => s.contour)], rimZ);
  for (const shape of shapes) {
    cap(shape.contour, shape.holes, rimZ + reliefMm);
    wall(shape.contour);
    for (const hole of shape.holes) {
      cap(hole, [], rimZ);
      wall(hole);
    }
  }
  // Small letters need a finer weld than the tray's pocket cleanup tolerance.
  return weldMeshVertices({ ...mesh, positions, indices }, 1e-5);
}
