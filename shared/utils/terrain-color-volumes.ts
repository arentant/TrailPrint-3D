import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import type { ColoredPart } from '../export/colored-3mf';
import type { SprayPaintPlan } from '../types/spray-paint';
import type { TerrainCropRegion, TerrainMeshPayload } from '../types/terrain';
import { isHexColor } from '../types/model-colors';
import { buildHeightfieldTerrainMesh, sampleHeightBilinearMm } from './heightfield-mesh';
import { waterMeshPayload } from '../water/mesh-payload';

/** Partition the existing terrain; never overlay intersecting colored shells. */
export function buildTerrainColorVolumes(wasm: ManifoldToplevel, mesh: TerrainMeshPayload,
  crop: TerrainCropRegion, plan: SprayPaintPlan): ColoredPart[] {
  const { gridCols: cols, gridRows: rows } = plan;
  const ids = new Set(plan.colors.map(c => c.regionId));
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || cols * rows > 4_000_000 ||
    plan.cellRegions.length !== cols * rows || !plan.colors.length || plan.colors.length > 8 || !ids.has(0) || ids.size !== plan.colors.length ||
    plan.colors.some(c => !isHexColor(c.hex) || !Number.isInteger(c.regionId) || c.regionId < 0 || c.regionId > 7) ||
    plan.cellRegions.some(id => !ids.has(id))) throw new Error('Terrain color regions are incomplete. Apply colors again before downloading.');
  const snow = plan.naturalSnow;
  if (snow && (snow.boundaryHeights.length !== cols * rows || !snow.boundaryHeights.every(Number.isFinite) ||
    !Number.isFinite(snow.widthMm) || !Number.isFinite(snow.heightMm) ||
    Math.abs(snow.widthMm - crop.widthMm) > 0.001 || Math.abs(snow.heightMm - crop.heightMm) > 0.001 ||
    plan.colors.length !== 2 || !ids.has(1))) throw new Error('Snow terrain has changed. Apply Natural snow again before downloading.');

  const allocations = new Set<Manifold | CrossSection>();
  const own = <T extends Manifold | CrossSection>(value: T): T => { allocations.add(value); return value; };
  const solid = (payload: TerrainMeshPayload) => {
    const raw = new wasm.Mesh({ numProp: 3, tolerance: 0.00001,
      vertProperties: new Float32Array(payload.positions), triVerts: new Uint32Array(payload.indices) });
    raw.merge();
    const result = own(new wasm.Manifold(raw));
    if (result.status() !== 'NoError') throw new Error('Terrain could not be prepared for multicolor printing. Try a lower mesh quality.');
    return result;
  };
  const output: ColoredPart[] = [];
  const add = (value: Manifold, regionId: number) => {
    if (value.status() !== 'NoError') throw new Error('Terrain color volumes could not be completed. Apply colors again or lower mesh quality.');
    if (value.isEmpty()) return;
    const color = plan.colors.find(c => c.regionId === regionId)!;
    output.push({ name: snow ? (regionId === 0 ? 'Terrain — black rock' : 'Terrain — snow') : `Terrain color ${color.index}`,
      color: color.hex, mesh: waterMeshPayload(value, mesh, value.boundingBox().min[2]) });
  };
  try {
    const terrain = solid(mesh);
    if (snow) {
      // Extend the cutter beyond the model, including any lettering/plaque, so
      // only the elevation boundary decides the material, never the crop walls.
      const bounds = terrain.boundingBox();
      const widthMm = Math.max(Math.abs(bounds.min[0]), Math.abs(bounds.max[0])) * 2 + 2;
      const heightMm = Math.max(Math.abs(bounds.min[1]), Math.abs(bounds.max[1])) * 2 + 2;
      const rectangle: TerrainCropRegion = { ...crop, shape: 'rectangle', widthMm, heightMm, cornerRadiusMm: 0 };
      const field = Array.from({ length: cols * rows }, (_, i) => sampleHeightBilinearMm(
        (i % cols) / (cols - 1) * widthMm - widthMm / 2,
        Math.floor(i / cols) / (rows - 1) * heightMm - heightMm / 2,
        snow.boundaryHeights, cols, rows, crop));
      const belowSnow = solid(buildHeightfieldTerrainMesh(rectangle, field, cols, rows, Math.max(1, -bounds.min[2] + 1)));
      add(own(terrain.intersect(belowSnow)), 0);
      add(own(terrain.subtract(belowSnow)), 1);
    } else {
      let remaining = terrain;
      const top = terrain.boundingBox().max[2] + 1;
      for (const color of plan.colors) {
        if (color.regionId === 0) continue;
        // Merge each row's runs before unioning their outlines. Sample cells
        // use nearest-neighbor boundaries, matching painting in the preview.
        const contours: Array<Array<[number, number]>> = [];
        const x = (c: number) => (Math.max(0, Math.min(cols - 1, c)) / (cols - 1) - 0.5) * crop.widthMm;
        const y = (r: number) => (Math.max(0, Math.min(rows - 1, r)) / (rows - 1) - 0.5) * crop.heightMm;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols;) {
          if (plan.cellRegions[r * cols + c] !== color.regionId) { c++; continue; }
          const start = c++;
          while (c < cols && plan.cellRegions[r * cols + c] === color.regionId) c++;
          const left = x(start - 0.5), right = x(c - 0.5), bottom = y(r - 0.5), upper = y(r + 0.5);
          contours.push([[left, bottom], [right, bottom], [right, upper], [left, upper]]);
        }
        if (!contours.length || top <= 0) continue;
        const section = own(new wasm.CrossSection(contours, 'NonZero'));
        const cutter = own(section.extrude(top));
        add(own(remaining.intersect(cutter)), color.regionId);
        remaining = own(remaining.subtract(cutter));
      }
      add(remaining, 0);
    }
    if (!output.length) throw new Error('No printable terrain color volumes were generated.');
    return output;
  } finally {
    for (const allocation of allocations) allocation.delete();
  }
}
