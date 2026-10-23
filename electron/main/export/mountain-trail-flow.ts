import {
  STL_FILE_NAMES,
  TRAY_AMS_FILE_NAME,
  MODEL_3MF_FILE_NAME,
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
import { getManifold } from "../city/manifold-runtime";
import { buildTerrainColorVolumes } from "@shared/utils/terrain-color-volumes";
import { normalizeModelColors } from "@shared/types/model-colors";
import { encodeColored3mf, normalizePartToBed, type PrintableGroup } from "@shared/export/colored-3mf";
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
  const placements: Array<{ file: string; assemblyTranslationMm: number[] }> = [];
  const fileName = (part: string) => modelExportFileName(req.config, part);
  async function writeBinaryStl(name: string, mesh: TerrainMeshPayload): Promise<void> {
    if (req.target === "model-3mf") return;
    const normalized = normalizePartToBed(mesh);
    placements.push({ file: name, assemblyTranslationMm: normalized.assemblyTranslation });
    await onFile(name, encodeBinaryStl(normalized.mesh, name.replace(/\.stl$/i, "")));
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
    message: req.target === "trail" ? "Generating trail model…" : "Generating terrain model…",
  });

  const terrainWithGroove = await generateTerrainMain({
    config,
    viewportWidth,
    viewportHeight,
    stlExport: true,
    waterCatalog: req.waterCatalog,
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

  if (config.tray.enabled) onProgress({ phase: "tray", progress: 0.45, message: "Generating tray base…" });

  const trayFootprint = config.tray.enabled ? computeTrayFootprint(config) : null;
  if (trayFootprint && config.assembly.magnet.enabled) {
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

  const tray = config.tray.enabled ? (await generateTrayBase({
    config,
    viewportWidth,
    viewportHeight,
  })).mesh : null;

  const trailPoints = config.gpx.points.length || config.gpx.rawPoints.length;
  const trailPolylinePts = terrainWithGroove.trailPolylinesMm?.reduce((sum, path) => sum + path.length, 0)
    ?? terrainWithGroove.trailPolylineMm?.length ?? 0;
  if (config.gpx.imported && !terrainWithGroove.trailMesh) {
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
  if (tray) assertWatertightMesh(tray, "Tray_Base");
  if (terrainWithGroove.trailMesh) {
    assertTrailLineMesh(terrainWithGroove.trailMesh, "Trail_Line");
  }

  await writeBinaryStl(terrainStl, terrainWithGroove.mesh);
  if (terrainWithGroove.trailMesh) await writeBinaryStl(trailStl, terrainWithGroove.trailMesh);
  if (tray) await writeBinaryStl(trayStl, tray.baseMesh ?? tray);
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
    const instructions = [
      'TrailPrint water assembly', '', `Water inserts: ${waterParts.length}.`,
      `Water files: ${waterNames.join(', ') || 'None at this print scale.'}`, '',
      ...(config.printMode === 'fused' ? [
        'Open Model.3mf in Bambu Studio and map terrain, trail and water colors to your AMS filaments.',
        'Print the touching material volumes together. Use your own printer and filament profiles.',
      ] : [
        '1. Print each STL on the print bed without scaling. STL coordinates are centered with minimum Z = 0.',
        '2. Match each water outline to its terrain recess, then lower it onto the flat pocket floor.',
        '3. Dry-fit the parts; leave inserts seated or use a small amount of glue.',
        '4. Test a clearance coupon first. Increase clearance for easier fitting.',
      ]), '',
      `Minimum water thickness: ${config.water.thicknessMm} mm.`,
      `Fitting clearance: ${config.printMode === 'fused' ? 0 : config.water.clearanceMm} mm per side of shoreline and island edges.`,
      `Print mode: ${config.printMode ?? 'separate'}.`,
      'Islands, trail support and a 0.6 mm crop border remain in the terrain.',
      ...(terrainWithGroove.waterWarnings ?? []), '',
      ...(terrainWithGroove.waterAttribution ?? []).map(source => `${source.attribution}, ${source.url} (${source.license}; version ${source.version})`), '',
    ].join('\n');
    if (req.target !== 'model-3mf') await onFile(fileName('Water_Assembly.txt'), new TextEncoder().encode(instructions));
  }
  if (tray?.baseMesh && tray.textMesh) {
    assertWatertightMesh(tray.textMesh, "Tray_Text");
    await writeBinaryStl(fileName(STL_FILE_NAMES.trayText), tray.textMesh);
    const colors = normalizeModelColors(config.colors);
    if (req.target !== "model-3mf") await onFile(fileName(TRAY_AMS_FILE_NAME), encodeTrayAms3mf(tray.baseMesh, tray.textMesh, colors.tray, colors.text));
  }

  const colors = normalizeModelColors(config.colors);
  const colorPlan = config.sprayPaint.enabled ? req.sprayPaintPlan : null;
  if (colorPlan) onProgress({ phase: 'model', progress: 0.61, message: 'Preparing printable terrain colors…' });
  const terrainParts = colorPlan
    ? buildTerrainColorVolumes(await getManifold(), terrainWithGroove.mesh, terrainWithGroove.crop, colorPlan)
    : [{ name: 'Terrain', color: colors.terrain, mesh: terrainWithGroove.mesh }];
  const groups: PrintableGroup[] = [{ name: 'Terrain, trail and water', parts: [
    ...terrainParts,
    ...(terrainWithGroove.trailMesh ? [{ name: 'Trail', color: colors.trail, mesh: terrainWithGroove.trailMesh }] : []),
    ...(terrainWithGroove.waterMeshes ?? []).map((mesh, i) => {
      const mapping = terrainWithGroove.waterPartMappings?.find(part => part.partIndex === i);
      const names = [...new Set(mapping?.featureIds.map(id => terrainWithGroove.waterFeatureDetails?.find(feature => feature.id === id)?.name).filter(Boolean))];
      return { name: `Water ${i + 1}: ${names?.join(', ') || 'Water'}`, color: colors.water, mesh };
    }),
  ] }, ...(tray ? [{ name: 'Tray and text', parts: [
    { name: 'Tray', color: colors.tray, mesh: tray.baseMesh ?? tray },
    ...(tray.textMesh ? [{ name: 'Text', color: colors.text, mesh: tray.textMesh }] : []),
  ] }] : [])];
  const waterManifest = { printMode: config.printMode ?? 'separate',
    sources: terrainWithGroove.waterAttribution ?? [], coverageErrors: terrainWithGroove.waterCoverageErrors ?? [],
    featureStatuses: terrainWithGroove.waterFeatureStatuses ?? [], features: terrainWithGroove.waterFeatureDetails ?? [], partMappings: terrainWithGroove.waterPartMappings ?? [] };
  const model3mf = req.target === "model-3mf" || config.printMode === "fused" || colorPlan ? encodeColored3mf(groups, modelExportStem(config), waterManifest) : undefined;
  if (req.target === 'model-3mf') {
    // A single-file target emits exactly its described artifact.
    await onFile(fileName(MODEL_3MF_FILE_NAME), model3mf!);
    return;
  }
  if (model3mf) {
    await onFile(fileName(MODEL_3MF_FILE_NAME), model3mf);
  }

  if (trayFootprint && config.tray.nfc.enabled) {
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
  await onFile(fileName('Assembly.json'), new TextEncoder().encode(JSON.stringify({
    units: 'millimeter', stlToAssembly: placements, water: waterManifest,
  }, null, 2)));
  await onFile(fileName('Assembly.txt'), new TextEncoder().encode([
    'TrailPrint assembly placement', 'Every STL is centered in XY and placed on the print bed (minimum Z = 0).',
    'Add each translation below to the STL vertices to restore model assembly coordinates. Do not scale parts.',
    ...placements.map(p => `${p.file}: translate [${p.assemblyTranslationMm.join(', ')}] mm`),
    '', `Print mode: ${config.printMode ?? 'separate'}.`,
    config.printMode === 'fused' ? 'Use Model.3mf to print the touching material volumes together.' : 'Assemble the separate terrain, trail and water pieces after printing.',
  ].join('\n')));

}

export const mountainTrailExportFlow: ModelExportFlow<MountainTrailExportRequest> = {
  describeArtifact: (request) => request.target === "model-3mf"
    ? { kind: "file", fileName: modelExportFileName(request.config, MODEL_3MF_FILE_NAME), extension: "3mf", mimeType: "model/3mf", saveDialogTitle: "Save complete multicolor model" }
    : request.target === "ams-base"
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
