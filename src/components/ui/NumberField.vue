<script setup lang="ts">
import { useId } from 'vue'
import SettingHelp from './SettingHelp.vue'
import type { SettingGuideId } from './setting-guides'

defineProps<{
  modelValue: number
  label?: string
  suffix?: string
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  help?: SettingGuideId
}>()

const inputId = `number-${useId()}`

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

function onInput(e: Event): void {
  const raw = (e.target as HTMLInputElement).value
  const n = parseFloat(raw)
  if (!Number.isNaN(n)) emit('update:modelValue', n)
}
</script>

<template>
  <div class="field">
    <div v-if="label" class="field__label-row">
      <label :for="inputId" class="field__label" :class="{ 'field--disabled': disabled }">{{ label }}</label>
      <SettingHelp v-if="help" :guide="help" />
    </div>
    <span class="field__input-wrap">
      <input
        :id="inputId"
        type="number"
        class="field__input"
        :value="modelValue"
        :min="min"
        :max="max"
        :step="step ?? 0.1"
        :disabled="disabled"
        @input="onInput"
      />
      <span v-if="suffix" class="field__suffix">{{ suffix }}</span>
    </span>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.field--disabled {
  opacity: 0.45;
}

.field__label-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 24px;
}

.field__input-wrap:has(input:disabled) { opacity: 0.45; }

.field__label {
  font-size: 12px;
  color: var(--tp-text-secondary);
}

.field__input-wrap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 12px;
  background: var(--tp-bg-input);
  border-radius: var(--tp-radius-control);
}

.field__input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 15px;
  font-weight: 500;
  color: var(--tp-text-primary);
  outline: none;
  min-width: 0;
}

.field__input:focus {
  outline: none;
}

.field__suffix {
  font-size: 13px;
  color: var(--tp-text-secondary);
  margin-left: 8px;
  flex-shrink: 0;
}
</style>
