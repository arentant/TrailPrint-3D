import {
  STL_FILE_NAMES,
  type ExportGenerateRequest,
  type ExportProgress,
} from "@shared/types/export";
import { validateModelGeneration } from "@shared/utils/model-validation";
import { trailLineWidthMmForPrint } from "@shared/utils/footprint";
import { ensureMapZoomFitsTrail } from "@shared/utils/trail-fit";
import { computeTrayBottomMagnetHoles } from "@shared/utils/magnet-hole-layout";
import {
  logMagnetDebug,
  magnetDebugSummary,
} from "@shared/utils/magnet-debug-log";
import { computeTrayFootprint } from "@shared/utils/tray-footprint";
import {
  computeTrayCoverPolygon,
  computeTrayNfcLayout,
} from "@shared/utils/tray-nfc-layout";
import { IpcException } from "@shared/ipc/types";
import { hydrateGpxConfig } from "../gpx/hydrate-gpx-config";
import { generateTerrainMain } from "../terrain/terrain-main-service";
import { generateTrayBase } from "../tray/tray-service";
import { buildTrayCoverMesh } from "../tray/tray-cover-mesh";
import { buildMoldMasterMesh } from "../mold/mold-master-mesh";
import { buildMoldLidMesh } from "../mold/mold-lid-mesh";
import { assertTrailLineMesh, assertWatertightMesh } from "@shared/utils/mesh-manifold";
import { encodeBinaryStl } from "@shared/utils/binary-stl";
import type { TerrainMeshPayload } from "@shared/types/terrain";
import { segmentSprayPaint } from "../spray-paint/segment-service";
import { generateSprayMasks } from "../spray-paint/mask-generate-service";
import {
  SPRAY_MANIFEST_FILE_NAME,
  buildSprayPaintManifest,
} from "@shared/utils/spray-manifest";

export type ExportProgressCallback = (progress: ExportProgress) => void;
export type ExportFileSink = (name: string, data: Uint8Array) => Promise<void> | void;

