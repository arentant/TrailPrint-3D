<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useConfigStore } from "@/stores/config";
import { useUiStore } from "@/stores/ui";
import AccordionSection from "@/components/ui/AccordionSection.vue";
import IosToggle from "@/components/ui/IosToggle.vue";
import NumberField from "@/components/ui/NumberField.vue";
import SettingLabel from "@/components/ui/SettingLabel.vue";

const configStore = useConfigStore();
const ui = useUiStore();
const { config } = storeToRefs(configStore);
const { openSections } = storeToRefs(ui);
</script>

<template>
  <AccordionSection
    title="6. Paint masks"
    badge="Advanced"
    :open="openSections.sprayPaint"
    @toggle="ui.toggleSection('sprayPaint')"
  >
    <p class="hint">
      When enabled, the ZIP also includes paint mask STLs and
      <code>spray_paint_manifest.json</code>. Use the 3D preview to assign colors and check mask fit.
    </p>

    <div class="toggle-row">
      <SettingLabel label="Enable paint masks" guide="paintMasks" />
      <IosToggle v-model="config.sprayPaint.enabled" aria-label="Enable paint masks" />
    </div>

    <template v-if="config.sprayPaint.enabled">
      <p class="hint">These settings control the shape and fit of exported masks.</p>
      <div class="row">
        <NumberField
          v-model="config.sprayPaint.maskShellThicknessMm"
          label="Mask thickness"
          help="maskThickness"
          suffix="mm"
          :min="0.4"
          :max="3"
          :step="0.1"
        />
        <NumberField
          v-model="config.sprayPaint.maskFitToleranceMm"
          label="Fit clearance"
          help="maskClearance"
          suffix="mm"
          :min="0"
          :max="1"
          :step="0.05"
        />
      </div>
      <NumberField
        v-model="config.sprayPaint.bleedMarginMm"
        label="Edge overlap"
        help="overlap"
        suffix="mm"
        :min="0"
        :max="2"
        :step="0.1"
      />
    </template>
  </AccordionSection>
</template>

<style scoped>
.hint {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--tp-text-secondary);
}

.hint code {
  font-size: 11px;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--tp-text-primary);
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 10px;
}
</style>
