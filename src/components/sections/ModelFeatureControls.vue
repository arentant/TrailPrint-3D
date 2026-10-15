<script setup lang="ts">
import { computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useConfigStore } from '@/stores/config';
import { modelEdgeCount, validateModelFeatures } from '@shared/utils/model-features';
import NumberField from '@/components/ui/NumberField.vue';
import IosToggle from '@/components/ui/IosToggle.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import ModelLogoControls from './ModelLogoControls.vue';
import ModelPlacementEditor from './ModelPlacementEditor.vue';

const { config } = storeToRefs(useConfigStore());
const text = computed(() => config.value.terrain.text);
const keychain = computed(() => config.value.terrain.keychain);
const edges = computed(() => Array.from({ length: modelEdgeCount(config.value) }, (_, edge) => ({ edge,
  name: config.value.mapCrop.shape === 'polygon' ? `Edge ${edge + 1}${edge === 0 ? ' · front' : ''}` : ['Front', 'Right', 'Back', 'Left'][edge] })));
watch(() => edges.value.length, count => { if (keychain.value.edge >= count) keychain.value.edge = 0; });
const validation = computed(() => {
  try { validateModelFeatures(config.value); return ''; }
  catch (error) { return error instanceof Error ? error.message : 'Check text and hole settings.'; }
});
function useRoute(includeDetails: boolean) {
  text.value.title = (config.value.gpx.trackName || config.value.gpx.fileName?.replace(/\.gpx$/i, '') || '').slice(0, 80);
  text.value.subtitle = includeDetails ? `${config.value.gpx.distanceKm.toFixed(2)} km${config.value.gpx.activityDate ? ` · ${config.value.gpx.activityDate.slice(0, 10)}` : ''}` : '';
}
</script>

<template>
  <div class="model-features">
    <div class="model-features__heading">
      <div><span>Text on model</span><p>Add a caption below the terrain or a message on its underside.</p></div>
      <IosToggle v-model="text.enabled" aria-label="Text on model" />
    </div>
    <template v-if="text.enabled">
      <label>Text placement
        <select v-model="text.placement" aria-label="Model text placement">
          <option value="front">Front caption</option><option value="underside">Underside</option><option value="both">Both placements</option>
        </select>
      </label>
      <div class="model-features__sample" :class="{ 'model-features__sample--engraved': text.style === 'engraved' }" aria-label="Lettering sample">
        <strong>{{ text.title || 'Your adventure' }}</strong><span v-if="text.subtitle">{{ text.subtitle }}</span>
      </div>
      <label>Title<input v-model="text.title" aria-label="Model text title" maxlength="80" placeholder="e.g. Mount Aragats" /></label>
      <label>Second line <span class="model-features__optional">Optional</span><input v-model="text.subtitle" aria-label="Model text second line" maxlength="80" placeholder="e.g. 4,090 m · October 2026" /></label>
      <div v-if="config.gpx.imported" class="model-features__actions">
        <button type="button" @click="useRoute(false)">Use route name</button><button type="button" @click="useRoute(true)">Name + distance</button>
      </div>
      <div class="model-features__field">
        <span>Lettering</span>
        <SegmentedControl v-model="text.style" aria-label="Model lettering style" :options="[{ value: 'raised', label: 'Raised' }, { value: 'engraved', label: 'Engraved' }]" />
      </div>
      <div class="model-features__row">
        <NumberField v-model="text.sizeMm" label="Model text size" suffix="mm" :min="2" :max="16" :step="0.5" />
        <NumberField v-model="text.heightMm" :label="text.style === 'raised' ? 'Model text height' : 'Model engraving depth'" suffix="mm" :min="0.2" :max="3" :step="0.1" />
      </div>
      <p>{{ text.placement === 'underside' ? 'Readable from below. Use View underside in the 3D preview.' : 'The front caption sits on a small ledge joined to the terrain, with no separate base needed.' }} Text shrinks to fit while keeping printable letters. Arrange it in the layout editor below.</p>
      <p v-if="text.placement !== 'front' && text.style === 'raised'">Raised underside lettering lifts the model off the bed. Choose engraved for a flat bottom.</p>
    </template>
    <ModelLogoControls />
    <ModelPlacementEditor />
    <div class="model-features__heading model-features__divider">
      <div><span>Keychain hole on model</span><p>A round hole directly through the terrain, ready for a key ring.</p></div>
      <IosToggle v-model="keychain.enabled" aria-label="Keychain hole on model" />
    </div>
    <template v-if="keychain.enabled">
      <div class="model-features__row">
        <NumberField v-model="keychain.diameterMm" label="Model hole diameter" suffix="mm" :min="2" :max="10" :step="0.5" />
        <NumberField v-model="keychain.insetMm" label="Model hole inset" suffix="mm" :min="0" :step="0.5" />
      </div>
      <label>Model edge<select v-model="keychain.edge" aria-label="Model hole edge"><option v-for="edge in edges" :key="edge.edge" :value="edge.edge">{{ edge.name }}</option></select></label>
      <NumberField v-model="keychain.offsetMm" label="Model hole offset" suffix="mm" :step="0.5" />
      <p>Inset measures from the edge to the hole center. Offset moves it along the edge; zero centers it. Keep at least 2 mm of material around the opening.</p>
    </template>
    <p v-if="validation" class="model-features__error" role="alert">{{ validation }}</p>
    <p v-else-if="text.enabled || config.terrain.logo.enabled || keychain.enabled">Included in the 3D preview, terrain STL and model 3MF. Saved with your presets.</p>
  </div>
</template>

<style scoped>
.model-features { display: flex; flex-direction: column; gap: 12px; padding-top: 16px; border-top: 1px solid var(--tp-border); }
.model-features__heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; font-size: 13px; font-weight: 600; }
.model-features__heading p { margin-top: 5px; font-weight: 400; }
.model-features__divider { padding-top: 16px; border-top: 1px solid var(--tp-border); }
p { margin: 0; font-size: 11px; line-height: 1.5; color: var(--tp-text-secondary); }
label, .model-features__field { display: flex; flex-direction: column; gap: 6px; min-width: 0; font-size: 12px; color: var(--tp-text-secondary); }
input, select { box-sizing: border-box; width: 100%; min-width: 0; padding: 10px; border: 1px solid var(--tp-border-strong); border-radius: var(--tp-radius-control); background: var(--tp-bg-input); color: var(--tp-text-primary); font: inherit; }
input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--tp-text-accent); outline-offset: 2px; }
.model-features :deep(.field__input-wrap:focus-within) { outline: 2px solid var(--tp-text-accent); outline-offset: 2px; }
.model-features__optional { font-size: 10px; margin-top: -4px; }
.model-features__row, .model-features__actions { display: flex; gap: 12px; }
.model-features__actions { flex-wrap: wrap; }
.model-features__actions button { border: 0; padding: 0; background: none; color: var(--tp-text-accent); font: inherit; font-size: 12px; cursor: pointer; }
.model-features__sample { display: flex; flex-direction: column; justify-content: center; gap: 5px; min-height: 64px; padding: 12px; overflow-wrap: anywhere; text-align: center; background: var(--tp-bg-input); border-radius: var(--tp-radius-control); color: var(--tp-text-primary); }
.model-features__sample strong { font-size: 18px; text-shadow: 0 1px 0 white, 0 -1px 1px #0003; }
.model-features__sample span { font-size: 11px; }
.model-features__sample--engraved strong { color: var(--tp-text-secondary); text-shadow: 0 1px 0 white; }
.model-features__error { color: var(--tp-danger, #b42318); }
</style>
