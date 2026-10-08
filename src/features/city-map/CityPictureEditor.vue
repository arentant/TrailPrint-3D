<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import type { CityGenerateRequest, CityPictureConfig } from '@shared/types/city';
import type { CityMapTile } from '@shared/city/map-tiles';
import { loadCityPictureTiles } from '@shared/city/map-tiles';
import { renderPrintableCityMap, cityPictureLayout } from '@shared/city/printable-map';
import { citySelectionCrop } from '@shared/city/selection-crop';
import { cityPictureDetails } from '@shared/city/picture-details';
import { heightfieldGeoBounds } from '@shared/utils/map-mm-projection';

const props = defineProps<{ request: CityGenerateRequest; exporting: boolean; exportMessage?: string | null; exportProgress: number }>();
const picture = defineModel<CityPictureConfig>({ required: true });
const emit = defineEmits<{ close: []; download: [] }>();
const dialog = ref<HTMLElement | null>(null);
const tiles = shallowRef<CityMapTile[] | null>(null);
const loading = ref(true), error = ref(''), loaded = ref(0), total = ref(0);
const previewUrl = ref('');
const crop = computed(() => citySelectionCrop(props.request));
const layout = computed(() => cityPictureLayout(crop.value, picture.value));
const dimensions = computed(() => layout.value.width.toFixed(1) + ' × ' + layout.value.height.toFixed(1) + ' mm');
const posterLayouts = [
  { value: 'cards', label: 'Map cards', description: 'Floating title, name and stat cards directly on your map.' },
  { value: 'minimal', label: 'Minimal', description: 'Quiet typography and a soft wash over the map.' },
  { value: 'editorial', label: 'Editorial', description: 'A paper border with your story above and below the map.' },
] as const;
const layoutDescription = computed(() => posterLayouts.find((option) => option.value === picture.value.layout)?.description ?? posterLayouts[2].description);
const fields = [
  { key: 'title', label: 'Title', placeholder: 'Berlin Marathon', limit: 80 },
  { key: 'athlete', label: 'Runner name', placeholder: 'Your name', limit: 60 },
  { key: 'date', label: 'Date', placeholder: '', limit: 10 },
  { key: 'distance', label: 'Distance', placeholder: '42.20', limit: 20, unit: 'km' },
  { key: 'duration', label: 'Elapsed time', placeholder: '3:55:41', limit: 20 },
  { key: 'pace', label: 'Average pace', placeholder: '5:31', limit: 20, unit: '/km' },
] as const;
const missingTime = computed(() => !props.request.config.gpx.elapsedSeconds);
let disposed = false, revision = 0;
let previousFocus: HTMLElement | null = null;

async function loadPreview() {
  const token = ++revision;
  loading.value = true; error.value = ''; tiles.value = null; loaded.value = 0; total.value = 0;
  try {
    const bounds = heightfieldGeoBounds(crop.value, 2, 2, props.request.config.mapCrop, props.request.viewportWidth, props.request.viewportHeight, 0);
    // A lighter map for the editor; export uses the same renderer with 600 DPI tiles.
    const images = await loadCityPictureTiles(bounds, crop.value.widthMm, crop.value.heightMm, (complete, count) => {
      if (!disposed && token === revision) { loaded.value = complete; total.value = count; }
    }, 120);
    if (!disposed && token === revision) tiles.value = images;
  } catch (e) {
    if (!disposed && token === revision) error.value = e instanceof Error ? e.message : 'Could not load the map. Try again.';
  } finally { if (!disposed && token === revision) loading.value = false; }
}

watch([tiles, picture], () => {
  if (!tiles.value) return;
  try {
    const source = renderPrintableCityMap({ ...props.request, config: { ...props.request.config, picture: picture.value } }, crop.value, tiles.value);
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = url;
  } catch (e) { error.value = e instanceof Error ? e.message : 'Could not draw the preview.'; }
}, { deep: true });
watch(() => props.request, loadPreview, { immediate: true });

