import { createDefaultFeaturePosition, type AppConfig, type ModelFeaturePosition } from '../types/config';
import type { TerrainCropRegion } from '../types/terrain';
import { computeTerrainCropRegion } from './crop-region';
import { buildFootprintPolygonMm } from './footprint';
import { buildTextGlyphs, type TrayTextShape } from './tray-text-layout';
import type { Vec2 } from './tray-footprint';
import { pointInPolygon } from './tray-nfc-layout';
import { assertKeychainClearance, type TrayKeychainHole } from './tray-keychain-layout';
import { magnetCircleVertsMm } from './magnet-hole-geometry';

export function modelEdgeCount(config: AppConfig): number {
  return config.mapCrop.shape === 'polygon' ? config.mapCrop.polygonSides : 4;
}

export function modelFootprint(crop: TerrainCropRegion): Vec2[] {
  return buildFootprintPolygonMm(crop) ?? Array.from({ length: 128 }, (_, i) => {
    const angle = i * Math.PI / 64;
    return { x: crop.radiusMm! * Math.cos(angle), y: crop.radiusMm! * Math.sin(angle) };
  });
}

function boundaryDistance(point: Vec2, contour: Vec2[]): number {
  return Math.min(...contour.map((a, i) => {
    const b = contour[(i + 1) % contour.length]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
  }));
}

export interface ModelTextLayout {
  front: TrayTextShape[];
  underside: TrayTextShape[];
  logoFront: TrayTextShape[];
  logoUnderside: TrayTextShape[];
  /** An integrated ledge overlapping the front edge of the terrain. */
  plaque: Vec2[];
  plaqueThicknessMm: number;
}

export function modelMarkBounds(shapes: TrayTextShape[]) {
  const points = shapes.flatMap(shape => shape.contour);
  return { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
    minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) };
}
const textBounds = modelMarkBounds;

function transformShapes(shapes: TrayTextShape[], transform: (point: Vec2) => Vec2): TrayTextShape[] {
  return shapes.map(shape => ({ contour: shape.contour.map(transform), holes: shape.holes.map(hole => hole.map(transform)) }));
}

function positionShapes(shapes: TrayTextShape[], value: ModelFeaturePosition | undefined, centerY: number, underside = false): TrayTextShape[] {
  const position = value ?? createDefaultFeaturePosition();
  if (![position.xMm, position.yMm, position.rotationDeg].every(Number.isFinite) || Math.abs(position.xMm) > 500 || Math.abs(position.yMm) > 500 || Math.abs(position.rotationDeg) > 360) throw new Error('Use offsets between −500 and 500 mm and a rotation between −360° and 360°.');
  const angle = position.rotationDeg * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return transformShapes(shapes, p => {
    const x = underside ? -p.x : p.x, y = p.y - centerY;
    const movedX = x * cos - y * sin + position.xMm;
    return { x: underside ? -movedX : movedX, y: x * sin + y * cos + position.yMm + centerY };
  });
}

function assertUndersideFits(shapes: TrayTextShape[], footprint: Vec2[], name: string): void {
  if (!shapes.every(shape => shape.contour.every(p => pointInPolygon(p.x, p.y, footprint) && boundaryDistance(p, footprint) >= 2 - 1e-8))) throw new Error(`${name} extends outside the underside. Move it inward or reduce its size; keep 2 mm from the edge.`);
}

function assertEngravingFloor(config: AppConfig, depth: number, name: string): void {
  const pocketDepth = Math.max(config.gpx.imported ? config.trail.trailDepthMm : 0, config.water?.enabled ? config.water.thicknessMm : 0);
  const minimum = depth + pocketDepth + 0.4;
  if (config.terrain.baseSolidThicknessMm < minimum - 1e-8) throw new Error(`Increase Base thickness to at least ${minimum.toFixed(1)} mm to keep a solid floor above engraved underside ${name}.`);
}

