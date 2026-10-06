<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useConfigStore } from '@/stores/config'
import { useUiStore } from '@/stores/ui'
import AccordionSection from '@/components/ui/AccordionSection.vue'
import IosToggle from '@/components/ui/IosToggle.vue'
import NumberField from '@/components/ui/NumberField.vue'
import SettingLabel from '@/components/ui/SettingLabel.vue'
import { useStlExport } from '@/composables/useStlExport'

const configStore = useConfigStore()
const ui = useUiStore()
const { config } = storeToRefs(configStore)
const { openSections } = storeToRefs(ui)
const { downloadTrail, generating } = useStlExport()

/** 兼容旧版 assembly.trailProtrusionMm */
const trailHeightAboveMain = computed({
  get: () => {
    const t = config.value.trail
    if (t.heightAboveMainMm != null) return t.heightAboveMainMm
    const legacy = (config.value.assembly as { trailProtrusionMm?: number })
      .trailProtrusionMm
    return legacy ?? 0.12
  },
  set: (v: number) => {
    config.value.trail.heightAboveMainMm = v
  },
})
</script>

<template>
  <AccordionSection
    title="3. Trail settings"
    :open="openSections.trail"
    @toggle="ui.toggleSection('trail')"
  >
    <div class="toggle-row">
      <SettingLabel label="Reduce noise and smooth the trail" guide="simplify" />
      <IosToggle v-model="config.trail.gpxSimplify" aria-label="Reduce noise and smooth the trail" />
    </div>
    <div class="row">
      <NumberField
        v-model="config.trail.trailWidthMm"
        label="Trail width"
        help="trailWidth"
        suffix="mm"
        :min="0.5"
         :max="20"
        :step="0.1"
      />
      <NumberField
        v-model="config.trail.trailDepthMm"
        label="Trail depth"
        help="trailDepth"
        suffix="mm"
        :min="0.1"
        :max="10"
        :step="0.1"
      />
    </div>
    <NumberField
      v-model="trailHeightAboveMain"
      label="Height above terrain"
      help="trailHeight"
      suffix="mm"
      :min="0"
      :max="3"
      :step="0.01"
    />
    <p class="hint">
      Raise the trail above the terrain by this amount so it remains slightly visible when fitted into the groove.
    </p>
    <button
      type="button"
      class="trail-download"
      :disabled="!config.gpx.imported || generating"
      @click="downloadTrail"
    >
      Download trail STL
    </button>
    <p class="hint">Save just the trail using the current map framing and terrain height.</p>
  </AccordionSection>
</template>

<style scoped>
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
}

.row {
  display: flex;
  gap: 12px;
}
.hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--color-text-secondary, #888);
}

.trail-download {
  width: 100%;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--tp-border-strong);
  border-radius: 8px;
  background: var(--tp-bg-panel);
  color: var(--tp-text-accent);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.trail-download:hover:not(:disabled) {
  background: var(--tp-bg-input);
}

.trail-download:focus-visible {
  outline: 2px solid var(--tp-text-accent);
  outline-offset: 3px;
}

.trail-download:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