function resetDetails() {
  Object.assign(picture.value, cityPictureDetails(props.request.config.gpx, props.request.config.gpx.fileName));
}
function close() { if (!props.exporting) emit('close'); }
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return;
  const controls = dialog.value?.querySelectorAll<HTMLElement>('button:enabled, input:enabled, a[href], [tabindex="0"]');
  if (!controls?.length) { event.preventDefault(); return; }
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.value)) { event.preventDefault(); first.focus(); }
}
onMounted(async () => { previousFocus = document.activeElement as HTMLElement; await nextTick(); dialog.value?.focus(); });
onUnmounted(() => {
  disposed = true; revision++;
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  if (previousFocus?.isConnected) previousFocus.focus();
});
</script>

<template>
  <div class="picture-backdrop" @click.self="close" @keydown.esc.stop="close">
    <section ref="dialog" class="picture-dialog" role="dialog" aria-modal="true" aria-labelledby="picture-title" tabindex="-1" @keydown="trapFocus">
      <header class="picture-header">
        <div><span class="eyebrow">CITY COLLECTION</span><h2 id="picture-title">Your run. On paper.</h2><p>Make a keepsake of the miles you made.</p></div>
        <button class="close-button" aria-label="Close picture preview" :disabled="exporting" @click="close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
      </header>
      <div class="picture-body">
        <div class="picture-proof">
          <div class="proof-toolbar"><span><i aria-hidden="true"></i>LIVE PREVIEW</span><span>{{ dimensions }}</span></div>
          <div class="proof-stage" :aria-busy="loading">
            <img v-if="previewUrl && !loading && !error" :src="previewUrl" alt="City map picture preview" class="poster-image" />
            <div v-if="loading" class="proof-state" role="status"><span class="map-glyph" aria-hidden="true">↗</span><strong>Framing your story</strong><p>Loading street map{{ total ? ' · ' + loaded + '/' + total : '…' }}</p><progress v-if="total" :value="loaded" :max="total" /></div>
            <div v-else-if="error" class="proof-state"><strong>Map preview unavailable</strong><p role="alert">{{ error }}</p><button class="quiet-button" @click="loadPreview">Retry map preview</button></div>
          </div>
          <p class="proof-caption">{{ picture.enabled ? 'A little piece of your journey, ready to keep.' : 'Your framed map and route, at their original print size.' }}</p>
        </div>
        <aside class="picture-settings" aria-label="Picture settings">
          <fieldset :disabled="exporting">
            <div class="section-heading"><h3>Make it yours</h3><span class="gpx-badge">FROM GPX</span></div>
            <p class="settings-intro">Your track starts the story. You add the personal touches.</p>
            <div class="layout-picker" role="group" aria-label="Picture layout">
              <button :aria-pressed="picture.enabled" @click="picture.enabled = true"><svg viewBox="0 0 24 28" aria-hidden="true"><rect x="2" y="1" width="20" height="26" rx="1"/><path d="M6 6h12M6 9h8M6 22h12"/><rect x="6" y="12" width="12" height="7"/></svg><span>Route poster</span></button>
              <button :aria-pressed="!picture.enabled" @click="picture.enabled = false"><svg viewBox="0 0 24 28" aria-hidden="true"><rect x="2" y="1" width="20" height="26" rx="1"/><path d="m6 20 3-9 5 5 4-9"/></svg><span>Map only</span></button>
            </div>
            <template v-if="picture.enabled">
              <span class="picker-label">Poster layout</span>
              <div class="poster-layouts" role="group" aria-label="Poster layout">
                <button v-for="option in posterLayouts" :key="option.value" :aria-pressed="(picture.layout || 'editorial') === option.value" @click="picture.layout = option.value">
                  <svg viewBox="0 0 56 64" aria-hidden="true">
                    <rect class="mini-paper" x="1" y="1" width="54" height="62" rx="3"/>
                    <rect class="mini-map" x="5" :y="option.value === 'editorial' ? 19 : 5" width="46" :height="option.value === 'editorial' ? 28 : 54" rx="1"/>
                    <path class="mini-road" d="M7 33h42M18 7v48M38 9v47M6 17l41 31"/>
                    <path class="mini-route" d="m11 39 10-9 9 8 13-15"/>
                    <template v-if="option.value === 'cards'">
                      <rect class="mini-card" x="10" y="9" width="36" height="11" rx="2"/><path class="mini-type" d="M14 13h17M14 16h27"/>
                      <rect v-for="x in [9, 22, 35]" :key="x" class="mini-card" :x="x" y="45" width="12" height="10" rx="1.5"/>
                    </template>
                    <template v-else-if="option.value === 'minimal'"><path class="mini-type" d="M13 12h30M18 16h20M12 51h7M24 51h7M36 51h7"/></template>
                    <template v-else><path class="mini-type" d="M7 9h30M7 13h40M7 53h26M7 57h9M22 57h9M37 57h9"/></template>
                  </svg>
                  <span>{{ option.label }}</span>
                </button>
              </div>
              <p class="layout-description">{{ layoutDescription }}</p>
              <div class="theme-picker" role="group" aria-label="Poster theme">
                <button :aria-pressed="picture.theme === 'paper'" @click="picture.theme = 'paper'"><span class="swatch swatch-paper" aria-hidden="true"></span>Paper</button>
                <button :aria-pressed="picture.theme === 'midnight'" @click="picture.theme = 'midnight'"><span class="swatch swatch-midnight" aria-hidden="true"></span>Midnight</button>
              </div>
              <div class="detail-fields">
                <label v-for="field in fields" :key="field.key" :class="{ 'full-field': field.key === 'title' || field.key === 'athlete' }">
                  <span>{{ field.label }}</span>
                  <div class="input-wrap"><input v-model="picture[field.key]" :type="field.key === 'date' ? 'date' : 'text'" :placeholder="field.placeholder" :maxlength="field.limit" :aria-label="field.label" :spellcheck="field.key === 'title' || field.key === 'athlete'" /><span v-if="'unit' in field" class="field-unit">{{ field.unit }}</span></div>
                </label>
              </div>
              <p class="data-note">{{ missingTime ? 'Time and pace aren’t available in this GPX. Add any missing details if you know them.' : 'Date, elapsed time and average pace come from your GPX. Elapsed time includes stops.' }} Clear any field to leave it off the poster.</p>
              <button class="reset-button" @click="resetDetails">↺ Use GPX values</button>
            </template>
            <div class="print-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M7 8V3h10v5M7 17H4V8h16v9h-3M7 14h10v7H7zM16 11h1"/></svg><div><strong>Made to print</strong><p>The map stays {{ crop.widthMm.toFixed(1) }} × {{ crop.heightMm.toFixed(1) }} mm. Print at 100% / actual size to match your trail STL.</p></div></div>
          </fieldset>
        </aside>
      </div>
      <footer class="picture-footer">
        <div><p role="status">{{ exportMessage || 'SVG picture · Print-ready map · Editable details' }}</p><progress v-if="exporting" :value="exportProgress" max="1" /></div>
        <button class="download-button" :disabled="loading || !!error || !previewUrl || exporting" @click="emit('download')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>{{ exporting ? 'Exporting…' : 'Download SVG' }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.picture-backdrop { position: fixed; inset: 0; z-index: 3100; display: grid; place-items: center; padding: 24px; background: #122521a6; backdrop-filter: blur(8px); }
