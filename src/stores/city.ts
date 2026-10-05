import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { createDefaultCityConfig } from '@shared/types/city';
import type { GpxImportResult } from '@shared/types/gpx';
import { zoomToFitBoundsInMask } from '@shared/utils/map-projection';
import { useConfigStore } from './config';
import { useUiStore } from './ui';

export const useCityStore = defineStore('city', () => {
  const config = ref(createDefaultCityConfig());
  const fitNonce = ref(0);
  const mountain = useConfigStore();
  // One persisted credential; workspace terrain settings remain independent.
  watch(() => mountain.config.terrain.openTopographyApiKey, (key) => { config.value.terrain.openTopographyApiKey = key; }, { immediate: true, flush: 'sync' });
  function applyImport(result: GpxImportResult, fileName: string, filePath?: string) {
    config.value.gpx = {
      imported: true, importId: result.importId, segments: result.segments,
      points: result.points, rawPoints: result.points, bounds: result.bounds,
      fileName, filePath, trackName: result.trackName, pointCount: result.pointCount, distanceKm: result.distanceKm,
    };
    const view = useUiStore().previewViewport;
    config.value.mapCrop.mapCenterLat = result.suggestedCenter.lat;
    config.value.mapCrop.mapCenterLon = result.suggestedCenter.lon;
    config.value.mapCrop.mapZoom = zoomToFitBoundsInMask(result.bounds, Math.max(view.w, 64), Math.max(view.h, 64), config.value.mapCrop);
    fitNonce.value++;
  }
  return { config, fitNonce, applyImport };
});
