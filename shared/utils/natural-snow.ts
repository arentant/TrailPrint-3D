import type { SprayPaintPlan } from '../types/spray-paint';
import type { TerrainCropRegion, TerrainHeightPreview } from '../types/terrain';

// Continuous, seeded value noise keeps the snowline repeatable at any resolution.
function noise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const hash = (a: number, b: number) => {
    const n = Math.sin(a * 127.1 + b * 311.7 + 19.19) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const u = smooth(x - ix), v = smooth(y - iy);
  const a = hash(ix, iy) * (1 - u) + hash(ix + 1, iy) * u;
  const b = hash(ix, iy + 1) * (1 - u) + hash(ix + 1, iy + 1) * u;
  return a * (1 - v) + b * v;
}

/** A varying elevation boundary: snow reaches into gullies and retreats on cliffs. */
export function createNaturalSnowPlan(preview: TerrainHeightPreview, crop: TerrainCropRegion, snowline = 0.5): SprayPaintPlan {
  const { cols, rows, heights } = preview;
  if (cols < 2 || rows < 2 || heights.length !== cols * rows || !Array.from(heights).every(Number.isFinite) || !Number.isFinite(snowline)) {
    throw new Error('Complete terrain data is required for natural snow.');
  }
  let min = Infinity, max = -Infinity;
  for (const height of heights) { min = Math.min(min, height); max = Math.max(max, height); }
  const span = Math.max(max - min, 0.1);
  const level = Math.max(0.15, Math.min(0.85, snowline));
  const read = (c: number, r: number) => heights[Math.max(0, Math.min(rows - 1, r)) * cols + Math.max(0, Math.min(cols - 1, c))]!;
  const boundary: number[] = [], cellRegions: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const u = c / (cols - 1), v = r / (rows - 1);
    // Relative terrain slope avoids changing the pattern with Z exaggeration.
    const dx = (read(c + 1, r) - read(c - 1, r)) / span * (cols - 1) / 2;
    const dy = (read(c, r + 1) - read(c, r - 1)) / span * (rows - 1) / 2;
    const slope = Math.min(1, Math.hypot(dx, dy) / 5);
    const texture = noise(u * 5, v * 5) * 0.11 + noise(u * 13, v * 13) * 0.045;
    const z = Math.max(0, min) + span * Math.max(0.08, level + texture + slope * 0.19 - 0.06);
    boundary.push(z);
    cellRegions.push(read(c, r) > z ? 1 : 0);
  }
  return {
    colors: [
      { index: 1, regionId: 0, hex: '#000000', label: 'Rock' },
      { index: 2, regionId: 1, hex: '#ffffff', label: 'Snow' },
    ],
    cellRegions, gridCols: cols, gridRows: rows, source: 'rules',
    generatedAt: Date.now(), satelliteUsed: false,
    naturalSnow: { snowline: level, boundaryHeights: boundary, widthMm: crop.widthMm, heightMm: crop.heightMm },
  };
}
