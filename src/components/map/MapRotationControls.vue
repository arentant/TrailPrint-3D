<script setup lang="ts">
import { computed, useId } from 'vue';

const props = defineProps<{ bearing: number; disabled?: boolean }>();
const emit = defineEmits<{ 'update:bearing': [bearing: number] }>();
const sliderId = useId();
const bearing = computed(() => ((props.bearing % 360) + 360) % 360);
const degrees = computed(() => Math.round(bearing.value) % 360);

function setBearing(value: number): void {
  if (props.disabled || !Number.isFinite(value)) return;
  emit('update:bearing', ((value % 360) + 360) % 360);
}
</script>

<template>
  <div class="map-rotation" role="group" aria-label="Map rotation controls">
    <div class="map-rotation__heading">
      <label :for="sliderId">Map rotation</label>
      <output :for="sliderId">{{ degrees }}°</output>
    </div>
    <div class="map-rotation__adjust">
      <button type="button" :disabled="disabled" aria-label="Rotate map counterclockwise"
        title="Rotate counterclockwise 15°" @click="setBearing(bearing - 15)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path d="M3 11a9 9 0 1 1 2.6 7.4" /><path d="M3 4v7h7" />
        </svg>
      </button>
      <input :id="sliderId" type="range" min="0" max="360" step="1" :value="bearing"
        :disabled="disabled" :aria-valuetext="`${degrees} degrees clockwise from north`"
        @input="setBearing(Number(($event.target as HTMLInputElement).value))" />
      <button type="button" :disabled="disabled" aria-label="Rotate map clockwise"
        title="Rotate clockwise 15°" @click="setBearing(bearing + 15)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path d="M21 11a9 9 0 1 0-2.6 7.4" /><path d="M21 4v7h-7" />
        </svg>
      </button>
    </div>
    <div class="map-rotation__footer">
      <button type="button" :disabled="disabled" aria-label="Reset map rotation to north"
        title="Reset rotation without changing position or zoom" @click="setBearing(0)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path :transform="`rotate(${bearing} 12 12)`" d="m12 3 6 17-6-4-6 4z" />
        </svg>
        Reset north
      </button>
      <span>Alt / Option + drag</span>
    </div>
  </div>
</template>

<style scoped>
.map-rotation {
  position: absolute;
  top: 72px;
  left: 16px;
  z-index: 1001;
  width: 224px;
  max-width: calc(100% - 32px);
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  color: var(--tp-text-primary);
}

.map-rotation__heading,
.map-rotation__adjust,
.map-rotation__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.map-rotation__heading {
  font-size: 12px;
  font-weight: 600;
}

output {
  color: var(--tp-text-accent);
  font-variant-numeric: tabular-nums;
}

.map-rotation__adjust { margin: 6px -4px; }

button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-width: 32px;
  min-height: 32px;
  padding: 4px;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

button:hover:not(:disabled) { background: var(--tp-bg-page); }
button:disabled { opacity: 0.45; cursor: default; }
button:focus-visible, input:focus-visible {
  outline: 2px solid var(--tp-text-accent);
  outline-offset: 2px;
}

input {
  width: 100%;
  min-width: 0;
  height: 32px;
  margin: 0;
  accent-color: var(--tp-text-accent);
  cursor: pointer;
}

.map-rotation__footer { gap: 4px; }
.map-rotation__footer button { gap: 4px; padding: 0 2px; font-size: 11px; }
.map-rotation__footer span { font-size: 10px; color: var(--tp-text-secondary); }
</style>
