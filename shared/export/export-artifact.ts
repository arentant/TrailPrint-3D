import type { GpxState, MapCropConfig, TerrainConfig, AssemblyConfig } from "../types/config.js";
import { physicalFootprintMm } from "../utils/crop-region.js";

type GpxFileSource = Pick<GpxState, "fileName" | "filePath" | "trackName">;

function safeStem(value: string, maxBytes = 180): string {
  let stem = value.normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]+/g, "_")
    .replace(/^[. ]+|[. ]+$/g, "");
  // Leave room for part suffixes within common filesystem filename limits.
  const encoder = new TextEncoder();
  const characters: string[] = [];
  let bytes = 0;
  for (const character of stem) {
    bytes += encoder.encode(character).length;
    if (bytes > maxBytes) break;
    characters.push(character);
  }
  stem = characters.join("").replace(/[. ]+$/g, "");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
  return stem;
}

/** Prefer the imported filename over the GPX's internal track title. */
export function gpxExportStem(gpx: GpxFileSource): string {
  for (const path of [gpx.fileName, gpx.filePath]) {
    const basename = path?.trim().split(/[/\\]/).pop()?.replace(/\.gpx$/i, "");
    const stem = basename ? safeStem(basename) : "";
    if (stem) return stem;
  }
  return safeStem(gpx.trackName ?? "") || "TrailPrint";
}

export function gpxExportFileName(gpx: GpxFileSource, partFileName: string): string {
  return `${gpxExportStem(gpx)}_${partFileName}`;
}

interface ExportNamingConfig {
  gpx: GpxFileSource;
  mapCrop: MapCropConfig;
  terrain: TerrainConfig;
  assembly?: AssemblyConfig;
}

/** One prefix for the archive, every part, and manifest references. Dimensions are millimeters. */
export function modelExportStem(config: ExportNamingConfig): string {
  const mm = (value: number) => String(Math.round(value * 1000) / 1000);
  const crop = config.mapCrop;
  const size = crop.shape === "rectangle"
    ? `${mm(crop.lengthMm)}x${mm(crop.widthMm)}mm`
    : `R${mm(physicalFootprintMm(crop).radiusMm!)}mm`;
  const shape = crop.shape === "polygon" ? `polygon${crop.polygonSides}` : crop.shape;
  const quality = config.terrain.meshQuality === "custom"
    ? `custom${config.terrain.meshQualityCustom.maxGrid}` : config.terrain.meshQuality;
  const magnet = config.assembly?.magnet;
  const magnetShape = magnet?.shape ?? "circle";
  const magnetSize = magnetShape === "rectangle"
    ? `${mm(magnet?.lengthMm ?? 6)}x${mm(magnet?.widthMm ?? 4)}x${mm(magnet?.thicknessMm ?? 2)}mm`
    : `${mm(magnet?.diameterMm ?? 6)}x${mm(magnet?.thicknessMm ?? 2)}mm`;
  const magnets = magnet?.enabled ? `on-${magnetShape}-${magnetSize}` : "off";
  const suffix = safeStem(`_${shape}_${size}_mesh-${quality}_magnets-${magnets}`);
  const name = safeStem(gpxExportStem(config.gpx), 180 - new TextEncoder().encode(suffix).length);
  return `${name}${suffix}`;
}

export function modelExportFileName(config: ExportNamingConfig, partFileName: string): string {
  return `${modelExportStem(config)}_${partFileName}`;
}
