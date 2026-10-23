<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useConfigStore } from '@/stores/config'
import { useUiStore } from '@/stores/ui'
import GpxFileList from './GpxFileList.vue'

const store = useConfigStore()
const ui = useUiStore()
const { config } = storeToRefs(store)
const gpx = computed(() => config.value.gpx)
</script>

<template>
  <div v-if="gpx.lastImportError" class="gpx-summary gpx-summary--error" role="alert">
    {{ gpx.lastImportError }}
  </div>
  <div v-if="gpx.imported" class="gpx-summary">
    <GpxFileList :gpx="gpx" :disabled="ui.generating || ui.gpxImporting" @remove="store.removeGpxImport" @clear="store.clearGpx" />
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

</style>
