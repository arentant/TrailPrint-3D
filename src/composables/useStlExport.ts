import { storeToRefs } from "pinia";
import { useUiStore } from "@/stores/ui";
import { useConfigStore } from "@/stores/config";
import { formatIpcError, ipcGenerateExport } from "@/ipc/client";
import { useSpraySegmentation } from "@/composables/useSpraySegmentation";
import { serializeSprayPlan } from "@/utils/ipc-serialize";
import { validateModelGeneration } from "@shared/utils/model-validation";
import { physicalFootprintMm } from "@shared/utils/crop-region";
import { ensureMapZoomFitsTrail } from "@shared/utils/trail-fit";
import { computeTrayBottomMagnetHoles } from "@shared/utils/magnet-hole-layout";
import { logMagnetDebug } from "@shared/utils/magnet-debug-log";
import { computeTrayFootprint } from "@shared/utils/tray-footprint";
import type { ExportTarget } from "@shared/types/export";

function exportFileName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] ?? path;
}

export function useStlExport() {
  const ui = useUiStore();
  const configStore = useConfigStore();
  const { generating, statusMessage } = storeToRefs(ui);
  const { plan: sprayPlan } = useSpraySegmentation();

  async function generateAndSave(target: ExportTarget = "all"): Promise<void> {
    if (generating.value) return;
    ui.runPrepareExport();
    if (!configStore.config.gpx.imported) {
      statusMessage.value = "Import a GPX track first";
      return;
    }
    const check = validateModelGeneration(configStore.config, {
      viewportWidth: Math.round(ui.previewViewport.w),
      viewportHeight: Math.round(ui.previewViewport.h),
      trailOnly: target === "trail",
    });
    if (!check.valid) {
      statusMessage.value = check.message ?? "Check the settings and try again";
      return;
    }
    generating.value = true;
    ui.exportProgress = 0;
    statusMessage.value = "Preparing export…";
    const { w, h } = ui.previewViewport;
    const vw = Math.round(w);
    const vh = Math.round(h);
    const snapshot = configStore.toSnapshot();
    const exportConfig = ensureMapZoomFitsTrail(snapshot, vw, vh);
    if (exportConfig.mapCrop.mapZoom !== snapshot.mapCrop.mapZoom) {
      configStore.config.mapCrop.mapCenterLat = exportConfig.mapCrop.mapCenterLat;
      configStore.config.mapCrop.mapCenterLon = exportConfig.mapCrop.mapCenterLon;
      configStore.config.mapCrop.mapZoom = exportConfig.mapCrop.mapZoom;
    }

    if (target === "all") {
      const exportFootprint = computeTrayFootprint(exportConfig);
      const exportHoles = computeTrayBottomMagnetHoles(exportConfig, exportFootprint);
      logMagnetDebug({
        phase: "renderer-export",
        mapCropShape: exportConfig.mapCrop.shape,
        polygonSides: exportConfig.mapCrop.polygonSides,
        footprintShape: exportFootprint.shape,
        outerVertCount: exportFootprint.outer.length,
        magnetEnabled: exportConfig.assembly.magnet.enabled,
        circleCount: exportConfig.assembly.magnet.circleCount,
        holeCount: exportHoles.length,
        holes: exportHoles,
        note: "Renderer snapshot before export; compare with the main-process TrailPrint:Magnet log",
      });
    }

    try {
      const res = await ipcGenerateExport({
        config: exportConfig,
        viewportWidth: vw,
        viewportHeight: vh,
        target,
        sprayPaintPlan:
          target === "all" && exportConfig.sprayPaint.enabled && sprayPlan.value
            ? serializeSprayPlan(sprayPlan.value)
            : undefined,
      });
      if (res.cancelled) {
        statusMessage.value =
          "Export canceled. Choose Download again and select a save location.";
      } else if (res.savedPath) {
        ui.lastExportPath = res.savedPath;
        const name = exportFileName(res.savedPath);
        const foot = physicalFootprintMm(configStore.config.mapCrop);
        const sizeHint =
          configStore.config.mapCrop.shape === "circle"
            ? `Diameter ${(foot.radiusMm ?? 0) * 2}mm`
            : `${foot.widthMm}×${foot.heightMm}mm`;
        statusMessage.value = `${window.trailPrint.runtime === "browser" ? "Download ready:" : "Saved"} ${name} (print area ${sizeHint}, ${Math.round(res.generationMs / 1000)} seconds)`;
      }
    } catch (err) {
      statusMessage.value = formatIpcError(err);
    } finally {
      generating.value = false;
      ui.exportProgress = 0;
    }
  }

  const downloadTrail = () => generateAndSave("trail");
  return { generateAndSave, downloadTrail, generating };
}
