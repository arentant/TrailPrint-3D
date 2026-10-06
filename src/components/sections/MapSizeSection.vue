<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import type { BaseShape } from "@shared/types";
import { maxCornerRadiusMm } from "@shared/utils/rounded-footprint";
import { useConfigStore } from "@/stores/config";
import { useUiStore } from "@/stores/ui";
import AccordionSection from "@/components/ui/AccordionSection.vue";
import SegmentedControl from "@/components/ui/SegmentedControl.vue";
import NumberField from "@/components/ui/NumberField.vue";
import SettingLabel from "@/components/ui/SettingLabel.vue";

const configStore = useConfigStore();
const ui = useUiStore();
const { config } = storeToRefs(configStore);
const { openSections } = storeToRefs(ui);

const shapeOptions: { value: BaseShape; label: string }[] = [
  { value: "circle", label: "Circle" },
  { value: "rectangle", label: "Rectangle" },
  { value: "polygon", label: "Polygon" },
];

const isCircle = computed(() => config.value.mapCrop.shape === "circle");
const isRectangle = computed(() => config.value.mapCrop.shape === "rectangle");
const isPolygon = computed(() => config.value.mapCrop.shape === "polygon");
const showCornerRadius = computed(() => isRectangle.value || isPolygon.value);
const maxCornerRadius = computed(() => maxCornerRadiusMm(config.value.mapCrop));
</script>

<template>
  <AccordionSection
    title="1. Map & size"
    :open="openSections.map"
    @toggle="ui.toggleSection('map')"
  >
    <div class="field-group">
      <SettingLabel class="field-group__label" label="Shape" guide="shape" />
      <SegmentedControl
        v-model="config.mapCrop.shape"
        :options="shapeOptions"
      />
    </div>

    <p class="field-hint">
      The selection stays fixed on the map. Dimensions below set the STL print size. Pan and zoom to position the trail inside the selection.
    </p>

    <div class="row">
      <NumberField
        v-if="isCircle"
        v-model="config.mapCrop.radiusMm"
        label="Print radius"
        help="radius"
        suffix="mm"
        :min="10"
        :max="500"
      />
      <template v-if="isRectangle">
        <NumberField
          v-model="config.mapCrop.lengthMm"
          label="Print length"
          help="length"
          suffix="mm"
          :min="10"
          :max="500"
        />
        <NumberField
          v-model="config.mapCrop.widthMm"
          label="Print width"
          help="width"
          suffix="mm"
          :min="10"
          :max="500"
        />
      </template>
      <template v-if="isPolygon">
        <NumberField
          v-model="config.mapCrop.polygonSides"
          label="Sides"
          help="sides"
          :min="3"
          :max="8"
          :step="1"
        />
        <NumberField
          v-model="config.mapCrop.polygonSideLengthMm"
          label="Side length"
          help="sideLength"
          suffix="mm"
          :min="10"
          :max="300"
        />
      </template>
    </div>

    <div v-if="showCornerRadius" class="row">
      <NumberField
        v-model="config.mapCrop.cornerRadiusMm"
        label="Corner radius"
        help="corner"
        suffix="mm"
        :min="0"
        :max="maxCornerRadius"
        :step="0.5"
      />
    </div>
  </AccordionSection>
</template>

<style scoped>
.field-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-group__label {
  font-size: 12px;
  color: var(--tp-text-secondary);
}

.field-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--tp-text-secondary);
}

.row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.row > * {
  flex: 1;
  min-width: 120px;
}
</style>
