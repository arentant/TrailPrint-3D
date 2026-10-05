import type {
  TerrainCropRegion,
  TerrainGenerateProgress,
  TerrainGenerateRequest,
  TerrainGenerateResponse,
  TerrainMeshPayload,
} from "@shared/types/terrain";
import { computeTerrainCropRegion } from "@shared/utils/crop-region";
import { IpcException } from "@shared/ipc/types";
import { validateModelGeneration } from "@shared/utils/model-validation";
import { sampleDemGrid } from "./dem-provider";
import { applyTerrainSmoothing, fillDemHoles } from "./smoothing";
import {
  buildHeightfieldTerrainMesh,
  heightPreviewFromField,
  minHeightFieldMm,
} from "@shared/utils/heightfield-mesh";
import { buildTrailLineMesh } from "./trail-line-mesh";
import { buildTrailGrooveSpec, buildTrailLinePolyline } from "./trail-pipeline";
import { applyGrooveToHeightField } from "./trail-groove";
import { imprintGrooveOnTerrainMesh } from "@shared/utils/trail-groove-imprint";
import { hydrateGpxConfig } from "../gpx/hydrate-gpx-config";
import {
  trailLineWidthMmForPrint,
  trailHeightAboveMainMm,
} from "@shared/utils/footprint";
import { computeGrooveFloorZMm } from "@shared/utils/trail-groove-floor";
import { ensureMapZoomFitsTrail } from "@shared/utils/trail-fit";
import {
  demFetchTimeoutMs,
  gridResolutionForQuality,
  terrainMeshQualitySpec,
} from "@shared/utils/terrain-mesh-quality";

import { elevationsToHeightMmInPlace } from "./prepare-heightfield";

const EMPTY_TERRAIN_MESH: TerrainMeshPayload = {
  positions: [],
  indices: [],
  minSurfaceZ: 0,
  bottomZ: 0,
  gridCols: 0,
  gridRows: 0,
};

export type TerrainProgressCallback = (progress: TerrainGenerateProgress) => void;

function reportProgress(
  onProgress: TerrainProgressCallback | undefined,
  phase: TerrainGenerateProgress["phase"],
  progress: number,
  message: string,
): void {
  onProgress?.({ phase, progress, message });
}

