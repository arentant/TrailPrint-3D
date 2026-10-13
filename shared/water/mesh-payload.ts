import type { Manifold } from 'manifold-3d';
import type { TerrainMeshPayload } from '../types/terrain';

/** Keep the solid's topology when removing its extra vertex properties. */
export function waterMeshPayload(solid: Manifold, metadata: TerrainMeshPayload, bottomZ: number): TerrainMeshPayload {
  const mesh = solid.getMesh();
  const parents = Int32Array.from({ length: mesh.numVert }, (_, i) => i);
  function root(vertex: number): number {
    while (parents[vertex] !== vertex) {
      parents[vertex] = parents[parents[vertex]!]!;
      vertex = parents[vertex]!;
    }
    return vertex;
  }
  // Manifold records which property vertices represent one geometric vertex.
  // Spatial welding also merges unrelated near-coincident edges, introducing
  // non-manifold edges in detailed terrain and Boolean-cut trail grooves.
  for (let i = 0; i < mesh.mergeFromVert.length; i++) {
    parents[root(mesh.mergeFromVert[i]!)] = root(mesh.mergeToVert[i]!);
  }
  const remap = new Int32Array(mesh.numVert).fill(-1);
  const positions: number[] = [];
  const indices = Array.from(mesh.triVerts, (vertex) => {
    const geometricVertex = root(vertex);
    if (remap[geometricVertex] === -1) {
      remap[geometricVertex] = positions.length / 3;
      const i = geometricVertex * mesh.numProp;
      positions.push(mesh.vertProperties[i]!, mesh.vertProperties[i + 1]!, mesh.vertProperties[i + 2]!);
    }
    return remap[geometricVertex]!;
  });
  return { ...metadata, positions, indices, bottomZ };
}
