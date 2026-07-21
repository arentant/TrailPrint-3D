import type { AppConfig, MoldKitConfig } from "../types/config";

export interface MoldKitValidationResult {
  valid: boolean;
  message?: string;
}

/** 盖板最小厚度，过薄易翘曲 */
export const MOLD_LID_MIN_HEIGHT_MM = 1.0;

export function validateMoldKitConfig(
  moldKit: MoldKitConfig,
): MoldKitValidationResult {
  if (!moldKit.enabled) {
    return { valid: true };
  }

  if (!(moldKit.skirtHeightMm > 0)) {
    return { valid: false, message: "裙边高度必须大于 0" };
  }
  if (!(moldKit.skirtWidthMm > 0)) {
    return { valid: false, message: "裙边外扩宽度必须大于 0" };
  }
  if (moldKit.lidHeightMm < MOLD_LID_MIN_HEIGHT_MM) {
    return {
      valid: false,
      message: `盖板过薄易翘曲，高度建议至少 ${MOLD_LID_MIN_HEIGHT_MM} mm`,
    };
  }
  if (moldKit.lidClearanceMm < 0) {
    return { valid: false, message: "盖板配合间隙不能为负" };
  }
  if (!(moldKit.lidWidthMm > moldKit.lidClearanceMm)) {
    return {
      valid: false,
      message: "盖板外扩须大于配合间隙，否则盖板外廓无效",
    };
  }

  return { valid: true };
}

export function validateMoldKitFromAppConfig(
  config: AppConfig,
): MoldKitValidationResult {
  if (!config.moldKit) return { valid: true };
  return validateMoldKitConfig(config.moldKit);
}
