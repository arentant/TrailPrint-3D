<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useConfigStore } from '@/stores/config';
import { buildModelTextLayout, modelFootprint } from '@shared/utils/model-features';
import { computeTerrainCropRegion } from '@shared/utils/crop-region';
import { createDefaultFeaturePosition, type ModelFeaturePosition } from '@shared/types/config';
import { MODEL_PLACEMENT_PRESETS, modelPlacementPresetPosition, type ModelPlacementPreset } from '@shared/utils/model-placement-presets';
import type { TrayTextShape } from '@shared/utils/tray-text-layout';
import NumberField from '@/components/ui/NumberField.vue';

type Kind = 'text' | 'logo';
type Surface = 'front' | 'underside';
const { config } = storeToRefs(useConfigStore());
const kind = ref<Kind>('text'), surface = ref<Surface>('underside');
const svg = ref<SVGSVGElement | null>(null);
const frozenBox = ref<string | null>(null);
const presetError = ref('');
const chosenPresets = ref<Record<string, { id: ModelPlacementPreset; position: ModelFeaturePosition }>>({});
let drag: { pointerId: number; x: number; y: number; position: ModelFeaturePosition; startX: number; startY: number } | null = null;
const features = computed<Kind[]>(() => {
  const result: Kind[] = [];
  const terrain = config.value.terrain;
  if (terrain.text.enabled && (terrain.text.title.trim() || terrain.text.subtitle.trim())) result.push('text');
  if (terrain.logo.enabled && terrain.logo.asset) result.push('logo');
  return result;
});
const settings = computed(() => kind.value === 'text' ? config.value.terrain.text : config.value.terrain.logo);
const surfaces = computed<Surface[]>(() => settings.value.placement === 'both' ? ['front', 'underside'] : [settings.value.placement]);
watch(features, values => { if (!values.includes(kind.value)) kind.value = values[0] ?? 'text'; }, { immediate: true });
watch(surfaces, values => { if (!values.includes(surface.value)) surface.value = values[0]!; }, { immediate: true });
const position = computed(() => surface.value === 'front' ? settings.value.frontPosition : settings.value.undersidePosition);
const name = computed(() => kind.value === 'text' ? 'Text' : 'Logo');
const presetKey = computed(() => `${kind.value}:${surface.value}`);
const activePreset = computed(() => {
  const chosen = chosenPresets.value[presetKey.value];
  return chosen && (['xMm', 'yMm', 'rotationDeg'] as const).every(key => Math.abs(chosen.position[key] - position.value[key]) < 0.0001) ? chosen.id : null;
});
watch([kind, surface, () => position.value.xMm, () => position.value.yMm, () => position.value.rotationDeg], () => { presetError.value = ''; });
function applyPreset(id: ModelPlacementPreset) {
  try {
    const next = modelPlacementPresetPosition(config.value, kind.value, surface.value, id);
    if (!next) { presetError.value = 'This position does not fit or overlaps the keychain hole. Reduce the artwork size or choose another position.'; return; }
    Object.assign(position.value, next);
    chosenPresets.value[presetKey.value] = { id, position: { ...next } };
    presetError.value = '';
  } catch (cause) { presetError.value = cause instanceof Error ? cause.message : 'Check the artwork size and placement.'; }
}
const crop = computed(() => computeTerrainCropRegion(config.value.mapCrop, 800, 600));
const footprint = computed(() => modelFootprint(crop.value));
const layout = computed(() => {
  try { return buildModelTextLayout(config.value, crop.value, false); }
  catch { return null; }
});
function shapes(feature: Kind): TrayTextShape[] {
  if (!layout.value) return [];
  if (feature === 'text') return surface.value === 'front' ? layout.value.front : layout.value.underside;
  return surface.value === 'front' ? layout.value.logoFront : layout.value.logoUnderside;
}
const visible = computed(() => features.value.filter(feature => shapes(feature).length));
const display = (p: { x: number; y: number }) => ({ x: surface.value === 'underside' ? -p.x : p.x, y: -p.y });
function path(loops: Array<Array<{ x: number; y: number }>>) {
  return loops.map(loop => `M${loop.map(p => { const q = display(p); return `${q.x},${q.y}`; }).join('L')}Z`).join('');
}
function markPath(feature: Kind) { return path(shapes(feature).flatMap(shape => [shape.contour, ...shape.holes])); }
function bounds(feature: Kind) {
  const points = shapes(feature).flatMap(shape => shape.contour).map(display);
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { x: Math.min(...xs) - 1, y: Math.min(...ys) - 1, width: Math.max(...xs) - Math.min(...xs) + 2, height: Math.max(...ys) - Math.min(...ys) + 2 };
}
const viewBox = computed(() => {
  if (frozenBox.value) return frozenBox.value;
  const plaque = surface.value === 'front' ? layout.value?.plaque ?? [] : [];
  const frontY = Math.min(...footprint.value.map(p => p.y));
  // Give the small caption ledge enough screen space to arrange its artwork.
  const outline = plaque.length ? [...plaque, ...plaque.slice(0, 2).map(p => ({ x: p.x, y: frontY + 8 }))] : footprint.value;
  const points = [...outline,
    ...visible.value.flatMap(feature => shapes(feature).flatMap(shape => shape.contour))].map(display);
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs) - 6, minY = Math.min(...ys) - 6;
  return `${minX} ${minY} ${Math.max(...xs) - minX + 6} ${Math.max(...ys) - minY + 6}`;
});
function pointer(event: PointerEvent) {
  const matrix = svg.value?.getScreenCTM();
  return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : null;
}
function startDrag(event: PointerEvent, feature: Kind) {
  if (event.button !== 0) return;
  kind.value = feature;
  const point = pointer(event);
  if (!point || !svg.value) return;
  frozenBox.value = viewBox.value;
  drag = { pointerId: event.pointerId, x: point.x, y: point.y, position: position.value, startX: position.value.xMm, startY: position.value.yMm };
  svg.value.setPointerCapture(event.pointerId);
}
function move(event: PointerEvent) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const point = pointer(event); if (!point) return;
  drag.position.xMm = Math.round(Math.max(-500, Math.min(500, drag.startX + point.x - drag.x)) * 10) / 10;
  drag.position.yMm = Math.round(Math.max(-500, Math.min(500, drag.startY - point.y + drag.y)) * 10) / 10;
}
function endDrag(event: PointerEvent) {
  if (drag?.pointerId !== event.pointerId) return;
  if (svg.value?.hasPointerCapture(event.pointerId)) svg.value.releasePointerCapture(event.pointerId);
  drag = null; frozenBox.value = null;
}
</script>

