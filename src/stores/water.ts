import { computed, markRaw, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { useConfigStore } from './config';
import { useUiStore } from './ui';
import type { WaterCatalog, WaterFeature, WaterFeatureStatus } from '@shared/types/water';
import { waterCatalogKey } from '@shared/water/catalog';
import { computeTerrainCropRegion } from '@shared/utils/crop-region';
import { prepareWaterSelection } from '@shared/water/selection';
import { buildTrailLinePolylines } from '../../electron/main/terrain/trail-pipeline';
import { maskMmScale } from '@shared/utils/map-mm-projection';
import { containerPointToLatLng } from '@shared/utils/leaflet-projection';
import { getManifold } from '@/browser/manifold-runtime';
import { formatIpcError } from '@/ipc/client';

export interface WaterReviewFeature { feature: WaterFeature; status: WaterFeatureStatus; geometry: { type: 'Polygon'; coordinates: number[][][] } }
export const useWaterStore = defineStore('water', () => {
  const settings = useConfigStore(), ui = useUiStore();
  const catalog = ref<WaterCatalog | null>(null);
  const review = ref<WaterReviewFeature[]>([]);
  const loading = ref(false), reviewing = ref(false), cancelled = ref(false);
  const error = ref<string | null>(null);
  let requestId: string | undefined, revision = 0, reviewRevision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = () => ({ mapCrop: JSON.parse(JSON.stringify(settings.config.mapCrop)), viewportWidth: Math.round(ui.previewViewport.w), viewportHeight: Math.round(ui.previewViewport.h) });
  const currentCatalog = computed(() => catalog.value?.key === waterCatalogKey(request()) ? catalog.value : undefined);
  const coverageErrors = computed(() => catalog.value?.errors ?? []);
  const includedCount = computed(() => review.value.filter(f => f.status.state === 'included').length);
  const canUncheckAll = computed(() => currentCatalog.value?.features.some(feature => !settings.config.water.excludedFeatureIds.includes(feature.id)) ?? false);
  function cancel() {
    revision++;
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (requestId) void window.trailPrint.cancelWaterCatalog(requestId);
    requestId = undefined; loading.value = false; cancelled.value = true;
  }
  async function refresh(force = true) {
    cancel(); cancelled.value = false; catalog.value = null; review.value = []; error.value = null;
    const req = request();
    if (!settings.config.water.enabled || req.viewportWidth < 64 || req.viewportHeight < 64) return;
    const id = revision; requestId = crypto.randomUUID(); loading.value = true;
    try {
      const result = await window.trailPrint.fetchWaterCatalog({ ...req, requestId, refresh: force });
      if (id === revision) catalog.value = markRaw(result);
    } catch (err) { if (id === revision) error.value = formatIpcError(err); }
    finally { if (id === revision) { loading.value = false; requestId = undefined; } }
  }
  async function updateReview() {
    const id = ++reviewRevision;
    review.value = [];
    if (!currentCatalog.value || !settings.config.water.enabled) { reviewing.value = false; return; }
    reviewing.value = true;
    try {
      const config = settings.toSnapshot(), req = { config, ...request() }, data = currentCatalog.value;
      const wasm = await getManifold();
      if (id !== reviewRevision || !data) return;
      const crop = computeTerrainCropRegion(req.mapCrop, req.viewportWidth, req.viewportHeight);
      const trail = buildTrailLinePolylines(config, crop, req.viewportWidth, req.viewportHeight);
      const selection = prepareWaterSelection(wasm, req, crop, data.features, trail);
      const scale = maskMmScale(req.mapCrop, crop, req.viewportWidth, req.viewportHeight);
      try {
        review.value = markRaw(selection.entries.map(entry => ({ feature: entry.feature, status: entry.status,
          geometry: { type: 'Polygon' as const, coordinates: entry.reviewPolygonsMm.map(ring => {
            const result = ring.map(([x, y]) => { const p = containerPointToLatLng(scale.cx + x! / scale.scaleX, scale.cy - y! / scale.scaleY, req.mapCrop, req.viewportWidth, req.viewportHeight); return [p.lon, p.lat]; });
            if (result.length) result.push(result[0]!); return result;
          }) } })));
      } finally { selection.dispose(); }
    } catch (err) { if (id === reviewRevision) error.value = formatIpcError(err); }
    finally { if (id === reviewRevision) reviewing.value = false; }
  }
  function setFeatureIncluded(id: string, included: boolean) {
    const excluded = settings.config.water.excludedFeatureIds;
    settings.config.water.excludedFeatureIds = included ? excluded.filter(value => value !== id)
      : excluded.includes(id) ? excluded : [...excluded, id];
  }
  function toggleFeature(id: string) {
    setFeatureIncluded(id, settings.config.water.excludedFeatureIds.includes(id));
  }
  function uncheckAll() {
    const detectedIds = currentCatalog.value?.features.map(feature => feature.id) ?? [];
    settings.config.water.excludedFeatureIds = [...new Set([...settings.config.water.excludedFeatureIds, ...detectedIds])];
  }
  watch([() => settings.config.water.enabled, () => waterCatalogKey(request())], () => {
    cancel(); catalog.value = null; review.value = []; error.value = null;
    if (settings.config.water.enabled) timer = setTimeout(() => { void refresh(false); }, 500);
  }, { immediate: true });
  watch(() => [currentCatalog.value, JSON.stringify(settings.config.water), settings.config.printMode,
    settings.config.trail.trailWidthMm, settings.config.assembly.trailToleranceMm, settings.config.gpx.importId], () => { void updateReview(); });
  return { catalog, currentCatalog, review, loading, reviewing, error, coverageErrors, cancelled, includedCount, canUncheckAll, refresh, cancel, setFeatureIncluded, toggleFeature, uncheckAll };
});
