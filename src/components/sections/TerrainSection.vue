<script setup lang="ts">
import WaterReview from './WaterReview.vue';
import ModelFeatureControls from './ModelFeatureControls.vue';
import { computed } from "vue";
import { storeToRefs } from "pinia";
import type { TerrainMeshQuality, TerrainSmoothing } from "@shared/types";
import {
  CUSTOM_MESH_GRID_MAX,
  CUSTOM_MESH_GRID_MIN,
  demSampleCount,
  meshQualitySummary,
  normalizeMeshQualityCustom,
} from "@shared/utils/terrain-mesh-quality";
import {
  OPEN_TOPO_DEM_OPTIONS,
  openTopoDemTooltipText,
} from "@shared/types/dem";
import { useConfigStore } from "@/stores/config";
import { useUiStore } from "@/stores/ui";
import AccordionSection from "@/components/ui/AccordionSection.vue";
import SegmentedControl from "@/components/ui/SegmentedControl.vue";
import NumberField from "@/components/ui/NumberField.vue";
import RangeSlider from "@/components/ui/RangeSlider.vue";
import SettingHelp from "@/components/ui/SettingHelp.vue";
import SettingLabel from "@/components/ui/SettingLabel.vue";
import IosToggle from "@/components/ui/IosToggle.vue";

const demTooltipText = openTopoDemTooltipText();

const configStore = useConfigStore();
const ui = useUiStore();
const { config } = storeToRefs(configStore);
const { openSections } = storeToRefs(ui);

const meshQualityOptions: { value: TerrainMeshQuality; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "high", label: "High" },
  { value: "ultra", label: "Ultra" },
  { value: "extreme", label: "Extreme" },
  { value: "studio", label: "Studio" },
  { value: "custom", label: "Custom" },
];

const meshQualityParams = computed(() => ({
  meshQuality: config.value.terrain.meshQuality,
  meshQualityCustom: config.value.terrain.meshQualityCustom,
}));

const isCustomMeshQuality = computed(
  () => config.value.terrain.meshQuality === "custom",
);

const customMaxGrid = computed({
  get: () => config.value.terrain.meshQualityCustom.maxGrid,
  set: (v: number) => {
    config.value.terrain.meshQualityCustom = normalizeMeshQualityCustom({
      maxGrid: v,
    });
  },
});

const meshQualityHint = computed(() =>
  meshQualitySummary(config.value.mapCrop, meshQualityParams.value),
);

const meshQualityPerfHint = computed(() => {
  const n = demSampleCount(config.value.mapCrop, meshQualityParams.value);
  const q = config.value.terrain.meshQuality;
  const sampleLabel =
    n >= 1_000_000
      ? `Approx. ${(n / 1e6).toFixed(1)}M`
      : `Approx. ${Math.round(n / 1000)}k`;
  if (q === "custom") {
    const heavy =
      n >= 800_000 ? "; requires about 8 GB or more of available memory" : "";
    return `${sampleLabel} elevation samples${heavy}. Regenerate terrain after changing the limit. COP30 is recommended.`;
  }
  if (q === "studio" && n >= 800_000) {
    return `${sampleLabel} elevation samples; STL files may be large. Use 16 GB or more of RAM, COP30, and Raw smoothing.`;
  }
  if (q === "extreme") {
    return `${sampleLabel} samples; generation may take longer. Use COP30 (30m) with Raw or Light smoothing.`;
  }
  return "Higher quality takes longer to generate and export. The source DEM resolution (such as COP30 at 30m) limits terrain detail.";
});

const smoothingOptions: { value: TerrainSmoothing; label: string }[] = [
  { value: "raw", label: "Raw" },
  { value: "light", label: "Light" },
  { value: "medium", label: "Medium" },
  { value: "heavy", label: "Heavy" },
];

const demOptions = OPEN_TOPO_DEM_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
}));

const demHint = computed(() => {
  const found = OPEN_TOPO_DEM_OPTIONS.find(
    (o) => o.value === config.value.terrain.demDataset,
  );
  return found?.hint ?? "";
});

</script>