<template>
  <div v-if="features.length" class="placement-editor">
    <div class="placement-editor__heading"><strong>Arrange text & logo</strong><span>Drag to move</span></div>
    <div class="placement-editor__tabs" role="group" aria-label="Feature to position">
      <button v-for="feature in features" :key="feature" type="button" :aria-pressed="kind === feature" @click="kind = feature">{{ feature === 'text' ? 'Text' : 'Logo' }}</button>
    </div>
    <div class="placement-editor__tabs" role="group" aria-label="Placement surface">
      <button v-for="side in surfaces" :key="side" type="button" :aria-pressed="surface === side" @click="surface = side">{{ side === 'front' ? 'Front layout' : 'Underside layout' }}</button>
    </div>
    <div class="placement-editor__presets" role="group" aria-label="Quick placement">
      <button v-for="preset in MODEL_PLACEMENT_PRESETS" :key="preset.id" type="button" :aria-pressed="activePreset === preset.id" :disabled="!shapes(kind).length" :title="`Place ${name.toLowerCase()} at ${preset.label.toLowerCase()}`" @click="applyPreset(preset.id)">{{ preset.label }}</button>
    </div>
    <p v-if="presetError" class="placement-editor__error" role="alert">{{ presetError }}</p>
    <svg ref="svg" class="placement-editor__canvas" :viewBox="viewBox" role="group" aria-label="Model placement editor" @pointermove="move" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag">
      <path :d="path([footprint])" class="placement-editor__model" />
      <path v-if="surface === 'front' && layout?.plaque.length" :d="path([layout.plaque])" class="placement-editor__model" />
      <g v-for="feature in visible" :key="feature" :data-feature="feature" role="button" tabindex="0" :aria-label="`Move ${feature}`" :aria-pressed="kind === feature" class="placement-editor__mark" :class="{ 'placement-editor__mark--selected': kind === feature }" @pointerdown.prevent="startDrag($event, feature)" @keydown.enter.prevent="kind = feature" @keydown.space.prevent="kind = feature">
        <rect v-bind="bounds(feature)" class="placement-editor__selection" />
        <path :d="markPath(feature)" fill-rule="evenodd" />
      </g>
    </svg>
    <p>{{ surface === 'underside' ? 'Seen from below, as it will read on the model.' : 'The front ledge grows to fit the artwork.' }} Choose a position, drag an item or enter exact offsets below. Quick placement keeps its size and rotation. Each surface has its own position.</p>
    <div class="placement-editor__row">
      <NumberField v-model="position.xMm" :label="`${name} horizontal offset`" suffix="mm" :min="-500" :max="500" :step="0.5" />
      <NumberField v-model="position.yMm" :label="`${name} vertical offset`" suffix="mm" :min="-500" :max="500" :step="0.5" />
    </div>
    <NumberField v-model="position.rotationDeg" :label="`${name} rotation`" suffix="°" :min="-360" :max="360" :step="5" />
    <button type="button" class="placement-editor__reset" @click="Object.assign(position, createDefaultFeaturePosition())">Reset {{ name.toLowerCase() }} position</button>
  </div>