export async function generateTerrainMain(
  req: TerrainGenerateRequest,
  onProgress?: TerrainProgressCallback,
): Promise<TerrainGenerateResponse> {
  const started = Date.now();
  let { config, viewportWidth, viewportHeight } = req;

  reportProgress(onProgress, "prepare", 0.02, "Preparing settings…");
  config = await hydrateGpxConfig(config);
  config = ensureMapZoomFitsTrail(config, viewportWidth, viewportHeight);

  const modelCheck = validateModelGeneration(config, {
    viewportWidth,
    viewportHeight,
    trailOnly: req.trailOnly,
  });
  if (!modelCheck.valid) {
    throw new IpcException(
      "MODEL_INVALID",
      modelCheck.message ?? "Cannot generate the model. Check the settings.",
    );
  }

  if (viewportWidth < 8 || viewportHeight < 8) {
    throw new IpcException(
      "INVALID_VIEWPORT",
      "The viewport is too small to calculate the crop area",
    );
  }

  reportProgress(onProgress, "crop", 0.08, "Calculating map crop area…");
  const crop = computeTerrainCropRegion(
    config.mapCrop,
    viewportWidth,
    viewportHeight,
  );

  const meshQuality = config.terrain.meshQuality ?? "high";
  const meshQualityCustom = config.terrain.meshQualityCustom ?? {
    maxGrid: 512,
  };
  const { cols, rows } = gridResolutionForQuality(
    crop.widthMm,
    crop.heightMm,
    meshQuality,
    meshQualityCustom,
  );
  const qualitySpec = terrainMeshQualitySpec(meshQuality, meshQualityCustom);
  const buildTrailMesh = Boolean(req.stlExport || req.trailOnly);
  const buildExportMesh = Boolean(req.stlExport && !req.trailOnly);

  reportProgress(
    onProgress,
    "dem",
    0.12,
    `Fetching elevation data (${cols}×${rows})…`,
  );
  const dem = await sampleDemGrid(
    crop,
    cols,
    rows,
    config.mapCrop,
    viewportWidth,
    viewportHeight,
    {
      dataset: config.terrain.demDataset,
      openTopographyApiKey: config.terrain.openTopographyApiKey,
      fetchTimeoutMs: demFetchTimeoutMs(meshQuality, meshQualityCustom),
    },
  );
  reportProgress(onProgress, "dem", 0.68, "Elevation data downloaded. Processing…");

  reportProgress(onProgress, "process", 0.72, "Processing terrain heightfield…");
  fillDemHoles(dem.elevations, cols, rows);
  const smoothed = applyTerrainSmoothing(
    dem.elevations,
    cols,
    rows,
    config.terrain.smoothing,
  );

  elevationsToHeightMmInPlace(
    smoothed,
    crop,
    config.terrain.zExaggeration,
    meshQuality,
    meshQualityCustom,
  );
  const heightMm = smoothed;
  const surfaceForTrail = new Float64Array(heightMm);
  let grooveFloorZ: number | undefined;
  let exportGroove: ReturnType<typeof buildTrailGrooveSpec> = undefined;

  if (buildTrailMesh) {
    exportGroove = buildTrailGrooveSpec(
      config,
      crop,
      viewportWidth,
      viewportHeight,
    );
    if (exportGroove) {
      grooveFloorZ = computeGrooveFloorZMm(exportGroove.depthMm);
      exportGroove.floorZMm = grooveFloorZ;
      if (buildExportMesh) {
        applyGrooveToHeightField(heightMm, cols, rows, crop, exportGroove);
      }
    }
  }

  const minSurfaceZ = minHeightFieldMm(heightMm);
  const baseThicknessMm = config.terrain.baseSolidThicknessMm;

  reportProgress(
    onProgress,
    "mesh",
    0.9,
    buildExportMesh ? "Generating printable mesh…" : "Generating preview data…",
  );
  let mesh: TerrainMeshPayload = buildExportMesh
    ? buildHeightfieldTerrainMesh(crop, heightMm, cols, rows, baseThicknessMm)
    : { ...EMPTY_TERRAIN_MESH, gridCols: cols, gridRows: rows };

  if (buildExportMesh && exportGroove) {
    mesh = imprintGrooveOnTerrainMesh(mesh, exportGroove);
  }

  const heightPreview = heightPreviewFromField(
    heightMm,
    cols,
    rows,
    baseThicknessMm,
    buildExportMesh ? mesh.minSurfaceZ : minSurfaceZ,
  );

  reportProgress(onProgress, "trail", 0.84, "Calculating trail position…");
  const polylineMm = buildTrailLinePolyline(
    config,
    crop,
    viewportWidth,
    viewportHeight,
  );
  const trailPolylineMm = exportGroove?.polylineMm ?? polylineMm;
  const printWidth = req.trailLineWidthMm ?? trailLineWidthMmForPrint(config);
  let trailMesh: TerrainMeshPayload | null = null;
  if (buildTrailMesh && trailPolylineMm.length >= 2) {
    trailMesh = buildTrailLineMesh({
      polylineMm: trailPolylineMm,
      widthMm: printWidth,
      depthMm: config.trail.trailDepthMm,
      heightMm: surfaceForTrail,
      cols,
      rows,
      crop,
      grooveFloorZMm: grooveFloorZ,
      zTopOffsetMm: trailHeightAboveMainMm(config),
      sampleStepMm: Math.max(
        qualitySpec.trailMinStepMm,
        printWidth / qualitySpec.trailStepDivisor,
      ),
    });
  }

  reportProgress(onProgress, "done", 1, "Terrain data ready");
  return {
    crop,
    mesh,
    heightPreview,
    trailMesh,
    trailPolylineMm: polylineMm,
    trailDisplayWidthMm: config.trail.trailWidthMm,
    demSource: dem.source,
    generationMs: Date.now() - started,
  };
}
