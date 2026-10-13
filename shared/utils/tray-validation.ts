import type { AppConfig, TrayConfig } from "../types/config";
import type { TrayValidationResult } from "../types/tray";
import { computeTrayCoverPolygon, computeTrayNfcCavityPolygon } from "./tray-nfc-layout";
import { computeTrayFootprint } from "./tray-footprint";
import { buildTrayTextLayout } from "./tray-text-layout";
import { assertKeychainClearance, computeTrayKeychainHole, KEYCHAIN_MIN_WALL_MM } from "./tray-keychain-layout";
import { computeTrayBottomMagnetHoles } from "./magnet-hole-layout";
import { magnetCutDimensionsMm, magnetPocketVertsMm } from "./magnet-hole-geometry";

const MIN_BOTTOM_FLOOR_MM = 0.3;

export function validateTrayConfig(tray: TrayConfig): TrayValidationResult {
  if (![tray.totalThicknessMm, tray.recessDepthMm, tray.rimWidthMm].every(Number.isFinite)) {
    return { valid: false, message: "Tray dimensions must be finite numbers" };
  }
  if (tray.recessDepthMm >= tray.totalThicknessMm) {
    return {
      valid: false,
      message: "Recess depth must be less than total thickness",
    };
  }
  if (tray.recessDepthMm <= 0) {
    return { valid: false, message: "Recess depth must be greater than 0" };
  }
  if (tray.totalThicknessMm <= 0) {
    return { valid: false, message: "Total thickness must be greater than 0" };
  }
  if (tray.rimWidthMm <= 0) {
    return { valid: false, message: "Rim width must be greater than 0" };
  }

  if (tray.nfc?.enabled) {
    const nfc = tray.nfc;
    if (nfc.wallClearanceMm < 0) {
      return { valid: false, message: "NFC inset cannot be negative" };
    }
    if (nfc.recessDepthMm <= 0) {
      return { valid: false, message: "NFC recess depth must be greater than 0" };
    }
    if (nfc.ledExtraRecessDepthMm < 0) {
      return { valid: false, message: "Extra LED depth cannot be negative" };
    }
    if (nfc.ledPocketLengthMm <= 0) {
      return { valid: false, message: "LED pocket length must be greater than 0" };
    }
    if (nfc.ledPocketWidthMm <= 0) {
      return { valid: false, message: "LED pocket width must be greater than 0" };
    }
    if (nfc.coverThicknessMm <= 0) {
      return { valid: false, message: "Cover thickness must be greater than 0" };
    }
    if (nfc.coverInsetMm < 0) {
      return { valid: false, message: "Cover inset cannot be negative" };
    }
    const bottomSolidMm = tray.totalThicknessMm - tray.recessDepthMm;
    const maxLedDepth = bottomSolidMm - MIN_BOTTOM_FLOOR_MM;
    const maxNfcDepth = maxLedDepth - nfc.ledExtraRecessDepthMm;
    if (nfc.recessDepthMm > maxNfcDepth) {
      return {
        valid: false,
        message: `NFC recess is too deep (available base thickness: ${bottomSolidMm.toFixed(1)} mm; reduce the NFC or LED depth)`,
      };
    }
    if (nfc.recessDepthMm + nfc.ledExtraRecessDepthMm > maxLedDepth) {
      return {
        valid: false,
        message: "Combined NFC and LED depth exceeds the available base thickness",
      };
    }
  }

  return { valid: true };
}

export function validateTrayFromAppConfig(
  config: AppConfig,
): TrayValidationResult {
  const base = validateTrayConfig(config.tray);
  if (!base.valid) return base;
  if (!Number.isFinite(config.assembly.trayToleranceMm) || config.assembly.trayToleranceMm < 0) {
    return { valid: false, message: "Base recess clearance must be 0 or greater" };
  }
  try {
    const text = buildTrayTextLayout(config);
    const footprint = computeTrayFootprint(config);
    const keychain = computeTrayKeychainHole(footprint, config.tray);
    if (keychain) {
      assertKeychainClearance(keychain, text.map(s => s.contour), 0.6,
        "The keychain hole overlaps a base label. Move the hole along the rim or choose another edge.");
      if (config.assembly.magnet.enabled) {
        const cut = magnetCutDimensionsMm(config.assembly.magnet);
        const contours = computeTrayBottomMagnetHoles(config, footprint).map(p => magnetPocketVertsMm(p.x, p.y, cut.radiusMm, cut));
        assertKeychainClearance(keychain, contours, KEYCHAIN_MIN_WALL_MM,
          "Keep at least 2 mm between the keychain hole and magnet pockets. Move the hole or reduce the pocket size.");
      }
    }
  } catch (error) {
    return { valid: false, message: error instanceof Error ? error.message : "Check base text and keychain settings" };
  }

  if (config.tray.nfc.enabled) {
    const footprint = computeTrayFootprint(config);
    const cavity = computeTrayNfcCavityPolygon(
      config,
      footprint,
      config.tray.nfc.wallClearanceMm,
    );
    if (!cavity) {
      return {
        valid: false,
        message: "The NFC recess is too small. Reduce Inset from print edge or increase the print size.",
      };
    }
  }

  if (config.tray.nfc.enabled && config.tray.nfc.coverInsetMm > 0) {
    const outline = computeTrayCoverPolygon(
      config,
      config.tray.nfc.coverInsetMm,
    );
    if (!outline) {
      return {
        valid: false,
        message: "Cover inset is too large. Reduce the inset or increase the print size.",
      };
    }
  }

  return { valid: true };
}
