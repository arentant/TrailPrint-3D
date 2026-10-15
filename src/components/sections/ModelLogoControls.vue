<script setup lang="ts">
import { computed, ref, shallowRef, toRaw, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useConfigStore } from '@/stores/config';
import { importModelLogo } from '@/utils/logo-import';
import type { LogoTraceMode } from '@shared/utils/logo-trace';
import { buildModelTextLayout, modelMarkBounds, modelFootprint } from '@shared/utils/model-features';
import { computeTerrainCropRegion } from '@shared/utils/crop-region';
import { createDefaultFeaturePosition, type ModelLogoAsset } from '@shared/types/config';
import NumberField from '@/components/ui/NumberField.vue';
import IosToggle from '@/components/ui/IosToggle.vue';

const { config } = storeToRefs(useConfigStore());
const logo = computed(() => config.value.terrain.logo);
const fileInput = ref<HTMLInputElement | null>(null);
const file = shallowRef<File | null>(null);
const mode = ref<LogoTraceMode>('dark');
const importing = ref(false), error = ref('');
let requestId = 0;
let importedAsset: ModelLogoAsset | null = null;
const outline = computed(() => logo.value.asset?.contours.map(loop => `M${loop.map(p => `${p.x},${-p.y}`).join('L')}Z`).join('') ?? '');
const previewBox = computed(() => {
  const halfHeight = 0.5 / (logo.value.asset?.aspectRatio ?? 1);
  return `-0.55 ${-halfHeight - 0.05} 1.1 ${halfHeight * 2 + 0.1}`;
});
async function importLogo() {
  if (!file.value) return;
  const id = ++requestId;
  importing.value = true; error.value = '';
  try {
    const asset = await importModelLogo(file.value, mode.value);
    if (id !== requestId) return;
    if (!logo.value.asset) {
      // Start beside the existing text, keeping each stored position independent.
      try {
        const layout = buildModelTextLayout(config.value, undefined, false);
        const height = logo.value.widthMm / asset.aspectRatio;
        logo.value.frontPosition = createDefaultFeaturePosition();
        logo.value.undersidePosition = createDefaultFeaturePosition();
        if (layout.underside.length) logo.value.undersidePosition.yMm = modelMarkBounds(layout.underside).minY - height / 2 - 3;
        if (layout.front.length) {
          const crop = computeTerrainCropRegion(config.value.mapCrop, 800, 600);
          const frontY = Math.min(...modelFootprint(crop).map(p => p.y));
          logo.value.frontPosition.yMm = modelMarkBounds(layout.front).minY - frontY - 3;
        }
      } catch { /* Position controls remain available when existing text needs adjustment. */ }
    }
    importedAsset = asset; logo.value.asset = asset;
  } catch (cause) {
    if (id === requestId) error.value = cause instanceof Error ? cause.message : 'The logo could not be imported.';
  } finally { if (id === requestId) importing.value = false; }
}
function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement;
  file.value = input.files?.[0] ?? null;
  input.value = '';
  void importLogo();
}
function removeLogo() {
  requestId++; importing.value = false; importedAsset = null; logo.value.asset = null; file.value = null; error.value = '';
}
watch(() => logo.value.asset, asset => {
  if (toRaw(asset) === importedAsset) return;
  requestId++; importing.value = false; file.value = null; error.value = '';
  mode.value = asset?.traceMode ?? 'dark';
});
watch(mode, () => { if (file.value) void importLogo(); });
watch(() => logo.value.enabled, enabled => { if (!enabled) { requestId++; importing.value = false; } });
</script>

