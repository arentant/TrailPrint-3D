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
    return { valid: false, message: "Skirt height must be greater than 0" };
  }
  if (!(moldKit.skirtWidthMm > 0)) {
    return { valid: false, message: "Skirt extension must be greater than 0" };
  }
  if (moldKit.lidHeightMm < MOLD_LID_MIN_HEIGHT_MM) {
    return {
      valid: false,
      message: `The lid may warp if it is too thin. Recommended minimum height: ${MOLD_LID_MIN_HEIGHT_MM} mm`,
    };
  }
  if (moldKit.lidClearanceMm < 0) {
    return { valid: false, message: "Lid fit clearance cannot be negative" };
  }
  if (!(moldKit.lidWidthMm > moldKit.lidClearanceMm)) {
    return {
      valid: false,
      message: "Lid extension must exceed the fit clearance to create a valid outline",
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
