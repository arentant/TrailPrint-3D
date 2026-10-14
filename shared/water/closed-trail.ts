import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import type { TerrainMeshPayload } from '../types/terrain';
import { strokeSection } from './stroke';
import { waterMeshPayload } from './mesh-payload';

/** Clip a solid DEM surface to a round-capped trail, with a flat printable floor. */
export function closedTrailVolume(wasm: ManifoldToplevel, surface: TerrainMeshPayload, points: Array<{ x: number; y: number }>, width: number): TerrainMeshPayload | null {
  const sections = strokeSection(wasm, points.map(p => [p.x, p.y]), width);
  const allocated: Manifold[] = [];
  const own = (s: Manifold) => { allocated.push(s); return s; };
  try {
    if (sections.isEmpty()) return null;
    const raw = new wasm.Mesh({ numProp: 3, vertProperties: new Float32Array(surface.positions), triVerts: new Uint32Array(surface.indices) });
    raw.merge(); const solid = own(new wasm.Manifold(raw));
    if (solid.status() !== 'NoError') throw new Error('Trail surface could not be prepared as a closed solid.');
    const height = solid.boundingBox().max[2] - surface.bottomZ + 1;
    const prism = own(sections.extrude(height)), positioned = own(prism.translate([0, 0, surface.bottomZ]));
    const result = own(solid.intersect(positioned));
    return result.isEmpty() ? null : waterMeshPayload(result, surface, surface.bottomZ);
  } finally { sections.delete(); allocated.forEach(s => s.delete()); }
}
