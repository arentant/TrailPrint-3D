<script setup lang="ts">
import { DEFAULT_MODEL_FLOW } from '@shared/types/export'
import { modelWorkspaces } from '@/workflows'
</script>

<template>
  <component :is="modelWorkspaces[DEFAULT_MODEL_FLOW]" />
</template>
