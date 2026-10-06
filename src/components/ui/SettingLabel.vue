<script setup lang="ts">
import SettingHelp from './SettingHelp.vue'
import type { SettingGuideId } from './setting-guides'

defineProps<{ label: string; guide: SettingGuideId; content?: string }>()
</script>

<template>
  <span class="setting-label">
    <span>{{ label }}</span>
    <SettingHelp :guide="guide" :content="content" />
  </span>
</template>

<style scoped>
.setting-label { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
</style>
