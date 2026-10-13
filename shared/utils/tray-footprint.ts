import type { AppConfig, BaseShape } from "../types/config";
import { physicalFootprintMm } from "./crop-region";
import { regularPolygonVertexAngleRad } from "./footprint";
import {
  clampCornerRadiusMm,
  roundedRectanglePolygon,
  roundedRegularPolygon,
} from "./rounded-footprint";

export interface Vec2 {
  x: number;
  y: number;
}

/** 托盘顶视轮廓（地形外扩 rim / 凹槽公差后的真实几何） */
export interface TrayFootprint {
  shape: BaseShape;
  /** 托盘外轮廓（顶视） */
  outer: Vec2[];
  /** 主模型容纳凹槽内轮廓（含托盘公差） */
  recessInner: Vec2[];
  outerRadius?: number;
  recessRadius?: number;
  /** Logical polygon corners, excluding the vertices used to round them. */
  polygonSides?: number;
  outerHw?: number;
  outerHh?: number;
  recessHw?: number;
  recessHh?: number;
}

function regularPolygonVertices(n: number, radius: number): Vec2[] {
  const verts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = regularPolygonVertexAngleRad(i, n);
    verts.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
  }
  return verts;
}

/** Parallel edge offsets preserve the requested clearance, including fillets. */
function offsetConvexPolygon(verts: Vec2[], distance: number): Vec2[] {
  const normals = verts.map((p, i) => {
    const q = verts[(i + 1) % verts.length]!;
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    return { x: (q.y - p.y) / length, y: (p.x - q.x) / length };
  });
  return verts.map((p, i) => {
    const a = normals[(i + verts.length - 1) % verts.length]!, b = normals[i]!;
    const scale = distance / (1 + a.x * b.x + a.y * b.y);
    return { x: p.x + (a.x + b.x) * scale, y: p.y + (a.y + b.y) * scale };
  });
}

/**
 * 托盘外廓 = 地形打印轮廓外扩 rim；凹槽 = 地形轮廓外扩 trayTolerance。
 * 磁铁孔、托盘网格均以此轮廓为唯一几何来源。
 */
export function computeTrayFootprint(
  config: Pick<AppConfig, "mapCrop" | "tray"> & { assembly: Pick<AppConfig["assembly"], "trayToleranceMm"> },
): TrayFootprint {
  const { mapCrop, tray, assembly } = config;
  const tol = assembly.trayToleranceMm;
  const rim = tray.rimWidthMm;
  const foot = physicalFootprintMm(mapCrop);

  if (mapCrop.shape === "circle") {
    const terrainR = foot.radiusMm ?? foot.widthMm / 2;
    // Circumscribe the circle: an inscribed recess can clip large terrain inserts.
    const segments = 128;
    const recessR = (terrainR + tol) / Math.cos(Math.PI / segments);
    const outerR = (terrainR + tol + rim) / Math.cos(Math.PI / segments);
    return {
      shape: "circle",
      outer: regularPolygonVertices(segments, outerR),
      recessInner: regularPolygonVertices(segments, recessR),
      outerRadius: outerR,
      recessRadius: recessR,
    };
  }

  if (mapCrop.shape === "rectangle") {
    const terrainHw = mapCrop.lengthMm / 2;
    const terrainHh = mapCrop.widthMm / 2;
    const cornerR = clampCornerRadiusMm(mapCrop.cornerRadiusMm, mapCrop);
    const terrainVerts = roundedRectanglePolygon(terrainHw, terrainHh, cornerR);
    const recessHw = terrainHw + tol;
    const recessHh = terrainHh + tol;
    const outerHw = recessHw + rim;
    const outerHh = recessHh + rim;
    return {
      shape: "rectangle",
      outer: offsetConvexPolygon(terrainVerts, tol + rim),
      recessInner: offsetConvexPolygon(terrainVerts, tol),
      outerHw,
      outerHh,
      recessHw,
      recessHh,
    };
  }

  const n = Math.max(3, Math.min(8, Math.round(mapCrop.polygonSides)));
  const terrainR = foot.radiusMm ?? foot.widthMm / 2;
  const cornerR = clampCornerRadiusMm(mapCrop.cornerRadiusMm, mapCrop);
  const terrainVerts = roundedRegularPolygon(n, terrainR, cornerR);
  const outer = offsetConvexPolygon(terrainVerts, tol + rim);
  const recessInner = offsetConvexPolygon(terrainVerts, tol);
  return {
    shape: "polygon",
    polygonSides: n,
    outer,
    recessInner,
    outerRadius: Math.max(...outer.map(v => Math.hypot(v.x, v.y))),
    recessRadius: Math.max(...recessInner.map(v => Math.hypot(v.x, v.y))),
  };
}
