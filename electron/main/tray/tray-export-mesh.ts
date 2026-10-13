import type { TrayConfig } from "../../../shared/types";
import type { TerrainMeshPayload } from "../../../shared/types/terrain";
import { weldMeshVertices } from "../../../shared/utils/mesh-manifold";
import type { TrayFootprint } from "../../../shared/utils/tray-footprint";
import { applyTrayMagnetPockets } from "../assembly/tray-bottom-features";
import {
  applyTrayTopNfcFeatures,
  type TrayNfcMeshSpec,
} from "../assembly/tray-top-nfc-features";
import { buildTrayBaseMesh } from "./tray-base-mesh";
import type { TrayMagnetCutSpec } from "./tray-csg-mesh";
import type { TrayTextShape } from "../../../shared/utils/tray-text-layout";
import { applyTrayText } from "./tray-text-mesh";
import { assertKeychainClearance, computeTrayKeychainHole, KEYCHAIN_MIN_WALL_MM } from "../../../shared/utils/tray-keychain-layout";
import { magnetPocketVertsMm } from "../../../shared/utils/magnet-hole-geometry";
import { ledPocketRect, rectCorners } from "../../../shared/utils/tray-nfc-layout";
import { applyTrayKeychainHole } from "./tray-keychain-mesh";

/**
 * 导出用托盘网格：手工封闭体 + 底面磁铁孔 + 顶面 NFC/LED 腔，最后焊接为 0 开放边。
 */
export function buildTrayBaseMeshForExport(
  footprint: TrayFootprint,
  tray: TrayConfig,
  magnet?: TrayMagnetCutSpec,
  nfc?: TrayNfcMeshSpec,
  textShapes: TrayTextShape[] = [],
): TerrainMeshPayload {
  const keychain = computeTrayKeychainHole(footprint, tray);
  if (keychain) {
    assertKeychainClearance(keychain, textShapes.map(s => s.contour), 0.6,
      "The keychain hole overlaps a base label. Move the hole along the rim or choose another edge.");
    if (magnet) assertKeychainClearance(keychain,
      magnet.holes.map(p => magnetPocketVertsMm(p.x, p.y, magnet.radiusMm, magnet)), KEYCHAIN_MIN_WALL_MM,
      "Keep at least 2 mm between the keychain hole and magnet pockets.");
    if (nfc) assertKeychainClearance(keychain,
      [nfc.cavityVerts, ...nfc.ledPockets.map(p => rectCorners(ledPocketRect(p, nfc.ledPocketLengthMm, nfc.ledPocketWidthMm)))], KEYCHAIN_MIN_WALL_MM,
      "Keep at least 2 mm between the keychain hole and NFC/LED pockets.");
  }
  let mesh = buildTrayBaseMesh(footprint, tray);
  if (magnet?.holes.length) {
    mesh = applyTrayMagnetPockets(
      mesh,
      footprint.outer,
      magnet.holes,
      magnet.radiusMm,
      magnet.depthMm,
      magnet,
    );
  }
  if (nfc?.cavityVerts.length) {
    mesh = applyTrayTopNfcFeatures(mesh, footprint.recessInner, nfc);
  }
  mesh = weldMeshVertices(mesh, 0.05);
  mesh = applyTrayText(mesh, footprint, textShapes, tray.totalThicknessMm, tray.text?.heightMm ?? 0.6);
  return keychain ? applyTrayKeychainHole(mesh, footprint, keychain, tray.totalThicknessMm, textShapes, magnet) : mesh;
}