function buildTextLayout(config: AppConfig, crop: TerrainCropRegion, checkPlacement: boolean): ModelTextLayout {
  const result: ModelTextLayout = { front: [], underside: [], logoFront: [], logoUnderside: [], plaque: [], plaqueThicknessMm: 0 };
  const text = config.terrain.text;
  if (!text?.enabled) return result;
  if (!['front', 'underside', 'both'].includes(text.placement) || !['raised', 'engraved'].includes(text.style)) throw new Error('Choose a model text placement and raised or engraved lettering.');
  if (!Number.isFinite(text.sizeMm) || text.sizeMm < 2 || text.sizeMm > 16) throw new Error('Model text size must be between 2 and 16 mm.');
  if (!Number.isFinite(text.heightMm) || text.heightMm < 0.2 || text.heightMm > 3) throw new Error('Model text relief must be between 0.2 and 3 mm.');
  const lines = [text.title, text.subtitle];
  if (lines.some(line => typeof line !== 'string' || line.length > 80 || /[\n\r\t\p{Cc}]/u.test(line))) throw new Error('Each model text line can contain up to 80 characters.');
  let raw: TrayTextShape[] = [];
  for (const [index, line] of lines.entries()) {
    const shapes = buildTextGlyphs(line.trim().normalize('NFC'), text.sizeMm * (index === 0 ? 1 : 0.65), 'Model text');
    if (!shapes.length) continue;
    const bounds = textBounds(shapes);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    if (height < 1.5) throw new Error('Model text is too small to print. Increase the letter size.');
    const y = raw.length ? textBounds(raw).minY - text.sizeMm * 0.4 - height / 2 : 0;
    raw.push(...transformShapes(shapes, p => ({ x: p.x - bounds.minX - width / 2, y: p.y - (bounds.minY + bounds.maxY) / 2 + y })));
  }
  if (!raw.length) return result;
  const bounds = textBounds(raw), width = bounds.maxX - bounds.minX, height = bounds.maxY - bounds.minY;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const footprint = modelFootprint(crop);
  if (text.placement !== 'underside') {
    const scale = Math.min(1, (crop.widthMm * 0.8 - 4) / width);
    if (scale * text.sizeMm * (text.subtitle.trim() ? 0.65 : 1) < 1.5) throw new Error('The front caption is too long to print. Shorten it or increase the model size.');
    const frontY = Math.min(...footprint.map(p => p.y));
    const depth = height * scale + 4, halfWidth = Math.max(6, width * scale / 2 + 2);
    const top = frontY + Math.min(4, crop.heightMm * 0.1), bottom = frontY - depth;
    result.plaque = [{ x: -halfWidth, y: bottom }, { x: halfWidth, y: bottom }, { x: halfWidth, y: top }, { x: -halfWidth, y: top }];
    result.front = transformShapes(raw, p => ({ x: p.x * scale, y: (p.y - centerY) * scale + frontY - depth / 2 }));
    result.front = positionShapes(result.front, text.frontPosition, frontY - depth / 2);
    result.plaqueThicknessMm = Math.max(config.terrain.baseSolidThicknessMm, text.heightMm + 0.8);
    if (checkPlacement && config.tray.enabled) throw new Error('The front caption extends beyond the terrain. Turn off Generate base or choose Underside text.');
  }
  if (text.placement !== 'front') {
    let scale = Math.min(1, (crop.widthMm - 4) / width, (crop.heightMm - 4) / height);
    let fits = false;
    while (scale * text.sizeMm * (text.subtitle.trim() ? 0.65 : 1) >= 1.5) {
      // Mirror X once so the lettering reads correctly when viewed from below.
      result.underside = transformShapes(raw, p => ({ x: -p.x * scale, y: (p.y - centerY) * scale }));
      fits = result.underside.every(shape => shape.contour.every(p => pointInPolygon(p.x, p.y, footprint) && boundaryDistance(p, footprint) >= 2));
      if (fits) break;
      scale *= 0.9;
    }
    if (!fits) throw new Error('Underside text does not fit. Shorten it or increase the model size.');
    result.underside = positionShapes(result.underside, text.undersidePosition, 0, true);
    if (checkPlacement) {
      assertUndersideFits(result.underside, footprint, 'Text');
      if (text.style === 'engraved') assertEngravingFloor(config, text.heightMm, 'text');
    }
  }
  return result;
}

