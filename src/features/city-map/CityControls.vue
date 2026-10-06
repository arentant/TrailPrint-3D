<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useCityStore } from '@/stores/city';
import { useUiStore } from '@/stores/ui';
import NumberField from '@/components/ui/NumberField.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import CheckboxField from '@/components/ui/CheckboxField.vue';
import SettingLabel from '@/components/ui/SettingLabel.vue';
import SettingHelp from '@/components/ui/SettingHelp.vue';
import OpenTopoApiKeyCard from '@/components/sections/OpenTopoApiKeyCard.vue';
import CityTrailControls from './CityTrailControls.vue';
import { OPEN_TOPO_DEM_OPTIONS, openTopoDemTooltipText } from '@shared/types/dem';
import { maxCornerRadiusMm } from '@shared/utils/rounded-footprint';
const { config } = storeToRefs(useCityStore());
const ui = useUiStore();
const maxCorner = computed(() => maxCornerRadiusMm(config.value.mapCrop));
const demTooltipText = openTopoDemTooltipText();
</script>
<template>
  <fieldset :disabled="ui.generating" class="city-controls">
    <section aria-labelledby="city-size">
      <h2 id="city-size">1. Map & size</h2>
      <SettingLabel class="select-label" label="Shape" guide="shape" />
      <SegmentedControl v-model="config.mapCrop.shape" :options="[{value:'circle',label:'Circle'},{value:'rectangle',label:'Rectangle'},{value:'polygon',label:'Polygon'}]" />
      <div class="row">
        <NumberField v-if="config.mapCrop.shape === 'circle'" v-model="config.mapCrop.radiusMm" label="Print radius" help="radius" suffix="mm" :min="10" :max="500" />
        <template v-if="config.mapCrop.shape === 'rectangle'">
          <NumberField v-model="config.mapCrop.lengthMm" label="Print length" help="length" suffix="mm" :min="10" :max="500" />
          <NumberField v-model="config.mapCrop.widthMm" label="Print width" help="width" suffix="mm" :min="10" :max="500" />
        </template>
        <template v-if="config.mapCrop.shape === 'polygon'">
          <NumberField v-model="config.mapCrop.polygonSides" label="Sides" help="sides" :min="3" :max="8" :step="1" />
          <NumberField v-model="config.mapCrop.polygonSideLengthMm" label="Side length" help="sideLength" suffix="mm" :min="10" :max="300" />
        </template>
      </div>
      <NumberField v-if="config.mapCrop.shape !== 'circle'" v-model="config.mapCrop.cornerRadiusMm" label="Corner radius" help="corner" suffix="mm" :min="0" :max="maxCorner" :step="0.5" />
      <p>Pan, zoom and Option/Alt-drag to frame your run. Dimensions set the print size.</p>
    </section>
    <section aria-labelledby="city-surface">
      <h2 id="city-surface">2. Surface</h2>
      <SettingLabel class="select-label" label="Surface" guide="surface" />
      <SegmentedControl v-model="config.city.surface" :options="[{value:'flat',label:'Flat'},{value:'real',label:'Real terrain'}]" />
      <p v-if="config.city.surface === 'flat'">A level city base. No elevation key needed.</p>
      <template v-else>
        <OpenTopoApiKeyCard />
        <div class="select-label">
          <span class="select-label__head"><label for="city-dataset">Terrain dataset</label><SettingHelp guide="dataset" :content="demTooltipText" /></span>
          <select id="city-dataset" v-model="config.terrain.demDataset"><option v-for="option in OPEN_TOPO_DEM_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option></select>
        </div>
        <NumberField v-model="config.terrain.zExaggeration" label="Elevation exaggeration" help="elevation" suffix="×" :min="0.1" :max="10" />
        <div class="select-label">
          <span class="select-label__head"><label for="city-smoothing">Terrain smoothing</label><SettingHelp guide="smoothing" /></span>
          <select id="city-smoothing" v-model="config.terrain.smoothing"><option value="raw">Raw</option><option value="light">Light</option><option value="medium">Medium</option><option value="heavy">Heavy</option></select>
        </div>
        <div class="select-label">
          <span class="select-label__head"><label for="city-quality">Mesh quality</label><SettingHelp guide="quality" /></span>
          <select id="city-quality" v-model="config.terrain.meshQuality"><option value="standard">Standard</option><option value="high">High</option><option value="ultra">Ultra</option><option value="extreme">Extreme</option><option value="custom">Custom</option></select>
        </div>
        <NumberField v-if="config.terrain.meshQuality === 'custom'" v-model="config.terrain.meshQualityCustom.maxGrid" label="DEM grid limit" help="grid" :min="64" :max="512" :step="32" />
      </template>
      <NumberField v-model="config.terrain.baseSolidThicknessMm" label="Base thickness" help="base" suffix="mm" :min="1" :max="20" :step="0.5" />
    </section>
    <section aria-labelledby="city-features">
      <h2 id="city-features">3. City layers</h2>
      <CheckboxField v-model="config.city.buildingsVisible" label="Show buildings" help="buildings" />
      <NumberField v-if="config.city.buildingsVisible" v-model="config.city.buildingHeightExaggeration" label="Building height exaggeration" help="buildingHeight" suffix="×" :min="0.1" :max="10" />
      <p v-if="config.city.buildingsVisible">Flat roofs. Mapped height → levels × 3 m → 8 m fallback.</p>
      <CheckboxField v-model="config.city.roadsVisible" label="Show roads & footpaths" help="roads" />
      <NumberField v-if="config.city.roadsVisible" v-model="config.city.roadReliefMm" label="Raised roads" help="roadRelief" suffix="mm" :min="0.1" :max="3" />
    </section>
    <section aria-labelledby="city-route">
      <h2 id="city-route">4. Running route</h2>
      <CityTrailControls v-model="config.city" :base-thickness="config.terrain.baseSolidThicknessMm" />
      <p>Your GPX stays in place. Buildings and roads leave clearance for the route insert.</p>
    </section>
  </fieldset>
</template>
<style scoped>
.city-controls { border: 0; padding: 0; margin: 0; min-width: 0; display: flex; flex-direction: column; gap: 16px; }
section { display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: 12px; background: var(--tp-bg-panel); box-shadow: var(--tp-shadow-panel); }
h2 { font-size: 15px; margin: 0; }
p { font-size: 11px; line-height: 1.5; color: var(--tp-text-secondary); margin: 0; }
.row { display: flex; gap: 12px; }
.select-label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--tp-text-secondary); }
.select-label__head { display: flex; align-items: center; gap: 6px; }
.setting-label.select-label { flex-direction: row; }
select { padding: 10px; border: 1px solid var(--tp-border-strong); border-radius: 8px; background: var(--tp-bg-input); color: var(--tp-text-primary); width: 100%; }
</style>
