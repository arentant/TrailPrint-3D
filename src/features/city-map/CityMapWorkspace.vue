<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useCityStore } from '@/stores/city';
import { useUiStore } from '@/stores/ui';
import { ipcParseGpx, formatIpcError } from '@/ipc/client';
import { useModelExport } from '@/composables/useModelExport';
import type { CityGenerateResponse, CityGenerateRequest } from '@shared/types/city';
import type { CityMapExportRequest } from '@shared/types/export';
import MapFramingView from '@/components/map/MapFramingView.vue';
import TrailPrintLogo from '@/components/ui/TrailPrintLogo.vue';
import CityControls from './CityControls.vue';
import CityMeshPreview from './CityMeshPreview.vue';
import CityTrailControls from './CityTrailControls.vue';
import ModelColorControls from '@/components/ui/ModelColorControls.vue';
const api = window.trailPrint;
const store = useCityStore(), ui = useUiStore();
const { config } = storeToRefs(store);
const previewDialog = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
const fileInput = ref<HTMLInputElement | null>(null);
const map = ref<InstanceType<typeof MapFramingView> | null>(null);
const viewport = ref({ w: 800, h: 600 });
const mapReady = ref(false);
const previewInputDelayMs = 1000;
let regenerateTimer: ReturnType<typeof setTimeout> | undefined;
const importing = ref(false), previewOpen = ref(false), previewBusy = ref(false);
const result = shallowRef<CityGenerateResponse | null>(null);
const resultKey = ref('');
const error = ref<string | null>(null), progress = ref(0), progressMessage = ref('');
let revision = 0, disposed = false;
const requestKey = computed(() => {
  const { colors: _colors, ...geometry } = config.value;
  return JSON.stringify([geometry, viewport.value]);
});
const previewStale = computed(() => !!result.value && resultKey.value !== requestKey.value);
function snapshot(): CityGenerateRequest {
  map.value?.syncStoreFromMap();
  return { config: JSON.parse(JSON.stringify(config.value)), viewportWidth: viewport.value.w, viewportHeight: viewport.value.h };
}
function schedulePreview() {
  if (regenerateTimer) clearTimeout(regenerateTimer);
  regenerateTimer = setTimeout(() => { regenerateTimer = undefined; if (previewOpen.value) void preview(); }, previewInputDelayMs);
}
watch(requestKey, () => {
  revision++; error.value = null;
  ui.lastExportPath = null; ui.statusMessage = null; api.clearExportDownload();
  if (regenerateTimer) clearTimeout(regenerateTimer);
  if (previewOpen.value) schedulePreview();
}, { flush: 'sync' });
const offProgress = window.trailPrint.onCityProgress((p) => { if (previewBusy.value) { progress.value = p.progress; progressMessage.value = p.message; } });
const offExport = window.trailPrint.onExportProgress((p) => { if (ui.generating) { ui.exportProgress = p.progress; ui.statusMessage = p.message; } });
async function preview() {
  if (!mapReady.value || previewBusy.value || ui.generating || importing.value) return;
  const request = snapshot();
  const key = requestKey.value;
  previewOpen.value = true;
  if (result.value && resultKey.value === key) return;
  previewBusy.value = true; error.value = null; progress.value = 0;
  progressMessage.value = result.value ? 'Updating city and trail…' : 'Preparing city…';
  const token = revision;
  try {
    const model = await window.trailPrint.generateCityModel(request);
    if (!disposed && token === revision) { result.value = model; resultKey.value = key; }
  } catch (e) { if (!disposed && token === revision) error.value = formatIpcError(e); }
  finally {
    previewBusy.value = false;
    if (!disposed && token !== revision && previewOpen.value) schedulePreview();
  }
}
const exporter = useModelExport<void, CityMapExportRequest>({
  prepareRequest: () => ({ ...snapshot(), flow: 'city-map' }),
  describeSuccess: (response) => `City ZIP ready: ${response.savedPath}`,
});
async function download() { if (result.value && !previewStale.value && !previewBusy.value && !error.value) await exporter.generateAndSave(); }
async function importFile(file?: File) {
  if (!file || importing.value || ui.generating || previewBusy.value) return;
  if (!file.name.toLowerCase().endsWith('.gpx') || file.size > 10 * 1024 * 1024) { ui.statusMessage = 'Select a .gpx file smaller than 10 MB'; return; }
  importing.value = true; ui.statusMessage = 'Reading GPX…';
  try {
    const path = (file as File & { path?: string }).path;
    const { result: track } = await ipcParseGpx({ importId: crypto.randomUUID(), fileName: file.name, ...(path ? { filePath: path } : { content: await file.text() }) });
    if (disposed) return;
    store.applyImport(track, file.name, path);
    await nextTick(); map.value?.fitTrackInView();
    ui.statusMessage = `Imported “${track.trackName ?? file.name}”: ${track.pointCount} points, ${track.distanceKm.toFixed(2)} km`;
  } catch (e) { if (!disposed) ui.statusMessage = formatIpcError(e); }
  finally { importing.value = false; if (fileInput.value) fileInput.value.value = ''; }
}
function viewportChanged(value: { w: number; h: number }) { viewport.value = value; ui.previewViewport = value; }
async function revealDownload() {
  try { if (ui.lastExportPath) await api.revealExport(ui.lastExportPath); }
  catch (e) { ui.statusMessage = formatIpcError(e); }
}
function onDrop(event: DragEvent) { void importFile(event.dataTransfer?.files[0]); }
function closePreview() { previewOpen.value = false; if (regenerateTimer) clearTimeout(regenerateTimer); }
watch(previewOpen, async (open) => {
  if (open) { previousFocus = document.activeElement as HTMLElement | null; await nextTick(); previewDialog.value?.focus(); }
  else previousFocus?.focus();
});
function trapPreviewFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return;
  const buttons = previewDialog.value?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]');
  if (!buttons?.length) { event.preventDefault(); return; }
  const first = buttons[0], last = buttons[buttons.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === previewDialog.value)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
