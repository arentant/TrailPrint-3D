import {
  STL_FILE_NAMES,
  TRAY_AMS_FILE_NAME,
  type MountainTrailExportRequest,
  type ExportFileSink,
  type ExportProgressCallback,
  type ModelExportFlow,
} from "@shared/types/export";
import { modelExportFileName, modelExportStem } from "@shared/export/export-artifact";
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
import { normalizeModelColors } from "@shared/types/model-colors";
import { encodeTrayAms3mf } from "@shared/export/tray-ams-3mf";
import { segmentSprayPaint } from "../spray-paint/segment-service";
import { generateSprayMasks } from "../spray-paint/mask-generate-service";
import {
  SPRAY_MANIFEST_FILE_NAME,
  buildSprayPaintManifest,
} from "@shared/utils/spray-manifest";

async function generateMountainTrailFiles(
  req: MountainTrailExportRequest,
  onProgress: ExportProgressCallback,
  onFile: ExportFileSink,
): Promise<void> {
  const names: string[] = [];
  const fileName = (part: string) => modelExportFileName(req.config, part);
  async function writeBinaryStl(name: string, mesh: TerrainMeshPayload): Promise<void> {
    await onFile(name, encodeBinaryStl(mesh, name.replace(/\.stl$/i, "")));
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

  if (req.target === "ams-base") {
    onProgress({ phase: "tray", progress: 0.3, message: "Generating base and text for AMS…" });
    const tray = (await generateTrayBase({ config, viewportWidth, viewportHeight })).mesh;
    if (!tray.baseMesh || !tray.textMesh) throw new IpcException("TEXT_REQUIRED", "Enable Text on base and enter a label to export the AMS base.");
    const colors = normalizeModelColors(config.colors);
    await onFile(fileName(TRAY_AMS_FILE_NAME), encodeTrayAms3mf(tray.baseMesh, tray.textMesh, colors.tray, colors.text));
    return;
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
    await writeBinaryStl(fileName(STL_FILE_NAMES.trailLine), terrainWithGroove.trailMesh);
    return;
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

  const terrainStl = fileName(STL_FILE_NAMES.terrainMain);
  const trailStl = fileName(STL_FILE_NAMES.trailLine);
  const trayStl = fileName(STL_FILE_NAMES.trayBase);

  assertWatertightMesh(terrainWithGroove.mesh, "Terrain_Main");
  assertWatertightMesh(trayRes.mesh, "Tray_Base");
  if (terrainWithGroove.trailMesh) {
    assertTrailLineMesh(terrainWithGroove.trailMesh, "Trail_Line");
  }

  await writeBinaryStl(terrainStl, terrainWithGroove.mesh);
  await writeBinaryStl(trailStl, terrainWithGroove.trailMesh);
  await writeBinaryStl(trayStl, trayRes.mesh.baseMesh ?? trayRes.mesh);
  if (config.water?.enabled) {
    const waterParts = terrainWithGroove.waterMeshes ?? [];
    const waterNames: string[] = [];
    for (let i = 0; i < waterParts.length; i++) {
      const part = waterParts[i]!;
      assertWatertightMesh(part, `Water insert ${i + 1}`);
      const name = waterParts.length === 1 ? STL_FILE_NAMES.waterInsert
        : STL_FILE_NAMES.waterInsert.replace('.stl', `_${String(i + 1).padStart(2, '0')}.stl`);
      waterNames.push(fileName(name));
      await writeBinaryStl(fileName(name), part);
    }
    const pins = terrainWithGroove.waterPinMeshes ?? [];
    if (pins.length) {
      // Dowels are loose parts: arrange upright on the print bed rather than
      // leaving them suspended at their terrain assembly elevations.
      const positions: number[] = [], indices: number[] = [];
      const columns = Math.ceil(Math.sqrt(pins.length));
      const spacing = config.water.pinDiameterMm + 3;
      for (let i = 0; i < pins.length; i++) {
        const pin = pins[i]!;
        const offset = positions.length / 3;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let v = 0; v < pin.positions.length; v += 3) {
          minX = Math.min(minX, pin.positions[v]!); maxX = Math.max(maxX, pin.positions[v]!);
          minY = Math.min(minY, pin.positions[v + 1]!); maxY = Math.max(maxY, pin.positions[v + 1]!);
        }
        for (let v = 0; v < pin.positions.length; v += 3) {
          positions.push(pin.positions[v]! - (minX + maxX) / 2 + i % columns * spacing,
            pin.positions[v + 1]! - (minY + maxY) / 2 + Math.floor(i / columns) * spacing,
            pin.positions[v + 2]! - pin.bottomZ);
        }
        indices.push(...pin.indices.map((index) => index + offset));
      }
      const printPins = { ...pins[0]!, positions, indices, bottomZ: 0, minSurfaceZ: 0 };
      assertWatertightMesh(printPins, 'Water_Pins');
      await writeBinaryStl(fileName(STL_FILE_NAMES.waterPins), printPins);
    }
    const instructions = [
      'TrailPrint water assembly', '',
      `Water inserts: ${waterParts.length}. Alignment pins: ${pins.length}.`,
      `Water files: ${waterNames.join(', ') || 'None detected at this print scale.'}`,
      '',
      ...(waterParts.length ? [
      '1. Print Terrain_Main and each water insert separately. Water insert files retain terrain assembly coordinates: move each part down to the print bed without scaling it.',
      '2. Print Water_Pins.stl upright as supplied. The dowels are already arranged at Z=0.',
      '3. Put the dowels into the sockets in each terrain pocket. Match the water outline, then lower its underside sockets onto the exposed dowels.',
      '4. Dry-fit all parts before adding a small amount of glue if a permanent connection is wanted.',
      ] : ['No water inserts or pins were generated. Print the terrain and trail parts as usual.']),
      '',
      `Minimum water thickness: ${config.water.thicknessMm} mm. Pin diameter: ${config.water.pinDiameterMm} mm. Socket depth in each part: ${config.water.pinDepthMm} mm.`,
      `Fitting clearance: ${config.water.clearanceMm} mm per side. Pin length: ${(2 * config.water.pinDepthMm - 0.1).toFixed(2)} mm.`,
      'Islands and the trail corridor remain part of the terrain. A 0.6 mm terrain wall protects the crop edge. Small areas that cannot hold a pin socket are omitted.',
      'Detection uses mapped inland water polygons; unmapped water, river centerlines and ocean coastlines are not detected.',
      ...(terrainWithGroove.waterWarnings ?? []), '',
      'Water map data © OpenStreetMap contributors, https://www.openstreetmap.org/copyright (ODbL).', '',
    ].join('\n');
    await onFile(fileName('Water_Assembly.txt'), new TextEncoder().encode(instructions));
  }
  if (trayRes.mesh.baseMesh && trayRes.mesh.textMesh) {
    assertWatertightMesh(trayRes.mesh.textMesh, "Tray_Text");
    await writeBinaryStl(fileName(STL_FILE_NAMES.trayText), trayRes.mesh.textMesh);
    const colors = normalizeModelColors(config.colors);
    await onFile(fileName(TRAY_AMS_FILE_NAME), encodeTrayAms3mf(trayRes.mesh.baseMesh, trayRes.mesh.textMesh, colors.tray, colors.text));
  }

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
    const coverStl = fileName(STL_FILE_NAMES.trayCover);
    await writeBinaryStl(coverStl, coverMesh);
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

      const masterStl = fileName(STL_FILE_NAMES.moldMaster);
      const lidStl = fileName(STL_FILE_NAMES.moldLid);
      await writeBinaryStl(masterStl, masterMesh);
      await writeBinaryStl(lidStl, lidMesh);
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
        const maskPath = fileName(mask.fileName);
        await writeBinaryStl(maskPath, mask);
      }

      if (names.length <= zipCountBeforeMasks) {
        throw new IpcException(
          "SPRAY_MASK_EMPTY",
          "The mask mesh is empty and cannot be exported",
        );
      }

      const manifest = await buildSprayPaintManifest(req.config, plan);
      const manifestName = fileName(SPRAY_MANIFEST_FILE_NAME);
      await onFile(manifestName, new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`));
      names.push(manifestName);
    } catch (err) {
      if (err instanceof IpcException) throw err;
      const msg =
        err instanceof Error ? err.message : "Paint mask generation failed. Try again.";
      throw new IpcException("SPRAY_MASK_FAILED", msg);
    }
  }
}

export const mountainTrailExportFlow: ModelExportFlow<MountainTrailExportRequest> = {
  describeArtifact: (request) => request.target === "ams-base"
    ? { kind: "file", fileName: modelExportFileName(request.config, TRAY_AMS_FILE_NAME), extension: "3mf", mimeType: "model/3mf", saveDialogTitle: "Save AMS base with text" }
    : request.target === "trail"
    ? {
      kind: "file",
      fileName: modelExportFileName(request.config, STL_FILE_NAMES.trailLine),
      extension: "stl",
      mimeType: "model/stl",
      saveDialogTitle: "Save trail STL",
    }
    : {
      kind: "zip",
      fileName: `${modelExportStem(request.config)}.zip`,
      extension: "zip",
      mimeType: "application/zip",
      saveDialogTitle: "Save TrailPrint STL archive",
    },
  generateFiles: generateMountainTrailFiles,
};
