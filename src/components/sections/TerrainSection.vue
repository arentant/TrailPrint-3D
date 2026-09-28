<script setup lang="ts">
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
import InfoTooltip from "@/components/ui/InfoTooltip.vue";

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
      suffix="mm"
      :min="0.5"
      :max="20"
      :step="0.5"
    />
    <RangeSlider
      v-model="config.terrain.zExaggeration"
      label="Elevation scale"
      :min="1"
      :max="5"
      :step="0.1"
      :format="(v) => `${v.toFixed(1)}x`"
    />
    <div class="field-group">
      <span class="field-group__label">Mesh quality</span>
      <SegmentedControl
        v-model="config.terrain.meshQuality"
        :options="meshQualityOptions"
      />
      <NumberField
        v-if="isCustomMeshQuality"
        v-model="customMaxGrid"
        label="DEM grid limit per side"
        :min="CUSTOM_MESH_GRID_MIN"
        :max="CUSTOM_MESH_GRID_MAX"
        :step="32"
        suffix="cells"
      />
      <p class="field-hint">{{ meshQualityHint }}</p>
      <p class="field-hint">{{ meshQualityPerfHint }}</p>
    </div>
    <div class="field-group">
      <span class="field-group__label">Terrain smoothing</span>
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
        <InfoTooltip aria-label="About DEM sources" :content="demTooltipText" />
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

</style>
