import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { createDefaultCityConfig } from '@shared/types/city';
import type { GpxFileImport, GpxImportResult } from '@shared/types/gpx';
import { zoomToFitBoundsInMask } from '@shared/utils/map-projection';
import { useConfigStore } from './config';
import { useUiStore } from './ui';
import { combineGpxFiles, gpxFiles } from '@shared/utils/gpx-collection';
import { cityPictureDetails } from '@shared/city/picture-details';

export const useCityStore = defineStore('city', () => {
  const config = ref(createDefaultCityConfig());
  const fitNonce = ref(0);
  const mountain = useConfigStore();
  // One persisted credential; workspace terrain settings remain independent.
  watch(() => mountain.config.terrain.openTopographyApiKey, (key) => { config.value.terrain.openTopographyApiKey = key; }, { immediate: true, flush: 'sync' });
  function applyImport(result: GpxImportResult, fileName: string, filePath?: string) {
    addImports([{ ...result, importId: result.importId ?? crypto.randomUUID(), fileName, filePath }]);
  }
  function addImports(files: GpxFileImport[]) {
    const next = combineGpxFiles([...gpxFiles(config.value.gpx), ...files]);
    const firstImport = !config.value.gpx.imported;
    config.value.gpx = next;
    if (firstImport && files.length === 1) Object.assign(config.value.picture, cityPictureDetails(files[0], files[0].fileName ?? ''));
    fitGpxBounds();
  }
  function removeImport(importId: string) {
    config.value.gpx = combineGpxFiles(gpxFiles(config.value.gpx).filter(file => file.importId !== importId));
    fitGpxBounds();
  }
  function fitGpxBounds() {
    const bounds = config.value.gpx.bounds;
    if (!bounds) return;
    config.value.mapCrop.selection = undefined;
    const view = useUiStore().previewViewport;
    config.value.mapCrop.mapCenterLat = (bounds.minLat + bounds.maxLat) / 2;
    config.value.mapCrop.mapCenterLon = (bounds.minLon + bounds.maxLon) / 2;
    config.value.mapCrop.mapZoom = zoomToFitBoundsInMask(bounds, Math.max(view.w, 64), Math.max(view.h, 64), config.value.mapCrop);
    fitNonce.value++;
  }
  function clearGpx() {
    config.value.gpx = createDefaultCityConfig().gpx;
  }
  return { config, fitNonce, applyImport, addImports, removeImport, clearGpx };
});
