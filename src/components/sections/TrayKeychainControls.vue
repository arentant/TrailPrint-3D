<script setup lang="ts">
import { computed } from "vue";
import type { AppConfig, TrayKeychainConfig } from "@shared/types/config";
import { computeTrayFootprint } from "@shared/utils/tray-footprint";
import { trayKeychainMaxOffsetMm, trayRimEdgeCount } from "@shared/utils/tray-keychain-layout";
import NumberField from "@/components/ui/NumberField.vue";
import IosToggle from "@/components/ui/IosToggle.vue";

const keychain = defineModel<TrayKeychainConfig>({ required: true });
const props = defineProps<{ config: AppConfig }>();
const footprint = computed(() => computeTrayFootprint(props.config));
const positions = computed(() => Array.from({ length: trayRimEdgeCount(footprint.value) }, (_, edge) => ({
  edge, name: props.config.mapCrop.shape === "polygon" ? `Edge ${edge + 1}${edge === 0 ? " · front" : ""}` : ["Front", "Right", "Back", "Left"][edge],
})));
const maxOffset = computed(() => {
  const value = trayKeychainMaxOffsetMm(footprint.value, props.config.tray);
  return Number.isFinite(value) ? Math.floor(value) : 0;
});
</script>

<template>
  <div class="keychain-controls">
    <div class="keychain-controls__toggle">
      <div>
        <span class="keychain-controls__title">Keychain hole</span>
        <p>Add a round hole through the base rim for a key ring.</p>
      </div>
      <IosToggle v-model="keychain.enabled" aria-label="Keychain hole" />
    </div>
    <template v-if="keychain.enabled">
      <NumberField v-model="keychain.diameterMm" label="Keychain hole diameter" suffix="mm" :min="2" :max="10" :step="0.5" />
      <label>
        <span>Rim edge</span>
        <select v-model="keychain.edge" aria-label="Keychain hole edge">
          <option v-for="position in positions" :key="position.edge" :value="position.edge">{{ position.name }}</option>
        </select>
      </label>
      <NumberField v-model="keychain.offsetMm" label="Keychain hole offset" suffix="mm" :min="-maxOffset" :max="maxOffset" :step="0.5" />
      <p>Zero centers the hole on the selected edge. Positive values move it to the right along that edge; circle positions follow the rim curve.</p>
      <p>Keeps at least 2 mm of material around the hole and clears labels and pockets. Included in the preview and base STL.</p>
    </template>
  </div>
</template>

<style scoped>
.keychain-controls { display: flex; flex-direction: column; gap: 12px; padding-top: 14px; border-top: 1px solid var(--tp-border); }
.keychain-controls__toggle { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.keychain-controls__title { font-size: 14px; font-weight: 500; }
p { margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: var(--tp-text-secondary); }
label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--tp-text-secondary); }
select { box-sizing: border-box; width: 100%; min-width: 0; padding: 9px; border: 1px solid var(--tp-border-strong); border-radius: 7px; background: var(--tp-bg-input); color: var(--tp-text-primary); font: inherit; }
select:focus-visible { outline: 2px solid var(--tp-text-accent); outline-offset: 2px; }
</style>
