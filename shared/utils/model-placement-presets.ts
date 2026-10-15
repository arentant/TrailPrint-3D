import type { AppConfig, ModelFeaturePosition } from '../types/config';
import type { Vec2 } from './tray-footprint';
import { computeTerrainCropRegion } from './crop-region';
import { buildModelTextLayout, computeModelKeychainHole, modelFootprint } from './model-features';
import { assertKeychainClearance } from './tray-keychain-layout';

export const MODEL_PLACEMENT_PRESETS = [
  { id: 'top-left', label: 'Top left', x: -1, y: 1 },
  { id: 'top', label: 'Top', x: 0, y: 1 },
  { id: 'top-right', label: 'Top right', x: 1, y: 1 },
  { id: 'left', label: 'Left', x: -1, y: 0 },
  { id: 'center', label: 'Center', x: 0, y: 0 },
  { id: 'right', label: 'Right', x: 1, y: 0 },
  { id: 'bottom-left', label: 'Bottom left', x: -1, y: -1 },
  { id: 'bottom', label: 'Bottom', x: 0, y: -1 },
  { id: 'bottom-right', label: 'Bottom right', x: 1, y: -1 },
] as const;
export type ModelPlacementPreset = typeof MODEL_PLACEMENT_PRESETS[number]['id'];

/** Clip a convex region to an inward half-plane. */
function clip(region: Vec2[], nx: number, ny: number, minimum: number): Vec2[] {
  const output: Vec2[] = [];
  for (let i = 0; i < region.length; i++) {
    const a = region[i]!, b = region[(i + 1) % region.length]!;
    const da = nx * a.x + ny * a.y - minimum, db = nx * b.x + ny * b.y - minimum;
    if (da >= 0) output.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      output.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return output;
}

function nearestCenter(region: Vec2[], target: Vec2): Vec2 {
  let inside = true, distance = Infinity, nearest = target;
  for (let i = 0; i < region.length; i++) {
    const a = region[i]!, b = region[(i + 1) % region.length]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    if (dx * (target.y - a.y) - dy * (target.x - a.x) < -1e-8) inside = false;
    const t = Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const point = { x: a.x + t * dx, y: a.y + t * dy };
    const nextDistance = (target.x - point.x) ** 2 + (target.y - point.y) ** 2;
    if (nextDistance < distance) { distance = nextDistance; nearest = point; }
  }
  return inside ? target : nearest;
}

/** Snap the item's visible bounds; preserve size, rotation and the other surface. */
export function modelPlacementPresetPosition(config: AppConfig, kind: 'text' | 'logo', surface: 'front' | 'underside',
  presetId: ModelPlacementPreset): ModelFeaturePosition | null {
  const preset = MODEL_PLACEMENT_PRESETS.find(value => value.id === presetId);
  if (!preset) return null;
  const crop = computeTerrainCropRegion(config.mapCrop, 800, 600), layout = buildModelTextLayout(config, crop, false);
  const settings = kind === 'text' ? config.terrain.text : config.terrain.logo;
  const position = surface === 'front' ? settings.frontPosition : settings.undersidePosition;
  const shapes = kind === 'text' ? (surface === 'front' ? layout.front : layout.underside)
    : (surface === 'front' ? layout.logoFront : layout.logoUnderside);
  if (!shapes.length) return null;
  const view = (point: Vec2): Vec2 => ({ x: surface === 'underside' ? -point.x : point.x, y: point.y });
  const points = shapes.flatMap(shape => shape.contour).map(view);
  const markCenter = { x: (Math.min(...points.map(p => p.x)) + Math.max(...points.map(p => p.x))) / 2,
    y: (Math.min(...points.map(p => p.y)) + Math.max(...points.map(p => p.y))) / 2 };
  const centered = points.map(p => ({ x: p.x - markCenter.x, y: p.y - markCenter.y }));
  let area = modelFootprint(crop).map(view);
  let center = { x: 0, y: 0 };
  if (surface === 'front') {
    const frontY = Math.min(...area.map(p => p.y));
    const heights = [layout.front, layout.logoFront].map(mark => {
      const ys = mark.flatMap(shape => shape.contour.map(p => p.y));
      return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
    });
    const depth = Math.max(20, Math.max(...heights) * 2 + 4);
    area = [{ x: -crop.widthMm / 2, y: frontY - depth }, { x: crop.widthMm / 2, y: frontY - depth },
      { x: crop.widthMm / 2, y: frontY }, { x: -crop.widthMm / 2, y: frontY }];
    center = { x: 0, y: frontY - depth / 2 };
  }
  const minX = Math.min(...area.map(p => p.x)), maxX = Math.max(...area.map(p => p.x));
  const minY = Math.min(...area.map(p => p.y)), maxY = Math.max(...area.map(p => p.y));
  let region: Vec2[] = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
  const winding = Math.sign(area.reduce((sum, a, i) => {
    const b = area[(i + 1) % area.length]!; return sum + a.x * b.y - a.y * b.x;
  }, 0));
  for (let i = 0; i < area.length && region.length; i++) {
    const a = area[i]!, b = area[(i + 1) % area.length]!, length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-10) continue;
    const nx = winding * (a.y - b.y) / length, ny = winding * (b.x - a.x) / length;
    let support = Infinity;
    for (const point of centered) support = Math.min(support, nx * point.x + ny * point.y);
    region = clip(region, nx, ny, nx * a.x + ny * a.y + 2.001 - support);
  }
  if (region.length < 3) return null;
  center = nearestCenter(region, center);
  const target = { x: preset.x < 0 ? minX : preset.x > 0 ? maxX : center.x,
    y: preset.y < 0 ? minY : preset.y > 0 ? maxY : center.y };
  const delta = { x: target.x - center.x, y: target.y - center.y };
  let fraction = 1;
  for (let i = 0; i < region.length; i++) {
    const a = region[i]!, b = region[(i + 1) % region.length]!;
    const nx = a.y - b.y, ny = b.x - a.x;
    const rate = nx * delta.x + ny * delta.y;
    if (rate < -1e-10) fraction = Math.min(fraction, Math.max(0, (nx * (center.x - a.x) + ny * (center.y - a.y)) / -rate));
  }
  let hole: ReturnType<typeof computeModelKeychainHole> = null;
  try { hole = computeModelKeychainHole(config, crop); } catch { /* Existing hole validation remains visible. */ }
  for (let attempt = 0; attempt <= (presetId === 'center' ? 0 : 64); attempt++) {
    const t = fraction * (1 - attempt / 64);
    const dx = center.x + delta.x * t - markCenter.x, dy = center.y + delta.y * t - markCenter.y;
    if (hole) {
      try { assertKeychainClearance(hole, shapes.map(shape => shape.contour.map(p => ({ x: p.x + (surface === 'underside' ? -dx : dx), y: p.y + dy }))), 0.601, 'Overlaps keychain hole'); }
      catch { continue; }
    }
    const next = { xMm: Math.round((position.xMm + dx) * 1000) / 1000,
      yMm: Math.round((position.yMm + dy) * 1000) / 1000, rotationDeg: position.rotationDeg };
    if (Math.abs(next.xMm) <= 500 && Math.abs(next.yMm) <= 500) return next;
  }
  return null;
}
