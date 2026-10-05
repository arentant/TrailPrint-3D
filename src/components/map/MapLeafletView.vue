<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useConfigStore } from '@/stores/config';
import { useUiStore } from '@/stores/ui';
import { useTrailPoints } from '@/composables/useTrailPoints';
import MapFramingView from './MapFramingView.vue';
const store = useConfigStore();
const { config } = storeToRefs(store);
const ui = useUiStore();
const { effectivePoints } = useTrailPoints();
const map = ref<InstanceType<typeof MapFramingView> | null>(null);
let unsubscribe: (() => void) | undefined;
const syncStoreFromMap = () => map.value?.syncStoreFromMap();
const fitTrackInView = () => map.value?.fitTrackInView();
const resetMapView = () => map.value?.resetMapView();
onMounted(() => { unsubscribe = ui.registerPrepareExportHook(syncStoreFromMap); });
onUnmounted(() => unsubscribe?.());
defineExpose({ syncStoreFromMap, fitTrackInView, resetMapView });
</script>
<template>
  <MapFramingView ref="map" :crop="config.mapCrop" :gpx="config.gpx" :points="effectivePoints"
    :tray="config.tray" :fit-nonce="ui.gpxMapFitNonce" :grid-visible="ui.mapGridVisible"
    :restore-view="!!store.schemes.find(s => s.id === store.activeSchemeId)?.payload.mapView"
    @update:crop="config.mapCrop = $event" />
</template>