.picture-dialog { width: min(1210px, 96vw); height: min(920px, 94dvh); display: flex; flex-direction: column; overflow: hidden; border-radius: 20px; background: var(--tp-bg-panel); color: var(--tp-text-primary); box-shadow: 0 32px 100px #0b181655; }
.picture-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 24px 28px 22px; border-bottom: 1px solid var(--tp-border-strong); }
.eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 2px; color: var(--tp-text-secondary); }
h2 { margin: 7px 0 5px; font: 650 27px/1.15 'Avenir Next', Avenir, sans-serif; letter-spacing: -.7px; }
.picture-header p { margin: 0; color: var(--tp-text-secondary); font-size: 12px; }
.close-button { display: grid; place-items: center; width: 38px; height: 38px; flex-shrink: 0; border: 1px solid var(--tp-border-strong); border-radius: 50%; color: var(--tp-text-primary); background: var(--tp-bg-page); }
.close-button svg { width: 19px; height: 19px; }
.picture-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 330px; }
.picture-proof { display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; padding: 18px 26px; background: #e4e9e4; color: #4c6158; }
.proof-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 10px; letter-spacing: .4px; }
.proof-toolbar span:first-child { display: flex; align-items: center; gap: 7px; font-size: 9px; letter-spacing: 1.6px; font-weight: 700; }
.proof-toolbar i { width: 5px; height: 5px; border-radius: 50%; background: #4a7d62; }
.proof-stage { display: flex; align-items: center; justify-content: center; flex: 1; min-height: 0; padding: 8px 20px; background-image: radial-gradient(#34554414 .7px, transparent .7px); background-size: 12px 12px; }
.poster-image { display: block; width: 100%; height: 100%; min-width: 0; min-height: 0; object-fit: contain; filter: drop-shadow(0 16px 18px #1c34292b) drop-shadow(0 1px 2px #1c34292b); }
.proof-caption { margin: 0; text-align: center; font-size: 11px; color: #6b7d72; }
.proof-state { display: flex; flex-direction: column; align-items: center; max-width: 360px; text-align: center; font-size: 13px; }
.proof-state p { line-height: 1.7; font-size: 12px; }.proof-state progress { width: 180px; }
.map-glyph { display: grid; place-items: center; width: 52px; height: 52px; border: 1px solid #afc2b5; border-radius: 14px; font-size: 30px; margin-bottom: 16px; }
.picture-settings { overflow-y: auto; min-height: 0; padding: 24px; border-left: 1px solid var(--tp-border-strong); }
fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
.section-heading { display: flex; justify-content: space-between; align-items: center; gap: 10px; }h3 { margin: 0; font-size: 15px; letter-spacing: -.2px; }
.gpx-badge { font-size: 8px; letter-spacing: .9px; font-weight: 700; padding: 5px 7px; border: 1px solid var(--tp-border-strong); border-radius: 4px; color: var(--tp-text-secondary); }
.settings-intro { margin: 9px 0 20px; font-size: 11px; line-height: 1.6; color: var(--tp-text-secondary); }
.layout-picker { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 15px; }
.layout-picker button { display: flex; align-items: center; justify-content: center; gap: 9px; padding: 12px 7px; border: 1px solid var(--tp-border-strong); border-radius: 9px; background: var(--tp-bg-page); color: var(--tp-text-secondary); font-size: 11px; }
.layout-picker svg { width: 20px; height: 25px; fill: none; stroke: currentColor; stroke-width: 1; }
.layout-picker button[aria-pressed="true"] { background: #edf3ec; border-color: #8fa58e; color: #264332; box-shadow: inset 0 0 0 .5px #8fa58e; }
.picker-label { display: block; margin: 20px 0 8px; font-size: 11px; font-weight: 500; color: var(--tp-text-secondary); }
.poster-layouts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.poster-layouts button { display: flex; flex-direction: column; align-items: center; gap: 7px; padding: 10px 7px 9px; border-radius: 8px; border: 1px solid var(--tp-border-strong); background: var(--tp-bg-page); color: var(--tp-text-secondary); font-size: 10px; }
.poster-layouts button[aria-pressed="true"] { border-color: #8fa58e; background: #edf3ec; color: #264332; box-shadow: inset 0 0 0 .5px #8fa58e; font-weight: 600; }
.poster-layouts svg { width: 48px; height: 56px; }.mini-paper { fill: #f6f3eb; stroke: #cbd3c7; stroke-width: .6; }.mini-map { fill: #dae5d5; }.mini-road { fill: none; stroke: #b6c8b1; stroke-width: .8; }.mini-route { fill: none; stroke: #fc4c02; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }.mini-card { fill: #fffef9; stroke: #a9b7a3; stroke-width: .4; }.mini-type { fill: none; stroke: #304837; stroke-width: 1.3; stroke-linecap: round; }
.layout-description { margin: 8px 0 0; min-height: 30px; font-size: 10px; line-height: 1.6; color: var(--tp-text-secondary); }
.theme-picker { display: flex; gap: 16px; margin: 15px 0 20px; }
.theme-picker button { display: flex; gap: 7px; align-items: center; background: transparent; color: var(--tp-text-secondary); font-size: 11px; padding: 2px; }
.theme-picker button[aria-pressed="true"] { color: var(--tp-text-primary); font-weight: 600; }
.swatch { width: 18px; height: 18px; border-radius: 50%; border: 1px solid #b2b7ac; }.swatch-paper { background: #f6f3eb; }.swatch-midnight { background: #192b28; }
[aria-pressed="true"] .swatch { outline: 1px solid var(--tp-text-primary); outline-offset: 3px; }
.detail-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px 12px; }
.full-field { grid-column: 1 / -1; }.detail-fields label { display: flex; flex-direction: column; gap: 6px; min-width: 0; font-size: 11px; font-weight: 500; color: var(--tp-text-secondary); }
.input-wrap { position: relative; }input { width: 100%; min-width: 0; height: 39px; border: 1px solid var(--tp-border-strong); border-radius: 7px; padding: 9px 10px; background: var(--tp-bg-page); color: var(--tp-text-primary); font-family: inherit; font-size: 12px; box-sizing: border-box; }input::placeholder { color: var(--tp-text-tertiary, #8a958e); }.input-wrap:has(.field-unit) input { padding-right: 34px; }
.field-unit { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-size: 10px; font-weight: 400; pointer-events: none; }
.data-note { font-size: 10px; line-height: 1.7; color: var(--tp-text-secondary); margin: 15px 0 8px; }
.reset-button { padding: 4px 0; background: transparent; color: var(--tp-text-accent); font-size: 11px; }
.print-note { display: flex; gap: 10px; margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--tp-border-strong); color: var(--tp-text-secondary); }.print-note svg { width: 19px; height: 19px; flex-shrink: 0; }.print-note strong { display: block; font-size: 11px; font-weight: 600; }.print-note p { margin: 5px 0 0; font-size: 10px; line-height: 1.6; }
.picture-footer { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 16px 26px; border-top: 1px solid var(--tp-border-strong); }.picture-footer > div { flex: 1; min-width: 0; }.picture-footer p { margin: 0; font-size: 11px; line-height: 1.6; color: var(--tp-text-secondary); }.picture-footer progress { margin-top: 6px; width: 100%; }
.download-button { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 12px 24px; background: var(--tp-text-accent); color: white; border-radius: 9px; font-size: 12px; font-weight: 600; flex-shrink: 0; }.download-button svg { width: 17px; height: 17px; }
.quiet-button { border: 1px solid #8fa58e; border-radius: 7px; padding: 10px 16px; color: #264332; background: #edf3ec; font-size: 12px; }button:disabled { opacity: .5; cursor: default; }button:focus-visible, input:focus-visible { outline: 2px solid var(--tp-text-accent); outline-offset: 3px; }button:not(:disabled):hover { filter: brightness(.96); }progress { accent-color: var(--tp-text-accent); }
@media (max-width: 800px) { .picture-backdrop { padding: 10px; }.picture-dialog { width: 100%; height: 96dvh; border-radius: 14px; }.picture-header { padding: 18px; }h2 { font-size: 23px; }.picture-body { grid-template-columns: 1fr; overflow-y: auto; }.picture-proof { min-height: 420px; padding: 16px; }.proof-stage { height: 340px; flex: none; }.picture-settings { overflow: visible; border-left: 0; border-top: 1px solid var(--tp-border-strong); padding: 20px; }.picture-footer { padding: 12px 16px; gap: 12px; }.download-button { padding: 11px 16px; } }
</style>
