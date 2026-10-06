import type { GpxState } from "../types/config.js";

type GpxFileSource = Pick<GpxState, "fileName" | "filePath" | "trackName">;

function safeStem(value: string): string {
  let stem = value.normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]+/g, "_")
    .replace(/^[. ]+|[. ]+$/g, "");
  // Leave room for part suffixes within common filesystem filename limits.
  const encoder = new TextEncoder();
  const characters: string[] = [];
  let bytes = 0;
  for (const character of stem) {
    bytes += encoder.encode(character).length;
    if (bytes > 180) break;
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
