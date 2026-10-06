<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useConfigStore } from "@/stores/config";
import { useUiStore } from "@/stores/ui";
import { validateTraySection } from "@shared/utils/model-validation";
import AccordionSection from "@/components/ui/AccordionSection.vue";
import NumberField from "@/components/ui/NumberField.vue";
import IosToggle from "@/components/ui/IosToggle.vue";
import SettingLabel from "@/components/ui/SettingLabel.vue";

const configStore = useConfigStore();
const ui = useUiStore();
const { config } = storeToRefs(configStore);
const { openSections } = storeToRefs(ui);

const trayError = computed(() => {
  const v = validateTraySection(config.value, {
    width: ui.previewViewport.w,
    height: ui.previewViewport.h,
  });
  return v.valid ? null : v.message;
});
</script>

<template>
  <AccordionSection
    title="4. Tray base"
    :open="openSections.tray"
    @toggle="ui.toggleSection('tray')"
  >
    <NumberField
      v-model="config.tray.totalThicknessMm"
      label="Total thickness"
      help="trayThickness"
      suffix="mm"
      :min="1"
      :max="50"
      :step="0.5"
    />
    <NumberField
      v-model="config.tray.recessDepthMm"
      label="Recess depth"
      help="recess"
      suffix="mm"
      :min="0"
      :max="49"
      :step="0.5"
    />
    <NumberField
      v-model="config.tray.rimWidthMm"
      label="Rim width"
      help="rim"
      suffix="mm"
      :min="1"
      :max="30"
      :step="0.5"
    />

    <div class="subsection">
      <div class="toggle-row">
        <div class="toggle-copy">
          <SettingLabel class="toggle-label" label="NFC & LED indicators" guide="nfc" />
          <span class="toggle-desc">Add recesses for an NFC chip and LED indicators</span>
        </div>
        <IosToggle v-model="config.tray.nfc.enabled" aria-label="NFC & LED indicators" />
      </div>

      <template v-if="config.tray.nfc.enabled">
        <p class="group-title">NFC chip recess</p>
        <p class="field-hint">
          Add a shallow recess for an NFC chip. It follows the print outline and shares its center.
        </p>
        <NumberField
          v-model="config.tray.nfc.wallClearanceMm"
          label="Inset from print edge"
          help="nfcInset"
          suffix="mm"
          :min="0"
          :max="10"
          :step="0.1"
        />
        <p class="field-hint">
          Distance from the print outline to the NFC recess. For example, a 1mm inset places the recess 1mm inside the outline of a hexagon with 45mm sides.
        </p>
        <NumberField
          v-model="config.tray.nfc.recessDepthMm"
          label="NFC recess depth"
          help="nfcDepth"
          suffix="mm"
          :min="0.1"
          :max="5"
          :step="0.1"
        />
        <p class="field-hint">Depth below the recess surface to accommodate the NFC chip.</p>

        <p class="group-title">LED positions</p>
        <p class="field-hint">
          Add rectangular pockets at the trail start and end for 0805 surface-mount LED indicators.
        </p>
        <div class="row">
          <NumberField
            v-model="config.tray.nfc.ledPocketLengthMm"
            label="LED pocket length"
            help="ledLength"
            suffix="mm"
            :min="0.5"
            :max="20"
            :step="0.1"
          />
          <NumberField
            v-model="config.tray.nfc.ledPocketWidthMm"
            label="LED pocket width"
            help="ledWidth"
            suffix="mm"
            :min="0.5"
            :max="20"
            :step="0.1"
          />
        </div>
        <p class="field-hint">
          The long edge follows the trail. An 0805 LED is about 2.0 × 1.25mm; the default pocket allows extra room for soldering and light.
        </p>
        <NumberField
          v-model="config.tray.nfc.ledExtraRecessDepthMm"
          label="Extra LED depth"
          help="ledDepth"
          suffix="mm"
          :min="0"
          :max="3"
          :step="0.1"
        />
        <p class="field-hint">
          Additional depth below the NFC recess to keep the LED below the surface while allowing light through.
        </p>

        <p class="group-title">Assembly cover</p>
        <p class="field-hint">
          Fit the cover over the NFC chip and LEDs. It follows the terrain outline, with light openings at the trail start and end.
        </p>
        <NumberField
          v-model="config.tray.nfc.coverThicknessMm"
          label="Cover thickness"
          help="coverThickness"
          suffix="mm"
          :min="0.1"
          :max="3"
          :step="0.05"
        />
        <p class="field-hint">
          Includes a cover STL named after your GPX file in the ZIP. The default is 0.2mm; adjust for your printer.
        </p>
        <NumberField
          v-model="config.tray.nfc.coverInsetMm"
          label="Cover inset"
          help="coverInset"
          suffix="mm"
          :min="0"
          :max="5"
          :step="0.1"
        />
        <p class="field-hint">
          Inset from the terrain outline, keeping the same shape and center. The default 0.2mm helps the cover fit into the recess.
        </p>
      </template>
    </div>

    <p v-if="trayError" class="error">{{ trayError }}</p>
  </AccordionSection>
</template>

<style scoped>
.subsection {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 4px;
  padding-top: 14px;
  border-top: 1px solid var(--tp-border);
}

.toggle-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.toggle-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.toggle-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--tp-text-primary);
}

.toggle-desc {
  font-size: 12px;
  line-height: 1.45;
  color: var(--tp-text-secondary);
}

.group-title {
  margin: 6px 0 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--tp-text-primary);
}

.field-hint {
  margin: -4px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--tp-text-secondary);
}

.row {
  display: flex;
  gap: 12px;
}

.row > * {
  flex: 1;
  min-width: 0;
}

.error {
  margin: 0;
  font-size: 12px;
  color: #ff3b30;
}
</style>
