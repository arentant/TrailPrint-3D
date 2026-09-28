import type { TerrainMeshPayload } from "@shared/types/terrain";
import { analyzeMesh } from "@shared/utils/mesh-manifold";

/**
 * 喷漆遮挡罩允许多块独立壳体（如同一颜色上下分离），
 * 不要求单一连通水密体；仅拒绝空网格，其余拓扑问题降级为 warnings。
 */
export function validateMaskMesh(
  mesh: TerrainMeshPayload,
  fileName: string,
): string[] {
  const warnings: string[] = [];
  const a = analyzeMesh(mesh);

  if (a.triangles < 4) {
    throw new Error(
      `${fileName} has too few triangles (${a.triangles}). This color region may have no area to mask.`,
    );
  }

  if (a.boundaryEdges > 0) {
    warnings.push(
      `${fileName} contains ${a.boundaryEdges} open edges. Inspect the model before slicing.`,
    );
  }

  if (a.nonManifoldEdges > 0) {
    warnings.push(
      `${fileName} contains ${a.nonManifoldEdges} non-manifold edges. Separate regions of the same color are expected and are usually printable.`,
    );
  }

  if (a.degenerateTriangles > 0) {
    warnings.push(
      `${fileName} contains ${a.degenerateTriangles} degenerate triangles, which were ignored`,
    );
  }

  return warnings;
}
