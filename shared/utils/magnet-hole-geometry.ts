import type { MagnetConfig, MagnetHoleShape } from "../types/config";

/** Magnet pockets share the same configurable contour in previews and STL exports. */

export interface Vec2 {
  x: number;
  y: number;
}

const MAX_RADIAL_ERROR_MM = 0.01;

export interface MagnetPocketProfile {
  shape?: MagnetHoleShape;
  lengthMm?: number;
  widthMm?: number;
}

export interface MagnetCutDimensions extends MagnetPocketProfile {
  shape: MagnetHoleShape;
  lengthMm: number;
  widthMm: number;
  /** Round radius / hexagon apothem; rectangular half diagonal. Includes clearance. */
  radiusMm: number;
  /** 含公差的孔深 (mm) */
  depthMm: number;
  /** Nominal round radius / hexagon apothem / rectangular half diagonal (mm). */
  nominalRadiusMm: number;
  /** 磁铁标称厚度 (mm) */
  nominalDepthMm: number;
}

/** STL/CSG 挖孔尺寸：公差仅扩大孔径与孔深，不改变孔位 */
export function magnetCutDimensionsMm(magnet: MagnetConfig): MagnetCutDimensions {
  const tol = Math.max(0, magnet.toleranceMm ?? 0);
  const nominalDepthMm = Math.max(0.5, magnet.thicknessMm);
  const shape = magnet.shape ?? "circle";
  const nominalLengthMm = shape === "rectangle" ? magnet.lengthMm ?? 6 : magnet.diameterMm;
  const nominalWidthMm = shape === "rectangle" ? magnet.widthMm ?? 4 : magnet.diameterMm;
  const lengthMm = nominalLengthMm + tol * 2;
  const widthMm = nominalWidthMm + tol * 2;
  const nominalRadiusMm = shape === "rectangle"
    ? Math.hypot(nominalLengthMm, nominalWidthMm) / 2
    : Math.max(0.5, magnet.diameterMm / 2);
  return {
    shape,
    lengthMm,
    widthMm,
    nominalRadiusMm,
    nominalDepthMm,
    radiusMm: shape === "rectangle" ? Math.hypot(lengthMm, widthMm) / 2 : nominalRadiusMm + tol,
    depthMm: nominalDepthMm + tol,
  };
}

export function magnetPocketVertsMm(
  cx: number,
  cy: number,
  radiusMm: number,
  profile?: MagnetPocketProfile,
): Vec2[] {
  if (profile?.shape === "rectangle") {
    const hx = (profile.lengthMm ?? radiusMm * 2) / 2;
    const hy = (profile.widthMm ?? radiusMm * 2) / 2;
    return [
      { x: cx - hx, y: cy - hy },
      { x: cx + hx, y: cy - hy },
      { x: cx + hx, y: cy + hy },
      { x: cx - hx, y: cy + hy },
    ];
  }
  if (profile?.shape === "hexagon") {
    const r = radiusMm / Math.cos(Math.PI / 6);
    return Array.from({ length: 6 }, (_, i) => {
      const angle = -Math.PI / 2 + i * Math.PI / 3;
      return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
  }
  return magnetCircleVertsMm(cx, cy, radiusMm);
}

/**
 * Approximate a circle closely enough for printing. Circumscribed facets preserve
 * the full requested opening radius, so a round magnet fits even with zero clearance.
 */
export function magnetCircleVertsMm(
  cx: number,
  cy: number,
  magnetRadiusMm: number,
): Vec2[] {
  const radius = Math.max(0.5, magnetRadiusMm);
  const segments = Math.min(128, Math.max(32, Math.ceil(Math.PI / Math.acos(radius / (radius + MAX_RADIAL_ERROR_MM)) / 4) * 4));
  const circumR = radius / Math.cos(Math.PI / segments);
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return { x: cx + circumR * Math.cos(a), y: cy + circumR * Math.sin(a) };
  });
}

export function pointInMagnetCircle(
  px: number,
  py: number,
  cx: number,
  cy: number,
  magnetRadiusMm: number,
): boolean {
  return Math.hypot(px - cx, py - cy) <= magnetRadiusMm + 1e-9;
}

/** 孔内采样点（内切圆内侧），用于检测底面是否遮挡孔口 */
export function magnetHoleInteriorSample(
  cx: number,
  cy: number,
  magnetRadiusMm: number,
  profile?: MagnetPocketProfile,
): Vec2 {
  const halfHeight = profile?.shape === "rectangle" ? (profile.widthMm ?? magnetRadiusMm * 2) / 2 : magnetRadiusMm;
  return { x: cx, y: cy + halfHeight * 0.35 };
}
