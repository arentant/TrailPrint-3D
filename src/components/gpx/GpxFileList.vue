<script setup lang="ts">
import type { GpxState } from '@shared/types';
defineProps<{ gpx: GpxState; disabled?: boolean }>();
defineEmits<{ remove: [importId: string]; clear: [] }>();
</script>

<template>
  <div v-if="gpx.imported" class="gpx-files">
    <p class="gpx-files__total">{{ gpx.files?.length ?? 1 }} GPX {{ (gpx.files?.length ?? 1) === 1 ? 'file' : 'files' }} · {{ gpx.distanceKm.toFixed(2) }} km total</p>
    <ul v-if="gpx.files?.length" aria-label="GPX files in this model">
      <li v-for="file in gpx.files" :key="file.importId">
        <div class="gpx-files__details">
          <strong :title="file.trackName || file.fileName">{{ file.trackName || file.fileName || 'Imported trail' }}</strong>
          <span>{{ file.fileName }} · {{ file.distanceKm.toFixed(2) }} km</span>
        </div>
        <button type="button" :disabled="disabled" :aria-label="`Remove ${file.fileName || file.trackName || 'trail'}`" @click="$emit('remove', file.importId)">Remove</button>
      </li>
    </ul>
    <p v-else class="gpx-files__legacy">{{ gpx.trackName || gpx.fileName }}</p>
    <p class="gpx-files__hint">Add more GPX files to combine trails in this model.</p>
    <button type="button" :disabled="disabled" @click="$emit('clear')">{{ (gpx.files?.length ?? 1) > 1 ? 'Remove all GPX files' : 'Remove GPX' }}</button>
  </div>
</template>

<style scoped>
.gpx-files { font-size: 12px; }
.gpx-files__total { margin: 0 0 8px; font-weight: 600; color: var(--tp-text-primary); }
ul { list-style: none; padding: 0; margin: 0; max-height: 200px; overflow-y: auto; }
li { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-top: 1px solid var(--tp-border); }
.gpx-files__details { min-width: 0; flex: 1; }
strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 600; }
span { display: block; overflow-wrap: anywhere; color: var(--tp-text-secondary); font-size: 11px; line-height: 1.5; }
.gpx-files__hint, .gpx-files__legacy { margin: 6px 0; color: var(--tp-text-secondary); font-size: 11px; line-height: 1.4; }
button { flex-shrink: 0; color: var(--tp-text-accent); font-size: 11px; padding: 5px 2px; }
button:disabled { opacity: .45; cursor: default; }
button:focus-visible { outline: 2px solid var(--tp-text-accent); outline-offset: 2px; }
</style>
