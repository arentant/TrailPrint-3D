<script setup lang="ts">
import { computed, watch } from "vue";
import { storeToRefs } from "pinia";
import { useConfigStore } from "@/stores/config";
import { useUiStore } from "@/stores/ui";
import { validateMoldKitSection } from "@shared/utils/model-validation";
import AccordionSection from "@/components/ui/AccordionSection.vue";
import IosToggle from "@/components/ui/IosToggle.vue";
import NumberField from "@/components/ui/NumberField.vue";
import SettingLabel from "@/components/ui/SettingLabel.vue";

const configStore = useConfigStore();
const ui = useUiStore();
const { config } = storeToRefs(configStore);
const { openSections } = storeToRefs(ui);

const advancedOpen = computed({
  get: () => Boolean((openSections.value as Record<string, boolean>).moldKitAdvanced),
  set: (v: boolean) => {
    (openSections.value as Record<string, boolean>).moldKitAdvanced = v;
  },
});

const validationError = computed(() => {
  const r = validateMoldKitSection(config.value);
  return r.valid ? null : (r.message ?? "Invalid mold kit settings");
});

watch(
  () =>
    [
      config.value.moldKit.lidSyncWithSkirt,
      config.value.moldKit.skirtHeightMm,
      config.value.moldKit.skirtWidthMm,
    ] as const,
  ([sync, h, w]) => {
    if (!sync) return;
    config.value.moldKit.lidHeightMm = h;
    config.value.moldKit.lidWidthMm = w;
  },
);

function onSkirtHeight(v: number): void {
  config.value.moldKit.skirtHeightMm = v;
  if (config.value.moldKit.lidSyncWithSkirt) {
    config.value.moldKit.lidHeightMm = v;
  }
}

function onSkirtWidth(v: number): void {
  config.value.moldKit.skirtWidthMm = v;
  if (config.value.moldKit.lidSyncWithSkirt) {
    config.value.moldKit.lidWidthMm = v;
  }
}
</script>

<template>
  <AccordionSection
    title="7. Mold kit"
    badge="Optional"
    :open="openSections.moldKit"
    @toggle="ui.toggleSection('moldKit')"
  >
    <p class="hint">
      When enabled, the exported ZIP also includes
      a mold master (terrain and skirt) and casting lid for silicone molds and resin casting,
      named after your GPX file. The original three model parts are included as usual.
    </p>

    <div class="toggle-row">
      <SettingLabel label="Enable mold kit" guide="mold" />
      <IosToggle v-model="config.moldKit.enabled" aria-label="Enable mold kit" />
    </div>

    <template v-if="config.moldKit.enabled">
      <p class="hint">
        Pour resin up to the original base step. The solid skirt catches overflow. Two raised grips on the lid make it easier to handle and weigh down.
      </p>

      <p class="subhead">Overflow skirt</p>
      <div class="row">
        <NumberField
          :model-value="config.moldKit.skirtHeightMm"
          label="Skirt height"
          help="skirtHeight"
          suffix="mm"
          :min="0.2"
          :max="20"
          :step="0.1"
          @update:model-value="onSkirtHeight"
        />
        <NumberField
          :model-value="config.moldKit.skirtWidthMm"
          label="Skirt extension"
          help="skirtWidth"
          suffix="mm"
          :min="0.2"
          :max="30"
          :step="0.1"
          @update:model-value="onSkirtWidth"
        />
      </div>

      <p class="subhead">Casting lid</p>
      <div class="toggle-row toggle-row--compact">
        <SettingLabel label="Match skirt dimensions" guide="sync" />
        <IosToggle v-model="config.moldKit.lidSyncWithSkirt" aria-label="Match skirt dimensions" />
      </div>
      <div class="row">
        <NumberField
          v-model="config.moldKit.lidHeightMm"
          label="Lid height"
          help="lidHeight"
          suffix="mm"
          :min="1"
          :max="20"
          :step="0.1"
          :disabled="config.moldKit.lidSyncWithSkirt"
        />
        <NumberField
          v-model="config.moldKit.lidWidthMm"
          label="Lid extension"
          help="lidWidth"
          suffix="mm"
          :min="0.2"
          :max="30"
          :step="0.1"
          :disabled="config.moldKit.lidSyncWithSkirt"
        />
      </div>

      <button
        type="button"
        class="advanced-toggle"
        @click="advancedOpen = !advancedOpen"
      >
        {{ advancedOpen ? "Hide advanced settings" : "Advanced: fit clearance" }}
      </button>
      <NumberField
        v-if="advancedOpen"
        v-model="config.moldKit.lidClearanceMm"
        label="Lid fit clearance"
        help="lidClearance"
        suffix="mm"
        :min="0"
        :max="2"
        :step="0.05"
      />

      <p v-if="validationError" class="error">{{ validationError }}</p>
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

.subhead {
  margin: 4px 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--tp-text-primary);
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--tp-text-primary);
}

.toggle-row--compact {
  margin-bottom: 8px;
  font-size: 12px;
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 10px;
}

.advanced-toggle {
  display: block;
  margin: 4px 0 10px;
  padding: 0;
  border: none;
  background: none;
  font-size: 12px;
  color: var(--tp-text-secondary);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.error {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: #c0392b;
}
</style>
