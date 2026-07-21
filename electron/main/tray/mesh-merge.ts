import type { TerrainMeshPayload } from "@shared/types/terrain";

export function mergeMeshPayloads(
  parts: TerrainMeshPayload[],
): TerrainMeshPayload {
  let totalPos = 0;
  let totalIdx = 0;
  for (const part of parts) {
    if (!part.positions.length) continue;
    totalPos += part.positions.length;
    totalIdx += part.indices.length;
  }

  const positions = new Array<number>(totalPos);
  const indices = new Array<number>(totalIdx);
  let posWrite = 0;
  let idxWrite = 0;
  let minSurfaceZ = Infinity;
  let bottomZ = Infinity;

  for (const part of parts) {
    if (!part.positions.length) continue;
    const offset = posWrite / 3;
    for (let i = 0; i < part.positions.length; i++) {
      positions[posWrite++] = part.positions[i]!;
    }
    for (let i = 0; i < part.indices.length; i++) {
      indices[idxWrite++] = part.indices[i]! + offset;
    }
    minSurfaceZ = Math.min(minSurfaceZ, part.minSurfaceZ);
    bottomZ = Math.min(bottomZ, part.bottomZ);
  }

  if (posWrite !== totalPos) positions.length = posWrite;
  if (idxWrite !== totalIdx) indices.length = idxWrite;

  return {
    positions,
    indices,
    minSurfaceZ: Number.isFinite(minSurfaceZ) ? minSurfaceZ : 0,
    bottomZ: Number.isFinite(bottomZ) ? bottomZ : 0,
    gridCols: 0,
    gridRows: 0,
  };
}
