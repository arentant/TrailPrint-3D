<script setup lang="ts">
import { computed, watch } from "vue";
import { storeToRefs } from "pinia";
import { useConfigStore } from "@/stores/config";
import { useUiStore } from "@/stores/ui";
import { validateMoldKitSection } from "@shared/utils/model-validation";
import AccordionSection from "@/components/ui/AccordionSection.vue";
import IosToggle from "@/components/ui/IosToggle.vue";
import NumberField from "@/components/ui/NumberField.vue";

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
  return r.valid ? null : (r.message ?? "翻模套件参数无效");
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
    title="7. 翻模套件"
    badge="可选"
    :open="openSections.moldKit"
    @toggle="ui.toggleSection('moldKit')"
  >
    <p class="hint">
      启用后导出 ZIP 将额外包含
      <code>Mold_Master.stl</code>（山体+裙边）与
      <code>Mold_Lid.stl</code>（浇注盖板），用于硅胶翻模与滴胶压平。不影响原有三件套。
    </p>

    <div class="toggle-row">
      <span>启用翻模套件</span>
      <IosToggle v-model="config.moldKit.enabled" />
    </div>

    <template v-if="config.moldKit.enabled">
      <p class="hint">
        滴胶浇至原基础底面台阶；裙边为实心底板，外圈用于容纳飞边。盖板顶面带双凸台，便于拿取与压重。
      </p>

      <p class="subhead">裙边溢料层</p>
      <div class="row">
        <NumberField
          :model-value="config.moldKit.skirtHeightMm"
          label="裙边高度"
          suffix="mm"
          :min="0.2"
          :max="20"
          :step="0.1"
          @update:model-value="onSkirtHeight"
        />
        <NumberField
          :model-value="config.moldKit.skirtWidthMm"
          label="裙边外扩"
          suffix="mm"
          :min="0.2"
          :max="30"
          :step="0.1"
          @update:model-value="onSkirtWidth"
        />
      </div>

      <p class="subhead">浇注盖板</p>
      <div class="toggle-row toggle-row--compact">
        <span>与裙边同步</span>
        <IosToggle v-model="config.moldKit.lidSyncWithSkirt" />
      </div>
      <div class="row">
        <NumberField
          v-model="config.moldKit.lidHeightMm"
          label="盖板高度"
          suffix="mm"
          :min="1"
          :max="20"
          :step="0.1"
          :disabled="config.moldKit.lidSyncWithSkirt"
        />
        <NumberField
          v-model="config.moldKit.lidWidthMm"
          label="盖板外扩"
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
        {{ advancedOpen ? "收起高级" : "高级：配合间隙" }}
      </button>
      <NumberField
        v-if="advancedOpen"
        v-model="config.moldKit.lidClearanceMm"
        label="盖板配合间隙"
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
