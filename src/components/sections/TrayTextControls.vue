<script setup lang="ts">
import { computed } from "vue";
import type { AppConfig, TrayTextConfig } from "@shared/types/config";
import { trayTextEdgeCount } from "@shared/utils/tray-text-layout";
import NumberField from "@/components/ui/NumberField.vue";
import IosToggle from "@/components/ui/IosToggle.vue";

const text = defineModel<TrayTextConfig>({ required: true });
const props = defineProps<{ config: AppConfig }>();
const edgeCount = computed(() => trayTextEdgeCount(props.config));
const edgeNames = ["Front", "Right", "Back", "Left"];
const positions = computed(() => Array.from({ length: edgeCount.value }, (_, edge) => ({
  edge, name: props.config.mapCrop.shape === "polygon" ? `Edge ${edge + 1}${edge === 0 ? " · front" : ""}` : edgeNames[edge],
})));

function addLabel(): void {
  const edge = positions.value.find(p => !text.value.labels.some(label => label.edge === p.edge))?.edge;
  if (edge != null) text.value.labels.push({ text: "", edge });
}

function useTrackDetails(): void {
  const gpx = props.config.gpx;
  text.value.labels = [
    { text: (gpx.trackName || gpx.fileName?.replace(/\.gpx$/i, "") || "My trail").slice(0, 80), edge: 0 },
    { text: `${gpx.distanceKm.toFixed(2)} km`, edge: Math.floor(edgeCount.value / 2) },
  ];
}
</script>

<template>
  <div class="base-text">
    <div class="base-text__toggle">
      <div>
        <span class="base-text__title">Text on base</span>
        <p>Print raised labels on the rim, like a trail name or distance.</p>
      </div>
      <IosToggle v-model="text.enabled" aria-label="Text on base" />
    </div>
    <template v-if="text.enabled">
      <div class="base-text__dimensions">
        <NumberField v-model="text.sizeMm" label="Text size" suffix="mm" :min="2" :max="12" :step="0.5" />
        <NumberField v-model="text.heightMm" label="Text relief" suffix="mm" :min="0.2" :max="3" :step="0.1" />
      </div>
      <div v-for="(label, index) in text.labels" :key="index" class="base-text__label">
        <label>
          <span>Label {{ index + 1 }}</span>
          <input v-model="label.text" type="text" maxlength="80" :aria-label="`Base label ${index + 1}`" placeholder="SNOWDON · 154.80 km" />
        </label>
        <div class="base-text__position">
          <label>
            <span>Position</span>
            <select v-model="label.edge" :aria-label="`Label ${index + 1} position`">
              <option v-for="position in positions" :key="position.edge" :value="position.edge">{{ position.name }}</option>
            </select>
          </label>
          <button type="button" :aria-label="`Remove label ${index + 1}`" @click="text.labels.splice(index, 1)">Remove</button>
        </div>
      </div>
      <div class="base-text__actions">
        <button type="button" :disabled="text.labels.length >= edgeCount" @click="addLabel">+ Add label</button>
        <button v-if="config.gpx.imported" type="button" @click="useTrackDetails">Use track name & distance</button>
      </div>
      <p>One label per edge. Text fits the available rim space; circle labels follow the curve. Choose Text in Colors to set its color. Download the AMS base as a 3MF, or import the base and text STLs together as one object in your slicer.</p>
      <p>Supports Armenian, Latin and Greek letters, numbers, punctuation and ↑.</p>
    </template>
  </div>
</template>

<style scoped>
.base-text { display: flex; flex-direction: column; gap: 12px; padding-top: 14px; border-top: 1px solid var(--tp-border); }
.base-text__toggle { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.base-text__title { font-size: 14px; font-weight: 500; }
p { margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: var(--tp-text-secondary); }
.base-text__dimensions { display: flex; gap: 12px; }
.base-text__dimensions > * { flex: 1; min-width: 0; }
.base-text__label { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--tp-border); border-radius: 10px; }
label { display: flex; flex-direction: column; gap: 6px; min-width: 0; font-size: 12px; color: var(--tp-text-secondary); }
input, select { box-sizing: border-box; width: 100%; min-width: 0; padding: 9px; border: 1px solid var(--tp-border-strong); border-radius: 7px; background: var(--tp-bg-input); color: var(--tp-text-primary); font: inherit; }
input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--tp-text-accent); outline-offset: 2px; }
.base-text__position { display: flex; align-items: flex-end; gap: 10px; }
.base-text__position label { flex: 1; }
button { padding: 9px 0; border: 0; background: none; color: var(--tp-text-accent); font: inherit; font-size: 12px; cursor: pointer; }
button:disabled { opacity: 0.4; cursor: default; }
.base-text__actions { display: flex; flex-wrap: wrap; gap: 6px 16px; }
</style>