/** One layout for the position editor, printable preview and all exports. */
export function buildModelTextLayout(config: AppConfig, crop = computeTerrainCropRegion(config.mapCrop, 800, 600), checkPlacement = true): ModelTextLayout {
  const result = buildTextLayout(config, crop, checkPlacement), logo = config.terrain.logo;
  const footprint = modelFootprint(crop), frontY = Math.min(...footprint.map(p => p.y));
  if (logo?.enabled && logo.asset) {
    if (!['front', 'underside', 'both'].includes(logo.placement) || !['raised', 'engraved'].includes(logo.style)) throw new Error('Choose a logo placement and raised or engraved artwork.');
    if (!Number.isFinite(logo.widthMm) || logo.widthMm < 2 || logo.widthMm > 200) throw new Error('Logo width must be between 2 and 200 mm.');
    if (!Number.isFinite(logo.heightMm) || logo.heightMm < 0.2 || logo.heightMm > 3) throw new Error('Logo relief must be between 0.2 and 3 mm.');
    const asset = logo.asset;
    if (!Number.isFinite(asset.aspectRatio) || asset.aspectRatio < 0.02 || asset.aspectRatio > 50 || !Array.isArray(asset.contours) || !asset.contours.length || asset.contours.length > 256) throw new Error('Import a valid SVG or PNG logo.');
    let count = 0;
    for (const loop of asset.contours) {
      if (!Array.isArray(loop) || loop.length < 3 || (count += loop.length) > 8000 || loop.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 0.501 || Math.abs(p.y) > 0.501 / asset.aspectRatio)) throw new Error('The logo outlines are invalid or too detailed. Import a simpler logo.');
    }
    const raw = asset.contours.map(loop => ({ contour: loop.map(p => ({ x: p.x * logo.widthMm, y: p.y * logo.widthMm })), holes: [] }));
    const bounds = textBounds(raw), height = bounds.maxY - bounds.minY;
    if (height < 1) throw new Error('Increase the logo width so its height is at least 1 mm.');
    if (logo.placement !== 'underside') {
      const centerY = frontY - height / 2 - 2;
      result.logoFront = positionShapes(transformShapes(raw, p => ({ x: p.x, y: p.y + centerY })), logo.frontPosition, centerY);
      if (checkPlacement && config.tray.enabled) throw new Error('A front logo needs an integrated ledge. Turn off Generate base or choose Underside.');
    }
    if (logo.placement !== 'front') {
      result.logoUnderside = positionShapes(transformShapes(raw, p => ({ x: -p.x, y: p.y })), logo.undersidePosition, 0, true);
      if (checkPlacement) {
        assertUndersideFits(result.logoUnderside, footprint, 'Logo');
        if (logo.style === 'engraved') assertEngravingFloor(config, logo.heightMm, 'logo');
      }
    }
  }
  const front = [...result.front, ...result.logoFront];
  if (front.length) {
    const bounds = textBounds(front);
    if (checkPlacement && (bounds.maxY > frontY - 0.6 || bounds.minX < -crop.widthMm / 2 + 0.6 || bounds.maxX > crop.widthMm / 2 - 0.6)) throw new Error('Front artwork is outside the caption area. Move it down or toward the center, or reduce its size.');
    result.plaque = [{ x: Math.min(-6, bounds.minX - 2), y: bounds.minY - 2 }, { x: Math.max(6, bounds.maxX + 2), y: bounds.minY - 2 },
      { x: Math.max(6, bounds.maxX + 2), y: frontY + Math.min(4, crop.heightMm * 0.1) }, { x: Math.min(-6, bounds.minX - 2), y: frontY + Math.min(4, crop.heightMm * 0.1) }];
    result.plaqueThicknessMm = Math.max(config.terrain.baseSolidThicknessMm, result.front.length ? config.terrain.text.heightMm + 0.8 : 0, result.logoFront.length ? logo.heightMm + 0.8 : 0);
  }
  return result;
}