export function defaultZipName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `TrailPrint-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
}

export async function generateModelFiles(
  req: ExportGenerateRequest,
  onProgress: ExportProgressCallback,
  onFile: ExportFileSink,
): Promise<string[]> {
  const names: string[] = [];
  async function writeBinaryStl(name: string, mesh: TerrainMeshPayload, solidName: string): Promise<void> {
    await onFile(name, encodeBinaryStl(mesh, solidName));
    names.push(name);
  }
  let { config, viewportWidth, viewportHeight } = req;
  config = await hydrateGpxConfig(config);
  config = ensureMapZoomFitsTrail(config, viewportWidth, viewportHeight);

  onProgress({
    phase: "validate",
    progress: 0.02,
    message: "Validating settings…",
  });

  if (!config.gpx.imported) {
    throw new IpcException("GPX_REQUIRED", "Import a GPX track first");
  }

  const modelCheck = validateModelGeneration(config, {
    viewportWidth,
    viewportHeight,
    trailOnly: req.target === "trail",
  });
  if (!modelCheck.valid) {
    throw new IpcException(
      "MODEL_INVALID",
      modelCheck.message ?? "Cannot generate the model. Check the settings.",
    );
  }

  if (config.gpx.points.length < 2) {
    throw new IpcException("GPX_INVALID", "Not enough track points to generate the model");
  }

  if (viewportWidth < 64 || viewportHeight < 64) {
    throw new IpcException(
      "INVALID_VIEWPORT",
      "The preview is too small. Enlarge the window and try again.",
    );
  }

  onProgress({
    phase: "terrain",
    progress: 0.1,
    message: req.target === "trail" ? "Generating trail model…" : "Generating terrain and trail models…",
  });

  const terrainWithGroove = await generateTerrainMain({
    config,
    viewportWidth,
    viewportHeight,
    stlExport: true,
    trailOnly: req.target === "trail",
    trailLineWidthMm: trailLineWidthMmForPrint(config),
  });

  if (req.target === "trail") {
    if (!terrainWithGroove.trailMesh) {
      throw new IpcException("TRAIL_EMPTY", "Cannot generate the trail model. Move the trail inside the white outline or increase its width, then try again.");
    }
    onProgress({ phase: "stl", progress: 0.75, message: "Writing trail STL…" });
    assertTrailLineMesh(terrainWithGroove.trailMesh, "Trail_Line");
    await writeBinaryStl(STL_FILE_NAMES.trailLine, terrainWithGroove.trailMesh, "Trail_Line");
    return names;
  }

  onProgress({
    phase: "tray",
    progress: 0.45,
    message: "Generating tray base…",
  });

  const trayFootprint = computeTrayFootprint(config);
  if (config.assembly.magnet.enabled) {
    const previewHoles = computeTrayBottomMagnetHoles(config, trayFootprint);
    const summary = magnetDebugSummary({
      phase: "export-preview",
      mapCropShape: config.mapCrop.shape,
      polygonSides: config.mapCrop.polygonSides,
      footprintShape: trayFootprint.shape,
      outerVertCount: trayFootprint.outer.length,
      holeCount: previewHoles.length,
    });
    logMagnetDebug({
      phase: "export",
      mapCropShape: config.mapCrop.shape,
      polygonSides: config.mapCrop.polygonSides,
      footprintShape: trayFootprint.shape,
      outerVertCount: trayFootprint.outer.length,
      magnetEnabled: true,
      circleCount: config.assembly.magnet.circleCount,
      holeCount: previewHoles.length,
      holes: previewHoles,
      note: summary,
    });
  }

  const trayRes = await generateTrayBase({
    config,
    viewportWidth,
    viewportHeight,
  });

  const trailPoints = config.gpx.points.length || config.gpx.rawPoints.length;
  const trailPolylinePts = terrainWithGroove.trailPolylineMm?.length ?? 0;
  if (!terrainWithGroove.trailMesh) {
    throw new IpcException(
      "TRAIL_EMPTY",
      trailPoints < 2
        ? "Not enough track points. Import a valid GPX file."
        : trailPolylinePts < 2
          ? `Cannot generate the trail model (read ${trailPoints} track points, but too few fall inside the print area). Move the red trail inside the white outline on the 2D map, then export again.`
          : `Cannot generate the trail mesh (${trailPolylinePts} points in the print area). Increase the trail width slightly or reset the map view, then export again.`,
    );
  }

  onProgress({
    phase: "stl",
    progress: 0.6,
    message: "Writing STL files…",
  });

  const terrainStl = STL_FILE_NAMES.terrainMain;
  const trailStl = STL_FILE_NAMES.trailLine;
  const trayStl = STL_FILE_NAMES.trayBase;

  assertWatertightMesh(terrainWithGroove.mesh, "Terrain_Main");
  assertWatertightMesh(trayRes.mesh, "Tray_Base");
  if (terrainWithGroove.trailMesh) {
    assertTrailLineMesh(terrainWithGroove.trailMesh, "Trail_Line");
  }

  await writeBinaryStl(terrainStl, terrainWithGroove.mesh, "Terrain_Main");
  await writeBinaryStl(trailStl, terrainWithGroove.trailMesh, "Trail_Line");
  await writeBinaryStl(trayStl, trayRes.mesh, "Tray_Base");

  if (config.tray.nfc.enabled) {
    const nfcLayout = computeTrayNfcLayout(
      config,
      trayFootprint,
      viewportWidth,
      viewportHeight,
    );
    const coverVerts = computeTrayCoverPolygon(
      config,
      config.tray.nfc.coverInsetMm,
    );
    if (!coverVerts) {
      throw new IpcException(
        "TRAY_COVER_INVALID",
        "Cover inset is too large. Reduce the inset or increase the print size.",
      );
    }
    const coverMesh = buildTrayCoverMesh({
      outerVerts: coverVerts,
      ledPockets: nfcLayout.ledPockets,
      ledPocketLengthMm: config.tray.nfc.ledPocketLengthMm,
      ledPocketWidthMm: config.tray.nfc.ledPocketWidthMm,
      thicknessMm: config.tray.nfc.coverThicknessMm,
    });
    assertWatertightMesh(coverMesh, "Tray_Cover");
    const coverStl = STL_FILE_NAMES.trayCover;
    await writeBinaryStl(coverStl, coverMesh, "Tray_Cover");
  }

  if (config.moldKit?.enabled) {
    onProgress({
      phase: "stl",
      progress: 0.72,
      message: "Generating mold master and lid…",
    });
    try {
      const masterMesh = buildMoldMasterMesh(terrainWithGroove.mesh, config);
      const lidMesh = buildMoldLidMesh(config);
      assertWatertightMesh(masterMesh, "Mold_Master");
      assertWatertightMesh(lidMesh, "Mold_Lid");

      const masterStl = STL_FILE_NAMES.moldMaster;
      const lidStl = STL_FILE_NAMES.moldLid;
      await writeBinaryStl(masterStl, masterMesh, "Mold_Master");
      await writeBinaryStl(lidStl, lidMesh, "Mold_Lid");
    } catch (err) {
      if (err instanceof IpcException) throw err;
      const msg =
        err instanceof Error ? err.message : "Mold kit generation failed. Try again.";
      throw new IpcException("MOLD_KIT_FAILED", msg);
    }
  }

  if (config.sprayPaint.enabled) {
    if (!terrainWithGroove.heightPreview || !terrainWithGroove.crop) {
      throw new IpcException(
        "SPRAY_NO_TERRAIN",
        "Terrain preview data is missing. Cannot generate paint masks.",
      );
    }

    onProgress({
      phase: "masks",
      progress: 0.62,
      message: "Generating paint masks…",
    });

    let plan = req.sprayPaintPlan ?? null;
    try {
      if (!plan) {
        onProgress({
          phase: "masks",
          progress: 0.64,
          message: "Applying automatic colors…",
        });
        const segRes = await segmentSprayPaint(
          {
            config,
            heightPreview: terrainWithGroove.heightPreview,
            crop: terrainWithGroove.crop,
            viewportWidth,
            viewportHeight,
          },
          (p) => {
            onProgress({
              phase: "masks",
              progress: 0.64 + p.progress * 0.04,
              message: p.message,
            });
          },
        );
        plan = segRes.plan;
      } else {
        onProgress({
          phase: "masks",
          progress: 0.66,
          message: "Reusing preview color regions…",
        });
      }

      const maskRes = await generateSprayMasks(
        {
          config,
          plan,
          heightPreview: terrainWithGroove.heightPreview,
          crop: terrainWithGroove.crop,
        },
        (p) => {
          onProgress({
            phase: "masks",
            progress: 0.68 + p.progress * 0.08,
            message: p.message,
          });
        },
      );

      if (maskRes.masks.length === 0) {
        throw new IpcException(
          "SPRAY_MASK_EMPTY",
          "No masks were generated. Check the color regions and try again.",
        );
      }

      const zipCountBeforeMasks = names.length;
      for (const mask of maskRes.masks) {
        if (!mask.indices?.length || mask.indices.length < 3) continue;
        const maskPath = mask.fileName;
        await writeBinaryStl(maskPath, mask, mask.fileName);
      }

      if (names.length <= zipCountBeforeMasks) {
        throw new IpcException(
          "SPRAY_MASK_EMPTY",
          "The mask mesh is empty and cannot be exported",
        );
      }

      const manifest = await buildSprayPaintManifest(config, plan);
      await onFile(SPRAY_MANIFEST_FILE_NAME, new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`));
      names.push(SPRAY_MANIFEST_FILE_NAME);
    } catch (err) {
      if (err instanceof IpcException) throw err;
      const msg =
        err instanceof Error ? err.message : "Paint mask generation failed. Try again.";
      throw new IpcException("SPRAY_MASK_FAILED", msg);
    }
  }

  return names;
}
