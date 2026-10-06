<script setup lang="ts">
import InfoTooltip from './InfoTooltip.vue'
import { settingGuides, type SettingGuideId } from './setting-guides'

defineProps<{ guide: SettingGuideId; content?: string }>()
</script>

<template>
  <InfoTooltip
    :aria-label="`About ${settingGuides[guide].title}`"
    :title="settingGuides[guide].title"
    :content="content ?? settingGuides[guide].content"
    :tip="settingGuides[guide].tip"
    :visual="settingGuides[guide].visual"
    :data-setting-guide="guide"
  />
</template>
