import type { MapCropConfig } from '../types/config.js';

/** The map camera can move while this reference frame retains the chosen ground area. */
export function cropSelectionFrame(mapCrop: MapCropConfig, width: number, height: number) {
  const selected = mapCrop.selection;
  if (!selected) return { mapCrop, width: Math.max(width, 64), height: Math.max(height, 64) };
  return { mapCrop: { ...mapCrop, selection: undefined,
    mapCenterLat: selected.mapCenterLat, mapCenterLon: selected.mapCenterLon,
    mapZoom: selected.mapZoom, mapBearingDeg: selected.mapBearingDeg, mapPaneX: 0, mapPaneY: 0 },
    width: selected.viewportWidth, height: selected.viewportHeight };
}
