import type { TerrainMeshPayload } from "@shared/types/terrain";
import {
  magnetPocketVertsMm,
  type MagnetPocketProfile,
} from "../../../shared/utils/magnet-hole-geometry";

function pointInTri2D(
  px: number,
  py: number,
  i0: number,
  i1: number,
  i2: number,
  pos: number[],
): boolean {
  const ax = pos[i0 * 3]!;
  const ay = pos[i0 * 3 + 1]!;
  const bx = pos[i1 * 3]!;
  const by = pos[i1 * 3 + 1]!;
  const cx = pos[i2 * 3]!;
  const cy = pos[i2 * 3 + 1]!;
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
  const hasPos = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
  return !(hasNeg && hasPos);
}

/** 底面某点是否被底板三角面覆盖（用于诊断镂空） */
export function bottomPlateCoversPoint(
  mesh: TerrainMeshPayload,
  px: number,
  py: number,
): boolean {
  const pos = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const i0 = mesh.indices[t]!;
    const i1 = mesh.indices[t + 1]!;
    const i2 = mesh.indices[t + 2]!;
    const z0 = pos[i0 * 3 + 2]!;
    const z1 = pos[i1 * 3 + 2]!;
    const z2 = pos[i2 * 3 + 2]!;
    if (
      Math.abs(z0 - mesh.bottomZ) > 1e-3 ||
      Math.abs(z1 - mesh.bottomZ) > 1e-3 ||
      Math.abs(z2 - mesh.bottomZ) > 1e-3
    ) {
      continue;
    }
    if (pointInTri2D(px, py, i0, i1, i2, pos)) return true;
  }
  return false;
}

export { applyTrayMagnetPockets, countBottomPlateOverHole } from "./tray-bottom-features";

/** 统计每个孔在 z=0 是否有完整开口环（诊断用） */
export function countBottomHoleOpenings(
  mesh: TerrainMeshPayload,
  holes: ReadonlyArray<{ x: number; y: number }>,
  holeRadius: number,
  profile?: MagnetPocketProfile,
): number {
  let count = 0;
  for (const h of holes) {
    const corners = magnetPocketVertsMm(h.x, h.y, holeRadius, profile);
    let matched = 0;
    for (const c of corners) {
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const x = mesh.positions[i]!;
        const y = mesh.positions[i + 1]!;
        const z = mesh.positions[i + 2]!;
        if (Math.abs(z - mesh.bottomZ) > 1e-3) continue;
        if (Math.hypot(x - c.x, y - c.y) < 0.45) {
          matched++;
          break;
        }
      }
    }
    if (matched >= 4) count++;
  }
  return count;
}
