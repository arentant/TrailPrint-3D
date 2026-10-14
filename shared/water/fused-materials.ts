import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import type { TerrainMeshPayload } from '../types/terrain';
import { waterMeshPayload } from './mesh-payload';

/** Partition by material after Boolean operations, keeping each label explicit. */
export function fuseModelMaterials(wasm: ManifoldToplevel, terrain: TerrainMeshPayload, trail: TerrainMeshPayload | null,
  water: TerrainMeshPayload[]): { mesh: TerrainMeshPayload; trailMesh: TerrainMeshPayload | null; waterMeshes: TerrainMeshPayload[]; waterPartRemap: number[] } {
  const allocations = new Set<Manifold>();
  const own = (s: Manifold) => { allocations.add(s); return s; };
  // Float32 payload round trips can leave zero-volume Boolean sheets. These
  // are far below any printable part and must not count as disconnected solids.
  const clean = (s: Manifold) => {
    const simplified = own(s.setTolerance(0.00001));
    const pieces = simplified.decompose().map(own).filter(p => p.volume() > 0.000001);
    return own(wasm.Manifold.compose(pieces));
  };
  const solid = (mesh: TerrainMeshPayload) => {
    const source = new wasm.Mesh({ numProp: 3, tolerance: 0.00001, vertProperties: new Float32Array(mesh.positions), triVerts: new Uint32Array(mesh.indices) });
    source.merge(); const original = own(new wasm.Manifold(source));
    const result = own(original.setTolerance(0.00001));
    if (result.status() !== 'NoError') throw new Error('A fused material could not be prepared as a closed solid.');
    return result;
  };
  try {
    const trailSolid = trail ? solid(trail) : null, terrainSolid = solid(terrain);
    const candidates = water.map(part => clean(trailSolid ? own(solid(part).subtract(trailSolid)) : solid(part)));
    const waterPartRemap = candidates.map(() => -1);
    const waters = candidates.filter((part, i) => {
      if (part.isEmpty()) return false;
      waterPartRemap[i] = waterPartRemap.filter(index => index >= 0).length; return true;
    });
    const withoutTrail = trailSolid ? own(terrainSolid.subtract(trailSolid)) : terrainSolid;
    // Terrain already has zero-clearance water seats, cut with planar prisms.
    // Subtracting a re-imported DEM-topped water mesh here would create tiny
    // coplanar slivers along the terrain surface after Float32 conversion.
    const main = clean(withoutTrail);
    const joined = own(wasm.Manifold.union([main, ...(trailSolid ? [trailSolid] : []), ...waters]));
    const pieces = joined.decompose().map(own).filter(p => p.volume() > 0.000001);
    if (pieces.length !== 1 || joined.status() !== 'NoError') throw new Error('Fused materials are disconnected. Adjust trail depth, water thickness or print size.');
    return { mesh: waterMeshPayload(main, terrain, terrain.bottomZ),
      trailMesh: trailSolid && trail ? waterMeshPayload(trailSolid, trail, trail.bottomZ) : null,
      waterMeshes: candidates.flatMap((s, i) => s.isEmpty() ? [] : [waterMeshPayload(s, water[i]!, water[i]!.bottomZ)]), waterPartRemap };
  } finally { for (const value of allocations) value.delete(); }
}
