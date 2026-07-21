import type { AppConfig, BaseShape } from "../types/config";
import { physicalFootprintMm } from "./crop-region";
import { regularPolygonVertexAngleRad } from "./footprint";
import {
  clampCornerRadiusMm,
  roundedRectanglePolygon,
  roundedRegularPolygon,
} from "./rounded-footprint";
import type { Vec2 } from "./tray-footprint";

export interface MoldKitOutline {
  shape: BaseShape;
  verts: Vec2[];
}

function regularPolygonVertices(n: number, radius: number): Vec2[] {
  const verts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = regularPolygonVertexAngleRad(i, n);
    verts.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
  }
  return verts;
}

function scaleVerts(verts: Vec2[], scale: number): Vec2[] {
  return verts.map((v) => ({ x: v.x * scale, y: v.y * scale }));
}

/**
 * 山体打印外轮廓外扩 outsetMm（同形：圆/矩形/正多边形 + R 角）。
 * 与托盘 rim 外扩算法一致，保证裙边 / 盖板与主模型轮廓对齐。
 */
export function outsetTerrainPrintByMm(
  config: AppConfig,
  outsetMm: number,
): MoldKitOutline {
  const d = Math.max(0, outsetMm);
  const { mapCrop } = config;
  const foot = physicalFootprintMm(mapCrop);

  if (mapCrop.shape === "circle") {
    const terrainR = foot.radiusMm ?? foot.widthMm / 2;
    return {
      shape: "circle",
      verts: regularPolygonVertices(48, terrainR + d),
    };
  }

  if (mapCrop.shape === "rectangle") {
    const terrainHw = mapCrop.lengthMm / 2;
    const terrainHh = mapCrop.widthMm / 2;
    const cornerR = clampCornerRadiusMm(mapCrop.cornerRadiusMm, mapCrop);
    return {
      shape: "rectangle",
      verts: roundedRectanglePolygon(terrainHw + d, terrainHh + d, cornerR + d),
    };
  }

  const n = Math.max(3, Math.min(8, Math.round(mapCrop.polygonSides)));
  const terrainR = foot.radiusMm ?? foot.widthMm / 2;
  const cornerR = clampCornerRadiusMm(mapCrop.cornerRadiusMm, mapCrop);
  const terrainVerts = roundedRegularPolygon(n, terrainR, cornerR);
  if (d <= 0 || terrainR <= 0) {
    return { shape: "polygon", verts: terrainVerts };
  }
  return {
    shape: "polygon",
    verts: scaleVerts(terrainVerts, (terrainR + d) / terrainR),
  };
}

/** 裙边外轮廓 */
export function computeMoldSkirtOuter(config: AppConfig): MoldKitOutline {
  return outsetTerrainPrintByMm(config, config.moldKit.skirtWidthMm);
}

/**
 * 盖板外轮廓 = 山体外扩 lidWidthMm 后再内缩 lidClearanceMm
 * （等价于外扩 lidWidthMm - lidClearanceMm）。
 */
export function computeMoldLidOuter(config: AppConfig): MoldKitOutline {
  const { lidWidthMm, lidClearanceMm } = config.moldKit;
  return outsetTerrainPrintByMm(config, lidWidthMm - lidClearanceMm);
}
