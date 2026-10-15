import { ShapeUtils, Vector2 } from "three";
import { Font } from "three/examples/jsm/loaders/FontLoader.js";
import fontData from "../assets/fonts/helvetiker_bold.typeface.json";
import armenianFontData from "../assets/fonts/noto-sans-armenian-bold.typeface.json";
import type { AppConfig, TrayTextConfig } from "../types/config";
import { computeTrayFootprint, type Vec2 } from "./tray-footprint";
import { pointInPolygon } from "./tray-nfc-layout";

const font = new Font({ ...fontData, glyphs: {
  ...fontData.glyphs,
  // Both bundled typefaces use the same 1000-unit resolution and bold cap height.
  ...armenianFontData.glyphs,
  // A simple elevation arrow for labels like the reference's “1085m ↑”.
  "↑": { ha: 750, x_min: 50, x_max: 650, o: "m 250 0 l 250 580 l 50 580 l 350 950 l 650 580 l 450 580 l 450 0 l 250 0" },
} });
const EDGE_MARGIN_MM = 0.6;
const MIN_LETTER_HEIGHT_MM = 1.5;

export interface TrayTextShape {
  contour: Vec2[];
  holes: Vec2[][];
}

export function trayTextEdgeCount(config: AppConfig): number {
  return config.mapCrop.shape === "polygon" ? config.mapCrop.polygonSides : 4;
}

function cleanLoop(points: Vector2[], clockwise: boolean): Vector2[] {
  const loop = points.filter((p, i) => i === 0 || p.distanceToSquared(points[i - 1]!) > 1e-12);
  if (loop.length > 1 && loop[0]!.distanceToSquared(loop[loop.length - 1]!) < 1e-12) loop.pop();
  if (ShapeUtils.isClockWise(loop) !== clockwise) loop.reverse();
  return loop;
}

/** Bundled printable glyphs, shared by tray labels and model lettering. */
export function buildTextGlyphs(value: string, sizeMm: number, name = 'Base text'): TrayTextShape[] {
  for (const character of value) {
    if (!font.data.glyphs[character]) throw new Error(`${name} font does not support “${character}”. Use Armenian, Latin or Greek letters, numbers and supported punctuation.`);
  }
  return font.generateShapes(value, sizeMm).map(shape => {
    const points = shape.extractPoints(8);
    return { contour: cleanLoop(points.shape, false), holes: points.holes.map(hole => cleanLoop(hole, true)) };
  });
}

function boundaryDistance(point: Vec2, polygon: Vec2[]): number {
  return Math.min(...polygon.map((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
  }));
}

/** Shared by validation and mesh generation, so preview and STL fit identically. */
export function buildTrayTextLayout(config: AppConfig, footprint = computeTrayFootprint(config)): TrayTextShape[] {
  const text = config.tray.text;
  if (!text?.enabled) return [];
  validateTextSettings(text, trayTextEdgeCount(config));
  const output: TrayTextShape[] = [];
  for (const label of text.labels) {
    const value = label.text.trim().normalize("NFC");
    if (!value) continue;
    const raw = buildTextGlyphs(value, text.sizeMm);
    const points = raw.flatMap(s => s.contour);
    if (!points.length) continue;
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const count = trayTextEdgeCount(config);
    const angle = -Math.PI / 2 + label.edge * 2 * Math.PI / count;
    const nx = Math.cos(angle), ny = Math.sin(angle);
    const innerExtent = Math.max(...footprint.recessInner.map(p => p.x * nx + p.y * ny));
    const radius = innerExtent + config.tray.rimWidthMm / 2;
    const width = config.mapCrop.shape === "circle" ? radius * (Math.PI / 2 - 0.2)
      : config.mapCrop.shape === "rectangle" ? (label.edge % 2 === 0 ? config.mapCrop.lengthMm : config.mapCrop.widthMm) * 0.8
      : innerExtent * Math.tan(Math.PI / count) * 1.6;
    let scale = Math.min(1, width / (maxX - minX), (config.tray.rimWidthMm - 2 * EDGE_MARGIN_MM) / (maxY - minY));
    let placed: TrayTextShape[] = [];
    let fits = false;
    while ((maxY - minY) * scale >= MIN_LETTER_HEIGHT_MM) {
      const transform = (p: Vec2): Vec2 => {
        const x = (p.x - cx) * scale, y = (p.y - cy) * scale;
        if (config.mapCrop.shape === "circle") {
          const a = angle + x / radius;
          return { x: (radius - y) * Math.cos(a), y: (radius - y) * Math.sin(a) };
        }
        return { x: nx * (radius - y) - ny * x, y: ny * (radius - y) + nx * x };
      };
      placed = raw.map(s => ({ contour: s.contour.map(transform), holes: s.holes.map(h => h.map(transform)) }));
      fits = placed.every(s => s.contour.every((p, i) => {
        const q = s.contour[(i + 1) % s.contour.length]!;
        return [p, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }].every(v =>
          pointInPolygon(v.x, v.y, footprint.outer) && !pointInPolygon(v.x, v.y, footprint.recessInner)
          && boundaryDistance(v, footprint.outer) >= EDGE_MARGIN_MM
          && boundaryDistance(v, footprint.recessInner) >= EDGE_MARGIN_MM);
      }));
      if (fits) break;
      scale *= 0.9;
    }
    if (!fits) throw new Error(`Base text on edge ${label.edge + 1} is too small to print. Shorten it or increase the rim width or print size.`);
    output.push(...placed);
  }
  return output;
}

function validateTextSettings(text: TrayTextConfig, count: number): void {
  if (!Number.isFinite(text.sizeMm) || text.sizeMm < 2 || text.sizeMm > 12) throw new Error("Base text size must be between 2 and 12 mm.");
  if (!Number.isFinite(text.heightMm) || text.heightMm < 0.2 || text.heightMm > 3) throw new Error("Base text relief must be between 0.2 and 3 mm.");
  if (!Array.isArray(text.labels) || text.labels.length > 8) throw new Error("Use up to eight base text labels.");
  const used = new Set<number>();
  for (const label of text.labels) {
    if (!label || typeof label.text !== "string" || label.text.length > 80 || /[\n\r\t\p{Cc}]/u.test(label.text)) throw new Error("Each base label must be one line, up to 80 characters.");
    if (!label.text.trim()) continue;
    if (!Number.isInteger(label.edge) || label.edge < 0 || label.edge >= count) throw new Error(`Choose an available base text edge (1–${count}).`);
    if (used.has(label.edge)) throw new Error("Place each base text label on a different edge.");
    used.add(label.edge);
  }
}
