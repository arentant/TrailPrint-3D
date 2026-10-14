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
  // getMesh rounds Boolean coordinates to Float32. A very short topological
  // edge can then have identical endpoints. Collapse only existing edges;
  // spatial welding would incorrectly join unrelated touching components.
  for (let t = 0; t < mesh.triVerts.length; t += 3) {
    for (let edge = 0; edge < 3; edge++) {
      const a = root(mesh.triVerts[t + edge]!), b = root(mesh.triVerts[t + (edge + 1) % 3]!);
      if (a === b) continue;
      const ai = a * mesh.numProp, bi = b * mesh.numProp;
      if ([0, 1, 2].every(axis => mesh.vertProperties[ai + axis] === mesh.vertProperties[bi + axis])) parents[b] = a;
    }
  }
  const remap = new Int32Array(mesh.numVert).fill(-1);
  const positions: number[] = [];
  const vertexIndex = (vertex: number) => {
    const geometricVertex = root(vertex);
    if (remap[geometricVertex] === -1) {
      remap[geometricVertex] = positions.length / 3;
      const i = geometricVertex * mesh.numProp;
      positions.push(mesh.vertProperties[i]!, mesh.vertProperties[i + 1]!, mesh.vertProperties[i + 2]!);
    }
    return remap[geometricVertex]!;
  };
  const indices: number[] = [];
  for (let t = 0; t < mesh.triVerts.length; t += 3) {
    const a = root(mesh.triVerts[t]!), b = root(mesh.triVerts[t + 1]!), c = root(mesh.triVerts[t + 2]!);
    if (a !== b && b !== c && c !== a) indices.push(vertexIndex(a), vertexIndex(b), vertexIndex(c));
  }
  return { ...metadata, positions, indices, bottomZ };
}
