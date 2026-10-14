<script setup lang="ts">
import { useWaterStore } from '@/stores/water';
import type { WaterFeatureStatus } from '@shared/types/water';
const water = useWaterStore();
const statusLabels: Record<WaterFeatureStatus['state'], string> = {
  included: 'Kept', excluded: 'Hidden', 'category-disabled': 'Category hidden',
  'too-small': 'Too small to print', covered: 'Covered by another source',
  incomplete: 'Incomplete outline', 'outside-crop': 'Outside crop',
};
</script>
<template>
  <section class="water-review" aria-label="Water feature review" :aria-busy="water.loading || water.reviewing">
    <div class="water-review__header">
      <strong>Detected water</strong>
      <div class="water-review__actions">
        <button type="button" :disabled="water.loading || water.reviewing || !water.canUncheckAll" @click="water.uncheckAll">Uncheck all</button>
        <button v-if="water.loading" type="button" @click="water.cancel">Cancel</button>
        <button v-else type="button" @click="water.refresh()">Refresh water</button>
      </div>
    </div>
    <p>Check a feature to keep it. Uncheck it to hide it from the model and exports.</p>
    <p>Overlapping water remains where another feature covering it is kept.</p>
    <p role="status">{{ water.loading ? 'Fetching water coverage…' : water.reviewing ? 'Checking print scale…' : water.cancelled ? 'Water fetch cancelled. Refresh to try again.' : `${water.includedCount} kept · ${water.review.length} detected` }}</p>
    <p v-if="water.error" role="alert" class="water-review__error">{{ water.error }}</p>
    <p v-for="failure in water.coverageErrors" :key="failure.source" class="water-review__error" role="alert">{{ failure.source }}: {{ failure.message }}</p>
    <p v-if="water.catalog && !water.review.length && !water.loading && !water.reviewing">{{ water.coverageErrors.length ? 'No features returned by the available sources. Coverage is incomplete.' : 'No water found in this crop.' }}</p>
    <p class="water-review__legend">● Kept · ○ Hidden · ▧ Too small to print</p>
    <ul v-if="water.review.length" class="water-review__list" aria-label="Water features">
      <li v-for="item in water.review" :key="item.feature.id">
        <label class="water-review__feature" :class="{ 'water-review__feature--disabled': ['category-disabled', 'covered', 'incomplete', 'outside-crop'].includes(item.status.state) }">
          <input type="checkbox" :aria-label="`Keep ${item.feature.name}`"
            :checked="!['excluded', 'category-disabled', 'covered', 'incomplete', 'outside-crop'].includes(item.status.state)"
            :disabled="['category-disabled', 'covered', 'incomplete', 'outside-crop'].includes(item.status.state)"
            @change="water.setFeatureIncluded(item.feature.id, ($event.target as HTMLInputElement).checked)" />
          <span class="water-review__details"><strong>{{ item.feature.name }}</strong><small>{{ item.feature.category }} · {{ item.feature.source.id }}<template v-if="item.status.exaggerated"> · Exaggerated</template></small>
            <small v-if="item.status.reason">{{ item.status.reason }}</small></span>
          <span class="water-review__state" :class="`water-review__state--${item.status.state}`">{{ statusLabels[item.status.state] }}</span>
        </label>
      </li>
    </ul>
    <p v-for="source in water.catalog?.sources ?? []" :key="`${source.id}-${source.version}`" class="water-review__source">
      <a :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.attribution }}</a> · {{ source.version }}
    </p>
  </section>
</template>
<style scoped>
.water-review { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--tp-border); padding-top: 12px; }
.water-review__header { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
.water-review__actions { display: flex; gap: 8px; }
.water-review__header button { color: var(--tp-text-accent); font-size: 11px; padding: 5px; }
p { margin: 0; font-size: 11px; line-height: 1.5; color: var(--tp-text-secondary); }
.water-review__error { color: #a44216; }
.water-review__list { max-height: 260px; overflow-y: auto; list-style: none; margin: 0; padding: 0; border: 1px solid var(--tp-border); border-radius: 8px; }
.water-review__feature { display: flex; gap: 8px; padding: 10px; align-items: flex-start; cursor: pointer; }
.water-review__feature input { flex: 0 0 auto; width: 16px; height: 16px; margin: 1px 0 0; accent-color: var(--tp-text-accent); cursor: inherit; }
.water-review__details { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.water-review__feature--disabled { opacity: .6; cursor: default; }
.water-review__state { flex: 0 0 auto; max-width: 90px; padding: 3px 6px; border-radius: 4px; background: var(--tp-bg-input); font-size: 10px; color: var(--tp-text-secondary); }
.water-review__state--included { color: #268fbc; }
.water-review__state--too-small, .water-review__state--incomplete { color: #a44216; }
.water-review__list li + li { border-top: 1px solid var(--tp-border); }
.water-review__feature:hover { background: var(--tp-bg-input); }
button:focus-visible, input:focus-visible { outline: 2px solid var(--tp-text-accent); outline-offset: 2px; }
button:disabled { opacity: .6; cursor: default; }
strong { font-size: 12px; } small { display: block; font-size: 10px; line-height: 1.5; color: var(--tp-text-secondary); }
.water-review__source { font-size: 9px; overflow-wrap: anywhere; }
a { color: var(--tp-text-accent); }
</style>