onUnmounted(() => { disposed = true; revision++; if (regenerateTimer) clearTimeout(regenerateTimer); offProgress(); offExport(); result.value = null; });
</script>
<template>
  <div class="city-workspace">
    <aside class="city-sidebar">
      <header>
        <div class="brand"><TrailPrintLogo :size="32" /><h1>TrailPrint <span>City</span></h1></div>
        <p>Turn your city run into a printable keepsake.</p>
        <button class="secondary" :disabled="importing || ui.generating || previewBusy" @click="fileInput?.click()">{{ importing ? 'Reading…' : 'Import GPX' }}</button>
        <input ref="fileInput" class="sr-only" type="file" accept=".gpx,application/gpx+xml" @change="importFile(($event.target as HTMLInputElement).files?.[0])" />
        <p v-if="config.gpx.imported" class="track-summary">{{ config.gpx.trackName }} · {{ config.gpx.distanceKm.toFixed(2) }} km</p>
      </header>
      <div class="scroll"><CityControls /></div>
      <footer>
        <p v-if="ui.statusMessage" class="city-status" role="status">{{ ui.statusMessage }}</p>
        <progress v-if="ui.generating" :value="ui.exportProgress" max="1" />
        <button class="primary" :disabled="!mapReady || !config.gpx.imported || ui.generating || importing || previewBusy" @click="preview">Preview & export City STL</button>
        <button v-if="ui.lastExportPath && !ui.generating" class="secondary" @click="revealDownload">{{ api.runtime === 'browser' ? 'Download again' : 'Show saved ZIP' }}</button>
      </footer>
    </aside>
    <main class="city-panel">
      <div class="map-tools"><span>City / {{ config.city.surface === 'flat' ? 'Flat base' : 'Real terrain' }}</span><button class="secondary" @click="map?.resetMapView()">Fit track</button></div>
      <div class="city-map" :class="{ locked: ui.generating }" @dragover.prevent @drop.prevent="onDrop">
        <MapFramingView ref="map" :crop="config.mapCrop" v-model:colors="config.colors" :gpx="config.gpx" :points="config.gpx.points" :segments="config.gpx.segments" :fit-nonce="store.fitNonce" :restore-view="config.gpx.imported" @update:crop="config.mapCrop = $event" @viewport="viewportChanged" @ready="mapReady = $event" />
        <div v-if="!config.gpx.imported" class="empty"><strong>A city. A run. Your story.</strong><p>Drop a GPX running route to get started.</p></div>
      </div>
      <p class="attribution">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a></p>
    </main>
    <div v-if="previewOpen" class="modal-backdrop" @click.self="!ui.generating && closePreview()" @keydown.esc="!ui.generating && closePreview()">
      <section ref="previewDialog" class="city-modal" @keydown="trapPreviewFocus" role="dialog" aria-modal="true" aria-labelledby="city-preview-title" tabindex="-1">
        <div class="modal-head"><div><h2 id="city-preview-title">Your city run, in 3D</h2><p>Adjust the route, inspect the fit, then download your model.</p></div><button class="secondary" aria-label="Close city preview" :disabled="ui.generating" @click="closePreview">Close</button></div>
        <div class="preview-layout">
          <div class="preview-model">
            <div class="preview-stage" :aria-busy="previewBusy || (previewStale && !error)">
              <CityMeshPreview v-if="result" :result="result" :colors="config.colors" />
              <div v-if="previewBusy || (previewStale && !error)" :class="result ? 'preview-update' : 'preview-status'" role="status"><p>{{ previewBusy ? progressMessage : 'Changes apply after you stop typing…' }}</p><progress v-if="previewBusy" :value="progress" max="1" /></div>
              <p v-else-if="error" :class="result ? 'preview-update preview-error' : 'preview-status'" role="alert">{{ error }}</p>
              <div v-else-if="!result" class="preview-status"><p>The framing or settings changed.</p><button class="secondary" @click="preview">Regenerate city preview</button></div>
            </div>
            <div v-if="result" class="model-notes"><p>{{ result.featureCounts.buildings }} buildings · {{ result.featureCounts.roads }} roads · {{ result.featureCounts.routeSegments }} GPX segments</p><p v-for="warning in result.warnings" :key="warning">{{ warning }}</p></div>
          </div>
          <aside class="trail-editor" aria-labelledby="city-preview-trail-title" @input="schedulePreview">
            <h3 id="city-preview-trail-title"><span class="trail-dot" :style="{ backgroundColor: config.colors.trail }" aria-hidden="true"></span>Running route</h3>
            <p>Updates 1 second after you stop typing.</p>
            <CityTrailControls v-model="config.city" :base-thickness="config.terrain.baseSolidThicknessMm" :disabled="ui.generating" stacked />
            <p class="trail-help">Width shapes the insert. Clearance gives it room to fit. Seating depth sinks it into the base; relief sets its height above the surface.</p>
            <p class="trail-note">Your GPX stays in place.</p>
            <h3>Model colors</h3>
            <ModelColorControls v-model="config.colors" workspace="city" :show-tray="false" :disabled="ui.generating" @input.stop />
          </aside>
        </div>
        <footer class="modal-footer"><p>{{ ui.generating ? ui.statusMessage : 'ZIP includes City_Main.stl, Trail_Line.stl and assembly instructions.' }}</p><button v-if="error" class="secondary" :disabled="previewBusy" @click="preview">Retry preview</button><button class="primary" :disabled="!result || previewStale || previewBusy || ui.generating || !!error" @click="download">{{ ui.generating ? 'Exporting…' : 'Download City ZIP' }}</button></footer>
      </section>
    </div>
  </div>
