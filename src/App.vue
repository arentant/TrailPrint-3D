<script setup lang="ts">
import { ref } from 'vue';
import { DEFAULT_MODEL_FLOW, type ModelFlowId } from '@shared/types/export';
import { modelWorkspaces } from '@/workflows';
import { useUiStore } from '@/stores/ui';
const flow = ref<ModelFlowId>(DEFAULT_MODEL_FLOW);
const ui = useUiStore();
function switchWorkspace(next: ModelFlowId) {
  if (ui.generating || next === flow.value) return;
  ui.terrainPreviewOpen = false; ui.statusMessage = null; ui.lastExportPath = null; ui.exportProgress = 0;
  window.trailPrint.clearExportDownload();
  flow.value = next;
}
</script>
<template>
  <nav class="workspace-selector" aria-label="Model workflow">
    <button type="button" :aria-pressed="flow === 'mountain-trail'" :disabled="ui.generating" @click="switchWorkspace('mountain-trail')">Mountain</button>
    <button type="button" :aria-pressed="flow === 'city-map'" :disabled="ui.generating" @click="switchWorkspace('city-map')">City</button>
    <span>Each workspace keeps its own route and settings.</span>
  </nav>
  <component :is="modelWorkspaces[flow]" :key="flow" />
</template>
<style scoped>
.workspace-selector { display: flex; align-items: center; gap: 6px; padding: 12px 24px 0; background: var(--tp-bg-page); }
button { padding: 8px 20px; font-size: 13px; font-weight: 600; border-radius: 9px; color: var(--tp-text-secondary); }
button[aria-pressed='true'] { background: var(--tp-bg-panel); color: var(--tp-text-primary); box-shadow: var(--tp-shadow-panel); }
button:disabled { opacity: 0.5; cursor: default; } button:focus-visible { outline: 2px solid var(--tp-text-accent); }
span { margin-left: 12px; font-size: 11px; color: var(--tp-text-secondary); }
</style>
