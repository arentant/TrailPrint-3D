import type { AppConfig } from "@shared/types";
import type { TerrainMeshPayload } from "@shared/types/terrain";
import type { Vec2 } from "@shared/utils/tray-footprint";
import { computeMoldLidOuter } from "../../../shared/utils/mold-kit-footprint";
import { weldMeshVertices } from "../../../shared/utils/mesh-manifold";
import { mergeMeshPayloads } from "../tray/mesh-merge";
import { buildTrayCoverMesh } from "../tray/tray-cover-mesh";

export interface MoldLidHandleSpec {
  /** 中心 X (mm) */
  cx: number;
  /** 中心 Y (mm) */
  cy: number;
  /** 沿 X 半长 (mm) */
  halfX: number;
  /** 沿 Y 半宽 (mm) */
  halfY: number;
  /** 凸台高度 (mm)，自盖板顶面向上 */
  heightMm: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function vertsBBox(verts: Vec2[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of verts) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  return {
    minX,
    maxX,
    minY,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w,
    h,
  };
}

/**
 * 按盖板外廓自动推算两个对称长方体凸台：
 * - 方便捏起
 * - 可压砝码/重物
 */
export function computeMoldLidHandles(outerVerts: Vec2[]): MoldLidHandleSpec[] {
  const box = vertsBBox(outerVerts);
  const longSide = Math.max(box.w, box.h);
  const shortSide = Math.min(box.w, box.h);
  const alongX = box.w >= box.h;

  // 凸台高度：约 5mm，略随盖板厚度微调
  const heightMm = 5;
  // 短边方向的条宽（握持厚度）
  const barThickness = clamp(shortSide * 0.1, 6, 9);
  // 长边方向的条长
  const barLength = clamp(longSide * 0.42, 16, 40);
  // 两凸台中心距短轴方向的间距
  const halfSpan = clamp(shortSide * 0.18, 8, 22);
  // 距外缘至少留 3mm
  const edgeClear = 3;
  const maxHalfLong = alongX
    ? box.w / 2 - edgeClear
    : box.h / 2 - edgeClear;
  const maxHalfShort = alongX
    ? box.h / 2 - edgeClear
    : box.w / 2 - edgeClear;

  const halfLong = Math.min(barLength / 2, Math.max(4, maxHalfLong));
  const halfShort = Math.min(barThickness / 2, Math.max(2.5, maxHalfShort));
  const span = Math.min(halfSpan, Math.max(0, maxHalfShort - halfShort));

  if (alongX) {
    return [
      {
        cx: box.cx,
        cy: box.cy - span,
        halfX: halfLong,
        halfY: halfShort,
        heightMm,
      },
      {
        cx: box.cx,
        cy: box.cy + span,
        halfX: halfLong,
        halfY: halfShort,
        heightMm,
      },
    ];
  }

  return [
    {
      cx: box.cx - span,
      cy: box.cy,
      halfX: halfShort,
      halfY: halfLong,
      heightMm,
    },
    {
      cx: box.cx + span,
      cy: box.cy,
      halfX: halfShort,
      halfY: halfLong,
      heightMm,
    },
  ];
}

function buildAxisAlignedBoxMesh(
  spec: MoldLidHandleSpec,
  zBottom: number,
): TerrainMeshPayload {
  const zTop = zBottom + spec.heightMm;
  const x0 = spec.cx - spec.halfX;
  const x1 = spec.cx + spec.halfX;
  const y0 = spec.cy - spec.halfY;
  const y1 = spec.cy + spec.halfY;

  // 8 顶点：底 0-3，顶 4-7
  const positions = [
    x0, y0, zBottom,
    x1, y0, zBottom,
    x1, y1, zBottom,
    x0, y1, zBottom,
    x0, y0, zTop,
    x1, y0, zTop,
    x1, y1, zTop,
    x0, y1, zTop,
  ];
  // 底朝下、顶朝上、四侧
  const indices = [
    0, 2, 1, 0, 3, 2, // bottom
    4, 5, 6, 4, 6, 7, // top
    0, 1, 5, 0, 5, 4, // y-
    1, 2, 6, 1, 6, 5, // x+
    2, 3, 7, 2, 7, 6, // y+
    3, 0, 4, 3, 4, 7, // x-
  ];

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
 * 浇注盖板：纯平底板 + 顶面两个长方体凸台（拿取 / 压重）。
 * 底面 Z=0，盖板顶 Z=lidHeightMm，凸台再向上突出。
 */
export function buildMoldLidMesh(config: AppConfig): TerrainMeshPayload {
  const outer = computeMoldLidOuter(config).verts;
  if (outer.length < 3) {
    throw new Error("盖板外轮廓无效，请检查翻模套件外扩与间隙参数");
  }

  const plateH = config.moldKit.lidHeightMm;
  const plate = buildTrayCoverMesh({
    outerVerts: outer,
    ledPockets: [],
    ledPocketLengthMm: 1,
    ledPocketWidthMm: 1,
    thicknessMm: plateH,
  });

  const handles = computeMoldLidHandles(outer);
  const handleMeshes = handles.map((h) => buildAxisAlignedBoxMesh(h, plateH));
  const merged = mergeMeshPayloads([plate, ...handleMeshes]);

  let topZ = plateH;
  for (const h of handles) topZ = Math.max(topZ, plateH + h.heightMm);

  return {
    ...merged,
    minSurfaceZ: topZ,
    bottomZ: 0,
    gridCols: 0,
    gridRows: 0,
  };
}
