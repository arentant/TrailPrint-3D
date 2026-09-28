import type { TerrainMeshPayload } from "@shared/types/terrain";
import type { Vec2 } from "@shared/utils/tray-footprint";
import { computeMoldSkirtOuter } from "../../../shared/utils/mold-kit-footprint";
import { weldMeshVertices } from "../../../shared/utils/mesh-manifold";
import { mergeMeshPayloads } from "../tray/mesh-merge";
import type { AppConfig } from "@shared/types";

function triangulateFan(verts: Vec2[], reverse = false): number[] {
  const indices: number[] = [];
  for (let i = 1; i < verts.length - 1; i++) {
    if (reverse) indices.push(0, i + 1, i);
    else indices.push(0, i, i + 1);
  }
  return indices;
}

function capPolygon(
  verts: Vec2[],
  z: number,
  normalUp: boolean,
  positions: number[],
  indices: number[],
): void {
  const base = positions.length / 3;
  for (const v of verts) {
    positions.push(v.x, v.y, z);
  }
  const tris = triangulateFan(verts, !normalUp);
  for (const t of tris) indices.push(base + t);
}

function extrudeWall(
  verts: Vec2[],
  z0: number,
  z1: number,
  positions: number[],
  indices: number[],
): void {
  const n = verts.length;
  const base = positions.length / 3;
  for (let i = 0; i < n; i++) {
    positions.push(verts[i]!.x, verts[i]!.y, z0);
    positions.push(verts[i]!.x, verts[i]!.y, z1);
  }
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const a = base + i * 2;
    const b = base + next * 2;
    const at = a + 1;
    const bt = b + 1;
    indices.push(a, b, at, b, bt, at);
  }
}

/**
 * 实心裙边底板：外轮廓整片挤出（不镂空）。
 * 顶面 zTop = 浇注停面；底面 zBottom = 停面 - skirtHeight。
 * 山体外缘之外露出的顶面环形区域即溢料台。
 */
export function buildMoldSkirtMesh(
  outer: Vec2[],
  zTop: number,
  zBottom: number,
): TerrainMeshPayload {
  if (outer.length < 3) {
    throw new Error("Invalid skirt outline");
  }
  const positions: number[] = [];
  const indices: number[] = [];

  capPolygon(outer, zTop, true, positions, indices);
  capPolygon(outer, zBottom, false, positions, indices);
  extrudeWall(outer, zBottom, zTop, positions, indices);

  return weldMeshVertices(
    {
      positions,
      indices,
      minSurfaceZ: zTop,
      bottomZ: zBottom,
      gridCols: 0,
      gridRows: 0,
    },
    0.05,
  );
}

/**
 * 翻模主模 = 同次 Terrain_Main（含挖槽、无磁铁）+ 底部实心裙边。
 */
export function buildMoldMasterMesh(
  terrainMesh: TerrainMeshPayload,
  config: AppConfig,
): TerrainMeshPayload {
  const skirtH = config.moldKit.skirtHeightMm;
  const zTop = terrainMesh.bottomZ;
  const zBottom = zTop - skirtH;

  const outerVerts = computeMoldSkirtOuter(config).verts;
  const skirt = buildMoldSkirtMesh(outerVerts, zTop, zBottom);
  const merged = mergeMeshPayloads([terrainMesh, skirt]);
  return {
    ...merged,
    minSurfaceZ: terrainMesh.minSurfaceZ,
    bottomZ: zBottom,
    gridCols: terrainMesh.gridCols,
    gridRows: terrainMesh.gridRows,
  };
}
