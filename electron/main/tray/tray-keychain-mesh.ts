import type { TerrainMeshPayload } from "../../../shared/types/terrain";
import type { TrayFootprint } from "../../../shared/utils/tray-footprint";
import type { TrayKeychainHole } from "../../../shared/utils/tray-keychain-layout";
import type { TrayTextShape } from "../../../shared/utils/tray-text-layout";
import { weldMeshVertices } from "../../../shared/utils/mesh-manifold";
import { magnetPocketVertsMm } from "../../../shared/utils/magnet-hole-geometry";
import type { TrayMagnetCutSpec } from "./tray-csg-mesh";
import { appendPlanarCap } from "./planar-cap";

/** Open both tray caps and join the bore wall, retaining labels and magnet pockets. */
export function applyTrayKeychainHole(
  mesh: TerrainMeshPayload, footprint: TrayFootprint, hole: TrayKeychainHole,
  rimZ: number, textShapes: TrayTextShape[], magnet?: TrayMagnetCutSpec,
): TerrainMeshPayload {
  const positions = [...mesh.positions], indices: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const triangle = mesh.indices.slice(t, t + 3);
    const cap = [mesh.bottomZ, rimZ].some(z => triangle.every(i => Math.abs(positions[i * 3 + 2]! - z) < 1e-6));
    if (!cap) indices.push(...triangle);
  }
  const magnetContours = magnet?.holes.map(p => magnetPocketVertsMm(p.x, p.y, magnet.radiusMm, magnet)) ?? [];
  appendPlanarCap(footprint.outer, [hole.contour, ...magnetContours], mesh.bottomZ, positions, indices, false);
  appendPlanarCap(footprint.outer, [footprint.recessInner, hole.contour, ...textShapes.map(s => s.contour)], rimZ, positions, indices);
  for (const shape of textShapes) for (const counter of shape.holes) {
    appendPlanarCap(counter, [], rimZ, positions, indices);
  }
  const low: number[] = [], high: number[] = [];
  for (const p of hole.contour) {
    low.push(positions.length / 3); positions.push(p.x, p.y, mesh.bottomZ);
    high.push(positions.length / 3); positions.push(p.x, p.y, rimZ);
  }
  for (let i = 0; i < hole.contour.length; i++) {
    const j = (i + 1) % hole.contour.length;
    // A through-hole wall faces inward, toward the open bore.
    indices.push(low[i]!, high[i]!, low[j]!, low[j]!, high[i]!, high[j]!);
  }
  return weldMeshVertices({ ...mesh, positions, indices }, 1e-5);
}
