import { useUiStore } from "@/stores/ui";
import { useConfigStore } from "@/stores/config";
import { useModelExport } from "@/composables/useModelExport";
import { useSpraySegmentation } from "@/composables/useSpraySegmentation";
import { serializeSprayPlan } from "@/utils/ipc-serialize";
import { validateModelGeneration } from "@shared/utils/model-validation";
import { physicalFootprintMm } from "@shared/utils/crop-region";
import { ensureMapZoomFitsTrail } from "@shared/utils/trail-fit";
import { computeTrayBottomMagnetHoles } from "@shared/utils/magnet-hole-layout";
import { logMagnetDebug } from "@shared/utils/magnet-debug-log";
import { computeTrayFootprint } from "@shared/utils/tray-footprint";
import type { ExportTarget, MountainTrailExportRequest } from "@shared/types/export";

export function useMountainTrailExport() {
  const ui = useUiStore();
  const configStore = useConfigStore();
  const { plan: sprayPlan } = useSpraySegmentation();

  const exporter = useModelExport<ExportTarget, MountainTrailExportRequest>({
    prepareRequest(target) {
      const vw = Math.round(ui.previewViewport.w);
      const vh = Math.round(ui.previewViewport.h);
      const check = validateModelGeneration(configStore.config, {
        viewportWidth: vw,
        viewportHeight: vh,
        trailOnly: target === "trail",
      });
      if (!check.valid) throw new Error(check.message ?? "Check the settings and try again");

      const snapshot = configStore.toSnapshot();
      const exportConfig = ensureMapZoomFitsTrail(snapshot, vw, vh);
      if (exportConfig.mapCrop.mapZoom !== snapshot.mapCrop.mapZoom) {
        configStore.config.mapCrop.mapCenterLat = exportConfig.mapCrop.mapCenterLat;
        configStore.config.mapCrop.mapCenterLon = exportConfig.mapCrop.mapCenterLon;
        configStore.config.mapCrop.mapZoom = exportConfig.mapCrop.mapZoom;
      }

      if (target === "all") {
        const footprint = computeTrayFootprint(exportConfig);
        const holes = computeTrayBottomMagnetHoles(exportConfig, footprint);
        logMagnetDebug({
          phase: "renderer-export",
          mapCropShape: exportConfig.mapCrop.shape,
          polygonSides: exportConfig.mapCrop.polygonSides,
          footprintShape: footprint.shape,
          outerVertCount: footprint.outer.length,
          magnetEnabled: exportConfig.assembly.magnet.enabled,
          circleCount: exportConfig.assembly.magnet.circleCount,
          holeCount: holes.length,
          holes,
          note: "Renderer snapshot before export; compare with the main-process TrailPrint:Magnet log",
        });
      }

      return {
        flow: "mountain-trail",
        config: exportConfig,
        viewportWidth: vw,
        viewportHeight: vh,
        target,
        sprayPaintPlan: target === "all" && exportConfig.sprayPaint.enabled && sprayPlan.value
          ? serializeSprayPlan(sprayPlan.value)
          : undefined,
      };
    },
    describeSuccess(response, request) {
      const name = response.savedPath!.split(/[/\\]/).pop();
      const foot = physicalFootprintMm(request.config.mapCrop);
      const sizeHint = request.config.mapCrop.shape === "circle"
        ? `Diameter ${(foot.radiusMm ?? 0) * 2}mm`
        : `${foot.widthMm}×${foot.heightMm}mm`;
      return `${window.trailPrint.runtime === "browser" ? "Download ready:" : "Saved"} ${name} (print area ${sizeHint}, ${Math.round(response.generationMs / 1000)} seconds)`;
    },
  });

  const generateAndSave = (target: ExportTarget = "all") => exporter.generateAndSave(target);
  const downloadTrail = () => generateAndSave("trail");
  return { generateAndSave, downloadTrail, generating: exporter.generating };
}