</template>
<style scoped>
.city-workspace { flex: 1; display: flex; gap: 20px; padding: 24px; min-height: 0; background: var(--tp-bg-page); }
.city-sidebar { display: flex; flex-direction: column; width: 360px; flex-shrink: 0; min-height: 0; }
header { padding: 4px 8px 18px; } .brand { display: flex; align-items: center; gap: 10px; } h1 { margin: 0; font-size: 24px; letter-spacing: -0.5px; } h1 span { font-weight: 400; color: var(--tp-text-secondary); font-size: 18px; }
header p, .track-summary { font-size: 12px; color: var(--tp-text-secondary); line-height: 1.5; }
.scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 4px; }
footer { display: flex; flex-direction: column; gap: 10px; padding: 14px 4px 0; } .city-status { margin: 0; font-size: 12px; line-height: 1.5; }
.primary, .secondary { border-radius: 10px; padding: 11px 16px; font-size: 13px; font-weight: 600; } .primary { background: var(--tp-text-accent); color: white; } .secondary { background: var(--tp-bg-panel); color: var(--tp-text-primary); border: 1px solid var(--tp-border-strong); }
button:disabled { opacity: 0.45; cursor: default; } button:focus-visible { outline: 2px solid var(--tp-text-accent); outline-offset: 3px; }
.city-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; border-radius: 16px; overflow: hidden; background: var(--tp-bg-panel); }
.map-tools { padding: 12px 18px; display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; }
.city-map { position: relative; flex: 1; min-height: 0; } .locked { pointer-events: none; }
.empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; color: white; text-shadow: 0 1px 12px #222; z-index: 500; } .empty strong { font-size: 28px; letter-spacing: -0.5px; } .empty p { font-size: 14px; }
.attribution { margin: 0; padding: 9px 18px; font-size: 11px; color: var(--tp-text-secondary); } a { color: inherit; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
.modal-backdrop { position: fixed; inset: 0; background: #1a211e99; display: flex; align-items: center; justify-content: center; z-index: 3000; padding: 24px; }
.city-modal { width: min(1240px, 96vw); height: min(900px, 92vh); display: flex; flex-direction: column; gap: 14px; padding: 22px; background: var(--tp-bg-panel); border-radius: 18px; box-shadow: 0 24px 80px #0004; overflow: hidden; }
.modal-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; } h2 { margin: 0; font-size: 22px; letter-spacing: -0.4px; } .modal-head p { font-size: 12px; color: var(--tp-text-secondary); }
.preview-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 248px; gap: 22px; }
.preview-model { display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; }
.preview-stage { display: flex; flex: 1; min-height: 200px; position: relative; background: #f4f5f1; border-radius: 12px; overflow: hidden; }
.preview-update { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); max-width: calc(100% - 32px); width: max-content; padding: 12px 18px; border-radius: 10px; background: var(--tp-bg-panel); box-shadow: var(--tp-shadow-panel); font-size: 12px; text-align: center; pointer-events: none; }
.preview-update p { margin: 0 0 4px; } .preview-update progress { display: block; height: 5px; } .preview-error { color: var(--tp-text-primary); }
.trail-editor { border-left: 1px solid var(--tp-border-strong); padding-left: 22px; overflow-y: auto; }
.trail-editor h3 { display: flex; align-items: center; gap: 8px; margin: 2px 0 8px; font-size: 15px; }
.trail-editor p { font-size: 12px; color: var(--tp-text-secondary); line-height: 1.6; margin: 0 0 20px; }
.trail-dot { width: 8px; height: 8px; border-radius: 50%; background: #e84335; }
.trail-editor .trail-help { margin: 20px 0 16px; font-size: 11px; }
.trail-editor .trail-note { padding-top: 14px; border-top: 1px solid var(--tp-border-strong); font-size: 11px; }
.preview-status { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 24px; }
.model-notes { max-height: 100px; overflow-y: auto; font-size: 11px; color: var(--tp-text-secondary); } .model-notes p { margin: 4px 0; }
.modal-footer { flex-direction: row; align-items: center; justify-content: space-between; } .modal-footer p { font-size: 12px; flex: 1; }
progress { width: 100%; accent-color: var(--tp-text-accent); }
@media (max-width: 800px) { .city-workspace { padding: 12px; gap: 12px; } .city-sidebar { width: 290px; } .modal-backdrop { padding: 12px; } }
@media (max-width: 900px) { .preview-layout { grid-template-columns: minmax(0, 1fr); overflow-y: auto; } .preview-model { min-height: 360px; } .trail-editor { border-left: 0; border-top: 1px solid var(--tp-border-strong); padding: 18px 0 0; overflow: visible; } .modal-footer { flex-wrap: wrap; } }
</style>
