<script setup lang="ts" generic="T extends string">
defineProps<{
  modelValue: T
  options: { value: T; label: string }[]
  darkActive?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
</script>

<template>
  <div class="segmented" :class="{ 'segmented--many': options.length > 4 }" role="group">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="segmented__item"
      :aria-pressed="modelValue === opt.value"
      :class="{
        'segmented__item--active': modelValue === opt.value,
        'segmented__item--dark': darkActive && modelValue === opt.value
      }"
      @click="emit('update:modelValue', opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 3px;
  background: var(--tp-bg-segment);
  border-radius: var(--tp-radius-control);
  min-height: 36px;
}

.segmented__item {
  flex: 1 1 64px;
  min-width: 0;
  min-height: 30px;
  padding: 0 6px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--tp-text-secondary);
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
}

.segmented--many {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.segmented__item--active {
  background: #fff;
  color: var(--tp-text-primary);
  font-weight: 600;
  box-shadow: var(--tp-shadow-segment);
}

.segmented__item--dark.segmented__item--active {
  background: var(--tp-cta);
  color: #fff;
}
</style>
