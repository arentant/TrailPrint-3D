import type { TrayConfig } from "../types/config";
import type { TrayFootprint, Vec2 } from "./tray-footprint";
import { magnetCircleVertsMm } from "./magnet-hole-geometry";
import { pointInPolygon } from "./tray-nfc-layout";

export const KEYCHAIN_MIN_WALL_MM = 2;

export interface TrayKeychainHole {
  center: Vec2;
  radiusMm: number;
  /** Circumscribed hole facets add at most 0.01 mm to the nominal radius. */
  cutRadiusMm: number;
  contour: Vec2[];
}

export function trayRimEdgeCount(footprint: TrayFootprint): number {
  return footprint.shape === "polygon" ? footprint.polygonSides! : 4;
}

function rimFrame(footprint: TrayFootprint, tray: TrayConfig) {
  const angle = -Math.PI / 2 + tray.keychain.edge * 2 * Math.PI / trayRimEdgeCount(footprint);
  const nx = Math.cos(angle), ny = Math.sin(angle);
  const radius = Math.max(...footprint.recessInner.map(p => p.x * nx + p.y * ny)) + tray.rimWidthMm / 2;
  return { angle, nx, ny, radius };
}

export function trayKeychainMaxOffsetMm(footprint: TrayFootprint, tray: TrayConfig): number {
  const { nx, ny, radius } = rimFrame(footprint, tray);
  if (footprint.shape === "circle") return radius * Math.PI / 4;
  if (footprint.shape === "polygon") return radius * Math.tan(Math.PI / trayRimEdgeCount(footprint));
  return Math.max(...footprint.outer.map(p => Math.abs(-ny * p.x + nx * p.y)));
}

function boundaryDistance(point: Vec2, contour: Vec2[]): number {
  return Math.min(...contour.map((a, i) => {
    const b = contour[(i + 1) % contour.length]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
  }));
}

/** Negative means the hole intersects or sits inside this feature's contour. */
export function keychainHolePolygonGapMm(hole: TrayKeychainHole, contour: Vec2[]): number {
  if (pointInPolygon(hole.center.x, hole.center.y, contour)) return -hole.cutRadiusMm;
  return boundaryDistance(hole.center, contour) - hole.cutRadiusMm;
}

export function assertKeychainClearance(hole: TrayKeychainHole, contours: Vec2[][], gapMm: number, message: string): void {
  if (contours.some(contour => keychainHolePolygonGapMm(hole, contour) < gapMm - 1e-8)) throw new Error(message);
}

/** One source for controls, validation, preview and exported through-hole geometry. */
export function computeTrayKeychainHole(footprint: TrayFootprint, tray: TrayConfig): TrayKeychainHole | null {
  const keychain = tray.keychain;
  if (!keychain?.enabled) return null;
  if (!Number.isFinite(keychain.diameterMm) || keychain.diameterMm < 2 || keychain.diameterMm > 10) {
    throw new Error("Keychain hole diameter must be between 2 and 10 mm.");
  }
  if (!Number.isInteger(keychain.edge) || keychain.edge < 0 || keychain.edge >= trayRimEdgeCount(footprint)) {
    throw new Error("Choose an available rim edge for the keychain hole.");
  }
  if (!Number.isFinite(keychain.offsetMm) || Math.abs(keychain.offsetMm) > trayKeychainMaxOffsetMm(footprint, tray)) {
    throw new Error("Keychain hole position is outside the selected rim edge. Reduce its offset.");
  }
  const { angle, nx, ny, radius } = rimFrame(footprint, tray);
  const a = angle + keychain.offsetMm / radius;
  const center = footprint.shape === "circle"
    ? { x: radius * Math.cos(a), y: radius * Math.sin(a) }
    : { x: nx * radius - ny * keychain.offsetMm, y: ny * radius + nx * keychain.offsetMm };
  const radiusMm = keychain.diameterMm / 2;
  const contour = magnetCircleVertsMm(center.x, center.y, radiusMm);
  const cutRadiusMm = Math.hypot(contour[0]!.x - center.x, contour[0]!.y - center.y);
  const hole = { center, radiusMm, cutRadiusMm, contour };
  if (!pointInPolygon(center.x, center.y, footprint.outer)
    || boundaryDistance(center, footprint.outer) - cutRadiusMm < KEYCHAIN_MIN_WALL_MM - 1e-8
    || keychainHolePolygonGapMm(hole, footprint.recessInner) < KEYCHAIN_MIN_WALL_MM - 1e-8) {
    throw new Error("Keep at least 2 mm of base material around the keychain hole. Increase the rim width, reduce the hole diameter, or move it away from a corner.");
  }
  return hole;
}