export function modelKeychainCenter(config: AppConfig, crop = computeTerrainCropRegion(config.mapCrop, 800, 600)): Vec2 {
  const hole = config.terrain.keychain;
  if (hole.position != null) {
    const { xMm, yMm } = hole.position;
    if (![xMm, yMm].every(Number.isFinite) || Math.abs(xMm) > 500 || Math.abs(yMm) > 500) throw new Error('Use model hole coordinates between −500 and 500 mm.');
    return { x: xMm, y: yMm };
  }
  if (!Number.isInteger(hole.edge) || hole.edge < 0 || hole.edge >= modelEdgeCount(config)) throw new Error('Choose an available model edge for the keychain hole.');
  if (!Number.isFinite(hole.insetMm) || hole.insetMm < 0 || !Number.isFinite(hole.offsetMm)) throw new Error('Use a positive model hole inset and a finite edge offset.');
  const contour = modelFootprint(crop), angle = -Math.PI / 2 + hole.edge * Math.PI * 2 / modelEdgeCount(config);
  const nx = Math.cos(angle), ny = Math.sin(angle);
  const radius = Math.max(...contour.map(p => p.x * nx + p.y * ny)) - hole.insetMm;
  if (radius <= 0) throw new Error('Keep at least 2 mm of model material around the keychain hole. Reduce its inset or use free placement.');
  const a = angle + hole.offsetMm / Math.max(radius, 1e-6);
  if (config.mapCrop.shape === 'circle' && Math.abs(hole.offsetMm) > radius * Math.PI / 4) throw new Error('Model keychain hole offset is outside the selected quarter. Reduce its offset.');
  return config.mapCrop.shape === 'circle'
    ? { x: radius * Math.cos(a), y: radius * Math.sin(a) }
    : { x: nx * radius - ny * hole.offsetMm, y: ny * radius + nx * hole.offsetMm };
}

export function computeModelKeychainHole(config: AppConfig, crop = computeTerrainCropRegion(config.mapCrop, 800, 600), checkPlacement = true): TrayKeychainHole | null {
  const hole = config.terrain.keychain;
  if (!hole?.enabled) return null;
  if (!Number.isFinite(hole.diameterMm) || hole.diameterMm < 2 || hole.diameterMm > 10) throw new Error('Model keychain hole diameter must be between 2 and 10 mm.');
  const center = modelKeychainCenter(config, crop), contour = modelFootprint(crop);
  const radiusMm = hole.diameterMm / 2;
  const ring = magnetCircleVertsMm(center.x, center.y, radiusMm);
  const cutRadiusMm = Math.hypot(ring[0]!.x - center.x, ring[0]!.y - center.y);
  if (checkPlacement && (!pointInPolygon(center.x, center.y, contour) || boundaryDistance(center, contour) - cutRadiusMm < 2 - 1e-8)) throw new Error('Keep at least 2 mm of model material around the keychain hole. Move it inward or reduce its diameter.');
  return { center, radiusMm, cutRadiusMm, contour: ring };
}

export function validateModelFeatures(config: AppConfig): void {
  if (config.moldKit?.enabled && hasModelFeatures(config)) throw new Error('Turn off the mold kit to use model lettering or a direct keychain hole.');
  const layout = buildModelTextLayout(config), hole = computeModelKeychainHole(config);
  if (hole) assertKeychainClearance(hole, [...layout.front, ...layout.underside, ...layout.logoFront, ...layout.logoUnderside].map(shape => shape.contour), 0.6,
    'The model keychain hole overlaps text or a logo. Move the hole or the artwork.');
}

export function hasModelFeatures(config: AppConfig): boolean {
  return Boolean(config.terrain.keychain?.enabled || (config.terrain.logo?.enabled && config.terrain.logo.asset) || (config.terrain.text?.enabled && (config.terrain.text.title.trim() || config.terrain.text.subtitle.trim())));
}