<template>
  <div class="logo-controls">
    <div class="logo-controls__heading">
      <div><span>Logo on model</span><p>Import an SVG or PNG to engrave your own artwork.</p></div>
      <IosToggle v-model="logo.enabled" aria-label="Logo on model" />
    </div>
    <template v-if="logo.enabled">
      <input ref="fileInput" type="file" accept=".svg,.png,image/svg+xml,image/png" aria-label="Logo file" class="sr-only" @change="chooseFile" />
      <div v-if="logo.asset" class="logo-controls__preview">
        <svg :viewBox="previewBox" role="img" :aria-label="`Imported logo: ${logo.asset.name}`"><path :d="outline" fill="currentColor" fill-rule="evenodd" /></svg>
        <span>{{ logo.asset.name }}</span>
      </div>
      <div class="logo-controls__actions">
        <button type="button" class="logo-controls__import" :disabled="importing" @click="fileInput?.click()">{{ importing ? 'Importing…' : logo.asset ? 'Replace logo' : 'Import SVG or PNG' }}</button>
        <button v-if="logo.asset" type="button" @click="removeLogo">Remove logo</button>
      </div>
      <label>Artwork to engrave
        <select v-model="mode" aria-label="Logo artwork" :disabled="!file && !!logo.asset"><option value="dark">Dark shapes</option><option value="light">Light shapes</option><option value="opaque">Opaque shapes · use transparency</option></select>
      </label>
      <p>White and transparent areas stay empty with Dark shapes. Use a simple, high-contrast logo; text in SVGs should be converted to paths. Import stays on your device.</p>
      <p v-if="logo.asset && !file">Replace the source file to change which artwork is engraved.</p>
      <p v-if="error" class="logo-controls__error" role="alert">{{ error }}</p>
      <template v-if="logo.asset">
        <label>Logo placement<select v-model="logo.placement" aria-label="Logo placement"><option value="underside">Underside</option><option value="front">Front caption</option><option value="both">Both placements</option></select></label>
        <label>Logo finish<select v-model="logo.style" aria-label="Logo finish"><option value="engraved">Engraved</option><option value="raised">Raised</option></select></label>
        <div class="logo-controls__row">
          <NumberField v-model="logo.widthMm" label="Logo width" suffix="mm" :min="2" :max="200" :step="0.5" />
          <NumberField v-model="logo.heightMm" :label="logo.style === 'engraved' ? 'Logo engraving depth' : 'Logo relief height'" suffix="mm" :min="0.2" :max="3" :step="0.1" />
        </div>
        <p>Aspect ratio is preserved. Move and rotate the logo in the layout editor below.</p>
      </template>
    </template>
  </div>
</template>

<style scoped>
.logo-controls { display: flex; flex-direction: column; gap: 12px; padding-top: 16px; border-top: 1px solid var(--tp-border); }
.logo-controls__heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; font-size: 13px; font-weight: 600; }
p { margin: 0; color: var(--tp-text-secondary); font-size: 11px; line-height: 1.5; font-weight: 400; }
.logo-controls__heading p { margin-top: 5px; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--tp-text-secondary); }
select { width: 100%; padding: 10px; border: 1px solid var(--tp-border-strong); border-radius: var(--tp-radius-control); background: var(--tp-bg-input); color: var(--tp-text-primary); font: inherit; }
.logo-controls__preview { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px; background: var(--tp-bg-input); border-radius: var(--tp-radius-control); }
.logo-controls__preview svg { width: 100%; height: 80px; color: var(--tp-text-primary); }
.logo-controls__preview span { max-width: 100%; overflow-wrap: anywhere; color: var(--tp-text-secondary); font-size: 11px; }
.logo-controls__actions, .logo-controls__row { display: flex; align-items: center; gap: 12px; }
button { padding: 8px 0; background: transparent; border: 0; color: var(--tp-text-accent); font: inherit; font-size: 12px; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: wait; }
.logo-controls__import { flex: 1; padding: 10px; border: 1px solid var(--tp-border-strong); border-radius: var(--tp-radius-control); background: var(--tp-bg-input); }
select:focus-visible, button:focus-visible { outline: 2px solid var(--tp-text-accent); outline-offset: 2px; }
.logo-controls__error { color: var(--tp-danger, #b42318); }
</style>
