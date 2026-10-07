<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useConfigStore } from '@/stores/config'
import { useUiStore } from '@/stores/ui'
import { trayMagnetHoleCount } from '@shared/utils/magnet-hole-layout'
import { validateAssemblySection } from '@shared/utils/model-validation'
import { computeTrayFootprint } from '@shared/utils/tray-footprint'
import AccordionSection from '@/components/ui/AccordionSection.vue'
import IosToggle from '@/components/ui/IosToggle.vue'
import NumberField from '@/components/ui/NumberField.vue'
import SettingLabel from '@/components/ui/SettingLabel.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import type { MagnetHoleShape } from '@shared/types/config'

const configStore = useConfigStore()
const ui = useUiStore()
const { config } = storeToRefs(configStore)
const { openSections } = storeToRefs(ui)
const magnetShapes: { value: MagnetHoleShape; label: string }[] = [
  { value: 'circle', label: 'Round' }, { value: 'rectangle', label: 'Rectangle' }, { value: 'hexagon', label: 'Hexagon' },
]

const trayFootprint = computed(() => computeTrayFootprint(config.value))

const magnetHoleCountHint = computed(() => {
  const footprint = trayFootprint.value
  const n = trayMagnetHoleCount(config.value, footprint)
  if (footprint.shape === 'circle') {
    return `The circular tray will have ${n} evenly spaced magnet holes on its underside.`
  }
  if (footprint.shape === 'polygon') {
    return `The ${footprint.polygonSides ?? footprint.outer.length}-sided tray will have one hole at each corner on its underside (${n} total).`
  }
  return 'The rectangular tray will have one magnet hole at each corner on its underside (4 total).'
})

const showCircleMagnetCount = computed(
  () =>
    config.value.assembly.magnet.enabled &&
    trayFootprint.value.shape === 'circle',
)

const assemblyError = computed(() => {
  const v = validateAssemblySection(config.value)
  return v.valid ? null : v.message
})
</script>

<template>
  <AccordionSection
    title="5. Assembly & magnets"
    badge="Advanced"
    :open="openSections.assembly"
    @toggle="ui.toggleSection('assembly')"
  >
    <p class="hint">
      Groove clearance widens the terrain groove for easier fitting. The exported trail keeps the width set in Trail settings.
    </p>
    <div class="row">
      <NumberField
        v-model="config.assembly.trailToleranceMm"
        label="Trail groove clearance"
        help="trailClearance"
        suffix="mm"
        :min="0"
        :max="1"
        :step="0.01"
      />
      <NumberField
        v-model="config.assembly.trayToleranceMm"
        label="Base recess clearance"
        help="trayClearance"
        suffix="mm"
        :min="0"
        :max="1"
        :step="0.01"
      />
    </div>

    <div class="toggle-row">
      <SettingLabel label="Underside magnet holes" guide="magnets" />
      <IosToggle v-model="config.assembly.magnet.enabled" aria-label="Underside magnet holes" />
    </div>

    <template v-if="config.assembly.magnet.enabled">
      <p class="hint">
        Choose the pocket shape to match your magnet. Dimensions are in millimeters; clearance adds space around the magnet and increases the pocket depth.
      </p>
      <SettingLabel label="Magnet hole shape" guide="magnetShape" />
      <SegmentedControl v-model="config.assembly.magnet.shape" :options="magnetShapes" aria-label="Magnet hole shape" />
      <div class="row">
        <template v-if="config.assembly.magnet.shape === 'rectangle'">
          <NumberField v-model="config.assembly.magnet.lengthMm" label="Magnet length" help="magnetLength" suffix="mm" :min="1" :max="30" :step="0.5" />
          <NumberField v-model="config.assembly.magnet.widthMm" label="Magnet width" help="magnetWidth" suffix="mm" :min="1" :max="30" :step="0.5" />
        </template>
        <NumberField
          v-else
          v-model="config.assembly.magnet.diameterMm"
          :label="config.assembly.magnet.shape === 'hexagon' ? 'Magnet width across flats' : 'Magnet diameter'"
          :help="config.assembly.magnet.shape === 'hexagon' ? 'magnetAcrossFlats' : 'magnetDiameter'"
          suffix="mm"
          :min="2"
          :max="20"
          :step="0.5"
        />
        <NumberField
          v-model="config.assembly.magnet.thicknessMm"
          label="Magnet thickness"
          help="magnetThickness"
          suffix="mm"
          :min="0.5"
          :max="10"
          :step="0.5"
        />
      </div>
      <NumberField
        v-model="config.assembly.magnet.toleranceMm"
        label="Magnet hole clearance"
        help="magnetClearance"
        suffix="mm"
        :min="0"
        :max="0.5"
        :step="0.01"
      />
      <NumberField
        v-if="showCircleMagnetCount"
        v-model="config.assembly.magnet.circleCount"
        label="Magnet hole count"
        help="magnetCount"
        :min="2"
        :max="12"
        :step="1"
      />
      <p class="hint">{{ magnetHoleCountHint }}</p>
    </template>
    <p v-if="assemblyError" class="error">{{ assemblyError }}</p>
  </AccordionSection>
</template>

<style scoped>
.row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.row > * {
  flex: 1;
  min-width: 120px;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}

.hint {
  font-size: 12px;
  color: var(--tp-text-secondary);
  margin: 0;
}

.error {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: #e5484d;
}
</style>
