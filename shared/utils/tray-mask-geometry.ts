import type { MapCropConfig, TrayConfig } from "../types/config";
import {
  buildMaskGeometry,
  maskPolygonPoints,
  MASK_FILL_RATIO,
  type MaskScreenGeometry,
} from "./mask-geometry";
import { roundedRectanglePolygon } from "./rounded-footprint";
import { computeTrayFootprint } from "./tray-footprint";

export interface TrayMaskOverlay {
  /** 托盘最外缘（屏幕像素） */
  outer: MaskScreenGeometry;
  /** 外廓相对山体遮罩的缩放比（用于标注） */
  outerScale: number;
}

function terrainRadiusMm(mapCrop: MapCropConfig): number {
  if (mapCrop.shape === "circle") {
    return mapCrop.radiusMm;
  }
  if (mapCrop.shape === "rectangle") {
    return Math.max(mapCrop.lengthMm, mapCrop.widthMm) / 2;
  }
  const n = Math.max(3, Math.min(8, Math.round(mapCrop.polygonSides)));
  const side = mapCrop.polygonSideLengthMm;
  return side / (2 * Math.sin(Math.PI / n));
}

export function buildTrayMaskOverlay(
  mapCrop: MapCropConfig,
  tray: TrayConfig,
  canvasW: number,
  canvasH: number,
  trayToleranceMm = 0.2,
): TrayMaskOverlay | null {
  const inner = buildMaskGeometry(mapCrop, canvasW, canvasH);
  const tR = Math.max(terrainRadiusMm(mapCrop), 1);
  const footprint = computeTrayFootprint({ mapCrop, tray, assembly: { trayToleranceMm } });
  if (inner.kind === "circle" && inner.r) {
    const scale = footprint.outerRadius! / tR;
    return { outer: { ...inner, r: inner.r * scale }, outerScale: scale };
  }
  const scaleX = inner.kind === "rect" ? inner.hw! / (mapCrop.lengthMm / 2) : Math.min(canvasW, canvasH) * MASK_FILL_RATIO / tR;
  const scaleY = inner.kind === "rect" ? inner.hh! / (mapCrop.widthMm / 2) : scaleX;
  const outer: MaskScreenGeometry = {
    kind: "polygon", cx: inner.cx, cy: inner.cy,
    vertices: footprint.outer.map(v => ({ x: inner.cx + v.x * scaleX, y: inner.cy + v.y * scaleY })),
  };
  return {
    outer,
    outerScale: (footprint.outerRadius ?? Math.max(footprint.outerHw!, footprint.outerHh!)) / tR,
  };
}

export function trayOuterOutlinePath(
  overlay: TrayMaskOverlay,
  width: number,
  height: number,
): string {
  const m = overlay.outer;
  if (m.kind === "circle" && m.r) {
    const r = m.r;
    return `M ${m.cx} ${m.cy} m -${r},0 a ${r},${r} 0 1,0 ${r * 2},0 a ${r},${r} 0 1,0 -${r * 2},0 Z`;
  }
  if (m.kind === "rect" && m.hw && m.hh) {
    const cornerR = m.cornerR ?? 0;
    if (cornerR > 0.5) {
      const verts = roundedRectanglePolygon(m.hw, m.hh, cornerR, 6).map((v) => ({
        x: m.cx + v.x,
        y: m.cy + v.y,
      }));
      return (
        verts
          .map((v, i) => (i === 0 ? `M ${v.x} ${v.y}` : `L ${v.x} ${v.y}`))
          .join(" ") + " Z"
      );
    }
    const x1 = m.cx - m.hw;
    const y1 = m.cy - m.hh;
    const x2 = m.cx + m.hw;
    const y2 = m.cy + m.hh;
    return `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2} L ${x1} ${y2} Z`;
  }
  if (m.vertices?.length) {
    return (
      m.vertices
        .map((v, i) => (i === 0 ? `M ${v.x} ${v.y}` : `L ${v.x} ${v.y}`))
        .join(" ") + " Z"
    );
  }
  return "";
}

export function trayOuterPolygonPoints(overlay: TrayMaskOverlay): string {
  const verts = overlay.outer.vertices;
  if (!verts?.length) return "";
  return maskPolygonPoints(verts);
}