</template>

<style scoped>
.placement-editor { display: flex; flex-direction: column; gap: 10px; padding-top: 16px; border-top: 1px solid var(--tp-border); }
.placement-editor__heading, .placement-editor__tabs, .placement-editor__row { display: flex; align-items: center; gap: 8px; }
.placement-editor__heading { justify-content: space-between; font-size: 12px; }
.placement-editor__heading span, p { color: var(--tp-text-secondary); font-size: 11px; }
p { margin: 0; line-height: 1.5; }
.placement-editor__tabs button, .placement-editor__presets button { flex: 1; padding: 8px; border: 1px solid var(--tp-border); border-radius: 7px; background: var(--tp-bg-input); color: var(--tp-text-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.placement-editor__tabs button[aria-pressed="true"], .placement-editor__presets button[aria-pressed="true"] { border-color: var(--tp-text-accent); color: var(--tp-text-accent); font-weight: 600; }
.placement-editor__presets { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
.placement-editor__presets button { min-height: 34px; padding: 6px 3px; font-size: 11px; }
.placement-editor__presets button:disabled { opacity: 0.45; cursor: default; }
.placement-editor__error { color: var(--tp-danger, #b42318); }
.placement-editor__canvas { display: block; width: 100%; height: 230px; border: 1px solid var(--tp-border); border-radius: 10px; background: var(--tp-bg-input); touch-action: none; }
.placement-editor__model { fill: var(--tp-bg-panel); stroke: var(--tp-border-strong); stroke-width: 1; vector-effect: non-scaling-stroke; }
.placement-editor__mark { fill: var(--tp-text-primary); cursor: move; }
.placement-editor__mark--selected { fill: var(--tp-text-accent); }
.placement-editor__selection { fill: transparent; stroke: transparent; stroke-width: 1; vector-effect: non-scaling-stroke; }
.placement-editor__mark--selected .placement-editor__selection { stroke: var(--tp-text-accent); stroke-dasharray: 4 3; }
button:focus-visible, .placement-editor__mark:focus-visible { outline: 2px solid var(--tp-text-accent); outline-offset: 2px; }
.placement-editor__reset { align-self: flex-start; border: 0; padding: 0; background: none; color: var(--tp-text-accent); font: inherit; font-size: 12px; cursor: pointer; }
</style>
