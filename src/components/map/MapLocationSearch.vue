<script setup lang="ts">
import { onUnmounted, ref, useId, watch } from 'vue';
import { parseMapCoordinates, searchMapPlaces, type MapPlace } from '@/utils/place-search';

defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ select: [place: MapPlace] }>();
const inputId = useId();
const query = ref('');
const results = ref<MapPlace[]>([]);
const busy = ref(false);
const message = ref('');
let pending: AbortController | undefined;

function clearSearch(): void {
  pending?.abort();
  pending = undefined;
  busy.value = false;
  results.value = [];
  message.value = '';
}
watch(query, clearSearch, { flush: 'sync' });
onUnmounted(clearSearch);

function select(place: MapPlace): void {
  clearSearch();
  emit('select', place);
  message.value = `Shape moved to ${place.label}.`;
}

async function search(): Promise<void> {
  if (!query.value.trim() || busy.value) return;
  clearSearch();
  try {
    const coordinates = parseMapCoordinates(query.value);
    if (coordinates) { select(coordinates); return; }
  } catch (error) {
    message.value = (error as Error).message;
    return;
  }
  const controller = new AbortController();
  pending = controller;
  busy.value = true;
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const places = await searchMapPlaces(query.value, controller.signal);
    if (pending !== controller) return;
    results.value = places;
    message.value = places.length ? 'Choose a result to move the shape there.' : 'No places found. Try a nearby city or latitude, longitude.';
  } catch {
    if (pending === controller) message.value = 'Place search is unavailable. Try again or enter latitude, longitude.';
  } finally {
    clearTimeout(timeout);
    if (pending === controller) { pending = undefined; busy.value = false; }
  }
}
</script>

<template>
  <form class="location-search" role="search" aria-label="Find a place" @submit.prevent="search" @keydown.esc="clearSearch">
    <label :for="inputId">Go to a place</label>
    <div class="location-search__input">
      <input :id="inputId" v-model="query" type="search" placeholder="Place or latitude, longitude" autocomplete="off" :disabled="disabled" maxlength="200" />
      <button type="submit" :disabled="disabled || busy || !query.trim()" aria-label="Search places">{{ busy ? '…' : 'Go' }}</button>
    </div>
    <p class="location-search__hint">Search a place or paste coordinates to move the shape there.</p>
    <p v-if="message" class="location-search__message" role="status">{{ message }}</p>
    <ul v-if="results.length" class="location-search__results" aria-label="Places">
      <li v-for="(place, index) in results" :key="index"><button type="button" :disabled="disabled" @click="select(place)">{{ place.label }}</button></li>
    </ul>
    <small>Search by <a href="https://open-meteo.com/en/docs/geocoding-api" target="_blank" rel="noopener noreferrer">Open-Meteo</a> · <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">GeoNames</a></small>
  </form>
</template>

<style scoped>
.location-search { padding: 10px 12px; border: 1px solid rgba(0, 0, 0, .08); border-radius: 10px; background: rgba(255, 255, 255, .96); box-shadow: 0 2px 10px rgba(0, 0, 0, .12); color: var(--tp-text-primary); }
label { display: block; margin-bottom: 8px; font-size: 12px; font-weight: 600; }
.location-search__input { display: flex; gap: 6px; }
input { width: 100%; min-width: 0; padding: 8px; border: 1px solid var(--tp-border-strong); border-radius: 6px; background: var(--tp-bg-input); color: inherit; font-size: 11px; }
button { padding: 8px; border-radius: 6px; background: var(--tp-bg-input); color: inherit; font-size: 11px; cursor: pointer; }
button[type=submit] { background: var(--tp-text-accent); color: white; font-weight: 600; }
button:disabled, input:disabled { opacity: .45; cursor: default; }
input:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--tp-text-accent); outline-offset: 2px; }
p { margin: 8px 0 0; font-size: 11px; line-height: 1.45; }
.location-search__hint, small { color: var(--tp-text-secondary); }
.location-search__results { display: grid; gap: 4px; list-style: none; padding: 0; margin: 8px 0; max-height: 190px; overflow-y: auto; }
.location-search__results button { width: 100%; text-align: left; line-height: 1.45; }
.location-search__results button:hover { background: var(--tp-bg-page); }
small { display: block; margin-top: 8px; font-size: 9px; }
a { color: inherit; }
</style>