<template>
  <AccordionSection
    title="2. Terrain"
    :open="openSections.terrain"
    @toggle="ui.toggleSection('terrain')"
  >
    <NumberField
      v-model="config.terrain.baseSolidThicknessMm"
      label="Base thickness"
      help="base"
      suffix="mm"
      :min="0.5"
      :max="20"
      :step="0.5"
    />
    <RangeSlider
      v-model="config.terrain.zExaggeration"
      label="Elevation scale"
      help="elevation"
      :min="1"
      :max="5"
      :step="0.1"
      :format="(v) => `${v.toFixed(1)}x`"
    />
    <div class="field-group">
      <SettingLabel class="field-group__label" label="Mesh quality" guide="quality" />
      <SegmentedControl
        v-model="config.terrain.meshQuality"
        :options="meshQualityOptions"
      />
      <NumberField
        v-if="isCustomMeshQuality"
        v-model="customMaxGrid"
        label="DEM grid limit per side"
        help="grid"
        :min="CUSTOM_MESH_GRID_MIN"
        :max="CUSTOM_MESH_GRID_MAX"
        :step="32"
        suffix="cells"
      />
      <p class="field-hint">{{ meshQualityHint }}</p>
      <p class="field-hint">{{ meshQualityPerfHint }}</p>
    </div>
    <div class="field-group">
      <SettingLabel class="field-group__label" label="Terrain smoothing" guide="smoothing" />
      <SegmentedControl
        v-model="config.terrain.smoothing"
        :options="smoothingOptions"
      />
    </div>

    <div class="field-group">
      <div class="field-group__label-row">
        <label class="field-group__label" for="dem-dataset"
          >DEM source (OpenTopography)</label
        >
        <SettingHelp guide="dataset" :content="demTooltipText" />
      </div>
      <select
        id="dem-dataset"
        v-model="config.terrain.demDataset"
        class="text-input"
      >
        <option v-for="opt in demOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <p v-if="demHint" class="field-hint">{{ demHint }}</p>
    </div>
    <div class="field-group">
      <label class="field-group__label" for="model-print-mode">Print mode</label>
      <select id="model-print-mode" v-model="config.printMode" class="text-input">
        <option value="separate">Separate inserts · fit and glue</option>
        <option value="fused">Fused multicolor · 3MF</option>
      </select>
      <p class="field-hint">{{ config.printMode === 'fused' ? 'Touching terrain, trail and water volumes with no assembly gaps. Export the complete 3MF for multiple filaments.' : 'Print each part on the bed, then assemble. Test a clearance coupon before printing the full model.' }}</p>
    </div>
    <ModelFeatureControls />
    <div class="water-settings">
      <div class="water-settings__heading">
        <span>Include water</span>
        <IosToggle v-model="config.water.enabled" aria-label="Include water" />
      </div>
      <p class="field-hint">Review lakes, rivers and seas on the map before generating terrain. Choose separate inserts or fused multicolor printing.</p>
      <template v-if="config.water.enabled">
        <fieldset class="water-categories"><legend>Water categories</legend>
          <label v-for="category in (['lake', 'reservoir', 'river', 'sea'] as const)" :key="category">
            <input v-model="config.water.categories" type="checkbox" :value="category" />{{ category }}
          </label>
        </fieldset>
        <NumberField v-model="config.water.minimumAreaMm2" label="Minimum water area" suffix="mm²" :min="0.16" :max="100" :step="0.1" />
        <NumberField v-model="config.water.minimumWidthMm" label="Minimum printable width" suffix="mm" :min="0.4" :max="5" :step="0.1" />
        <NumberField v-model="config.water.riverWidthMultiplier" label="River width multiplier" suffix="×" :min="0.1" :max="20" :step="0.1" />
        <NumberField v-model="config.water.minimumRiverWidthMm" label="Minimum printed river width" suffix="mm" :min="0.4" :max="20" :step="0.1" />
        <label class="water-color">Water color<input v-model="config.colors.water" type="color" aria-label="Water color picker" /></label>
        <p class="field-hint">Widened rivers are marked Exaggerated. HydroLAKES supplements large lakes (10 ha and larger); smaller water relies on OSM.</p>
        <div class="water-settings__row">
          <NumberField v-model="config.water.thicknessMm" label="Water thickness" suffix="mm" :min="0.4" :max="5" :step="0.1" />
          <NumberField v-model="config.water.clearanceMm" label="Fitting clearance" suffix="mm" :min="0" :max="1" :step="0.05" />
        </div>
        <p class="field-hint">Clearance reduces the insert by this amount on each side of its outline, including island edges. Use less for a closer fit or more for easier placement and glue. The terrain base needs at least {{ (config.water.thicknessMm + 0.4).toFixed(1) }} mm.</p>
        <p class="field-hint">Choose which detected features to keep below, or click their outlines on the map. Hidden water stays out of the preview and export. A 0.6 mm terrain border protects the crop edge.</p>
        <WaterReview />
        <p class="field-hint">Water outlines: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>.</p>
      </template>
    </div>
  </AccordionSection>
</template>

<style scoped>
.field-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-group__label-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.field-group__label {
  font-size: 12px;
  color: var(--tp-text-secondary);
}

.text-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--tp-border, #d0d0d0);
  border-radius: 8px;
  font-size: 13px;
  background: var(--tp-bg-input, #fff);
  color: var(--tp-text-primary, #1a1a1a);
}

.field-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--tp-text-secondary);
}

.water-settings { display: flex; flex-direction: column; gap: 10px; padding-top: 16px; border-top: 1px solid var(--tp-border); }
.water-settings__heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; font-weight: 600; }
.water-settings__row { display: flex; gap: 12px; }
.water-categories { display: flex; flex-wrap: wrap; gap: 10px; border: 0; padding: 0; font-size: 12px; }
.water-categories legend { margin-bottom: 8px; }
.water-categories label { display: flex; gap: 5px; align-items: center; text-transform: capitalize; }
.water-color { display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
.water-settings a { color: var(--tp-text-accent); }

</style>
