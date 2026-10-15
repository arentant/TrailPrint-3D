<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useConfigStore } from '@/stores/config'
import { useUiStore } from '@/stores/ui'

const store = useConfigStore()
const ui = useUiStore()
const { config } = storeToRefs(store)
const gpx = computed(() => config.value.gpx)
</script>

<template>
  <div v-if="gpx.lastImportError" class="gpx-summary gpx-summary--error">
    {{ gpx.lastImportError }}
  </div>
  <div v-else-if="gpx.imported" class="gpx-summary">
    <p class="gpx-summary__title">{{ gpx.trackName || gpx.fileName || 'Imported trail' }}</p>
    <p class="gpx-summary__meta">
      {{ gpx.pointCount }} points · approx. {{ gpx.distanceKm.toFixed(2) }} km
      <template v-if="gpx.bounds">
        · {{ gpx.bounds.minLat.toFixed(2) }}°–{{ gpx.bounds.maxLat.toFixed(2) }}°
      </template>
    </p>
    <button type="button" class="gpx-summary__remove" :disabled="ui.generating" @click="store.clearGpx()">Remove GPX</button>
  </div>
  <div v-else class="gpx-summary">
    <p class="gpx-summary__title">Choose a place on the map</p>
    <p class="gpx-summary__meta">Search a place or paste coordinates, then move, resize or rotate the shape. Import a GPX to add a trail.</p>
  </div>
</template>

<style scoped>
.gpx-summary {
  margin: 0;
  padding: 8px 10px;
  background: var(--tp-bg-input);
  border-radius: var(--tp-radius-control);
  font-size: 12px;
}

.gpx-summary--error {
  margin: 0;
  padding: 8px 10px;
  background: #fff0f0;
  border-radius: var(--tp-radius-control);
  font-size: 12px;
  color: #ff3b30;
  line-height: 1.4;
}

.gpx-summary__title {
  margin: 0 0 2px;
  font-size: 13px;
  font-weight: 600;
  color: var(--tp-text-primary);
  line-height: 1.3;
}

.gpx-summary__meta {
  margin: 0;
  color: var(--tp-text-secondary);
  font-size: 11px;
  line-height: 1.35;
}

.gpx-summary__remove {
  color: var(--tp-text-accent);
  font-size: 12px;
  padding: 4px 0;
}
</style>
