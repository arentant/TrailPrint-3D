import type { AppConfig } from "@shared/types/config";
import { STL_FILE_NAMES } from "@shared/types/export";
import type { SprayPaintPlan } from "@shared/types/spray-paint";

export const SPRAY_MANIFEST_FILE_NAME = "spray_paint_manifest.json";

export interface SprayPaintManifestColor {
  index: number;
  hex: string;
  label: string;
  description?: string;
  stl: string;
  regionId: number;
}

export interface SprayPaintManifest {
  version: 1;
  colorCount: number;
  categoryRuleVersion: number;
  colors: SprayPaintManifestColor[];
  maskShellThicknessMm: number;
  maskFitToleranceMm: number;
  bleedMarginMm: number;
  terrainStl: string;
  maskMode: "negative";
  generatedAt: number;
  gridCols?: number;
  gridRows?: number;
  cellRegionsHash?: string;
}

function maskStlFileName(colorIndex: number): string {
  return `Mask_Color_${String(colorIndex).padStart(2, "0")}.stl`;
}

async function hashCellRegions(cellRegions: number[]): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(cellRegions));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildSprayPaintManifest(
  config: AppConfig,
  plan: SprayPaintPlan,
): Promise<SprayPaintManifest> {
  const spray = config.sprayPaint;
  return {
    version: 1,
    colorCount: spray.colorCount,
    categoryRuleVersion: spray.categoryRuleVersion,
    colors: plan.colors.map((slot) => ({
      index: slot.index,
      hex: slot.hex,
      label: slot.label,
      description: slot.description,
      stl: maskStlFileName(slot.index),
      regionId: slot.regionId,
    })),
    maskShellThicknessMm: spray.maskShellThicknessMm,
    maskFitToleranceMm: spray.maskFitToleranceMm,
    bleedMarginMm: spray.bleedMarginMm,
    terrainStl: STL_FILE_NAMES.terrainMain,
    maskMode: "negative",
    generatedAt: plan.generatedAt,
    gridCols: plan.gridCols,
    gridRows: plan.gridRows,
    cellRegionsHash: await hashCellRegions(plan.cellRegions),
  };
}

