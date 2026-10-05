<script setup lang="ts">
import type { CityMapConfig } from '@shared/types/city';
import NumberField from '@/components/ui/NumberField.vue';
const props = defineProps<{ modelValue: CityMapConfig['city']; baseThickness: number; disabled?: boolean; stacked?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: CityMapConfig['city']] }>();
function update(key: keyof CityMapConfig['city'], value: number) {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}
</script>
<template>
  <div class="trail-controls" :class="{ stacked }">
    <div class="row">
      <NumberField :model-value="modelValue.routeWidthMm" @update:model-value="update('routeWidthMm', $event)" label="Route width" suffix="mm" :min="0.4" :max="10" :disabled="disabled" />
      <NumberField :model-value="modelValue.routeClearanceMm" @update:model-value="update('routeClearanceMm', $event)" label="Clearance per side" suffix="mm" :min="0" :max="1" :step="0.05" :disabled="disabled" />
    </div>
    <div class="row">
      <NumberField :model-value="modelValue.routeSeatDepthMm" @update:model-value="update('routeSeatDepthMm', $event)" label="Seating depth" suffix="mm" :min="0.1" :max="baseThickness - 0.4" :disabled="disabled" />
      <NumberField :model-value="modelValue.routeReliefMm" @update:model-value="update('routeReliefMm', $event)" label="Visible route relief" suffix="mm" :min="0.2" :max="10" :disabled="disabled" />
    </div>
  </div>
</template>
<style scoped>
.trail-controls { display: flex; flex-direction: column; gap: 12px; }
.row { display: flex; gap: 12px; }
.stacked .row { flex-direction: column; }
@media (max-width: 900px) { .stacked .row { flex-direction: row; } }
</style>
