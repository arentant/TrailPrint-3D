import type { AppConfig } from "@shared/types";
import type { TerrainMeshPayload } from "@shared/types/terrain";
import { computeTrayBottomMagnetHoles } from "@shared/utils/magnet-hole-layout";
import { magnetCutDimensionsMm } from "@shared/utils/magnet-hole-geometry";
import { logMagnetDebug } from "@shared/utils/magnet-debug-log";
import type { TrayFootprint } from "@shared/utils/tray-footprint";
import { applyTrayMagnetPockets } from "./tray-bottom-features";
import {
  countBottomHoleOpenings,
  countBottomPlateOverHole,
} from "./tray-magnet-pockets";

/**
 * 托盘底面磁铁盲孔：按所选磁铁轮廓重建底面与孔壁。
 * 保留完整底板，补内壁 + 孔顶面（孔底在 z=bottomZ 敞开，供嵌入磁铁）。
 */
export function applyTrayMagnetHoles(
  mesh: TerrainMeshPayload,
  config: AppConfig,
  footprint: TrayFootprint,
): TerrainMeshPayload {
  const holes = computeTrayBottomMagnetHoles(config, footprint);
  if (!holes.length) return mesh;

  const cut = magnetCutDimensionsMm(
    config.assembly.magnet,
  );
  const { radiusMm: radius, depthMm: depth } = cut;
  const triBefore = mesh.indices.length / 3;

  const result = applyTrayMagnetPockets(mesh, footprint.outer, holes, radius, depth, cut);

  const openings = countBottomHoleOpenings(result, holes, radius, cut);
  const covered = countBottomPlateOverHole(result, holes, radius, cut);

  logMagnetDebug({
    phase: "apply-pocket-cuts",
    mapCropShape: config.mapCrop.shape,
    footprintShape: footprint.shape,
    outerVertCount: footprint.outer.length,
    holeCount: holes.length,
    cutRadiusMm: radius,
    cutDepthMm: depth,
    triCountBefore: triBefore,
    triCountAfter: result.indices.length / 3,
    note: `${cut.shape} pockets; underside openings ${openings}/${holes.length}, openings blocked by base ${covered}/${holes.length}`,
  });

  return result;
}
