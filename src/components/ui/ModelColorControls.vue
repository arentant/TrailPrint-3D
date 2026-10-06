<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import { createDefaultModelColors, isHexColor, type ModelColors } from '@shared/types/model-colors';

const colors = defineModel<ModelColors>({ required: true });
const props = withDefaults(defineProps<{
  workspace?: 'mountain' | 'city';
  showTray?: boolean;
  disabled?: boolean;
}>(), { workspace: 'mountain', showTray: true });
const id = useId();
const draft = ref<ModelColors>({ ...colors.value });
const pending = ref(false);
const applyDelayMs = 1000;
let applyTimer: ReturnType<typeof setTimeout> | undefined;
let applyingDraft = false;
const fields = computed(() => [
  { part: 'trail' as const, label: 'Trail' },
  { part: 'terrain' as const, label: props.workspace === 'city' ? 'City base' : 'Terrain' },
  ...(props.showTray ? [{ part: 'tray' as const, label: 'Tray' }] : []),
]);

function clearPending(): void {
  if (applyTimer) clearTimeout(applyTimer);
  applyTimer = undefined;
  pending.value = false;
}

function applyDraft(): void {
  clearPending();
  if (props.disabled) return;
  const next = { ...colors.value };
  for (const part of Object.keys(next) as (keyof ModelColors)[]) {
    if (isHexColor(draft.value[part])) {
      next[part] = draft.value[part].toLowerCase();
      draft.value[part] = next[part];
    }
  }
  if (Object.keys(next).every(part => next[part as keyof ModelColors] === colors.value[part as keyof ModelColors])) return;
  applyingDraft = true;
  try { colors.value = next; }
  finally { applyingDraft = false; }
}

function updateColor(part: keyof ModelColors, event: Event): void {
  if (props.disabled) return;
  const input = event.target as HTMLInputElement;
  const value = input.value.trim();
  draft.value[part] = value;
  input.setCustomValidity(isHexColor(value) ? '' : 'Enter a color as #RRGGBB');
  clearPending();
  pending.value = true;
  applyTimer = setTimeout(applyDraft, applyDelayMs);
}

function finishEditing(part: keyof ModelColors, event: Event): void {
  const input = event.target as HTMLInputElement;
  if (!isHexColor(draft.value[part])) draft.value[part] = colors.value[part];
  input.value = draft.value[part];
  input.setCustomValidity('');
}

function resetColors(): void {
  clearPending();
  draft.value = createDefaultModelColors(props.workspace);
  colors.value = { ...draft.value };
}

watch(colors, value => {
  if (applyingDraft) return;
  clearPending();
  draft.value = { ...value };
}, { deep: true, flush: 'sync' });

watch(() => props.disabled, disabled => {
  if (!disabled) return;
  clearPending();
  draft.value = { ...colors.value };
});

onBeforeUnmount(() => {
  // Keep the last valid edit when closing a preview or changing workspace.
  if (pending.value) applyDraft();
  clearPending();
});
</script>

<template>
  <fieldset class="model-colors" :disabled="disabled">
    <legend class="sr-only">Model colors</legend>
    <div v-for="field in fields" :key="field.part" class="model-colors__field">
      <label :for="`${id}-${field.part}-hex`" class="model-colors__label">{{ field.label }}</label>
      <span class="model-colors__input-wrap">
        <input :id="`${id}-${field.part}-hex`" type="text" class="model-colors__hex" :value="draft[field.part]"
          :aria-label="`${field.label} color`" spellcheck="false" maxlength="7" pattern="#[0-9a-fA-F]{6}"
          @input="updateColor(field.part, $event)" @blur="finishEditing(field.part, $event)" />
        <input type="color" class="model-colors__picker"
          :value="isHexColor(draft[field.part]) ? draft[field.part] : colors[field.part]"
          :aria-label="`${field.label} color picker`" @input="updateColor(field.part, $event)" />
      </span>
    </div>
    <p class="model-colors__delay" :aria-busy="pending">{{ pending ? 'Applying after you stop editing…' : 'Updates 1 second after you stop editing.' }}</p>
    <button type="button" class="model-colors__reset" @click="resetColors">Reset colors</button>
    <p>Preview colors only. Assign filament colors in your slicer.</p>
  </fieldset>
</template>

<style scoped>
.model-colors { min-width: 0; border: 0; padding: 0; margin: 0; }
.model-colors__field { display: flex; flex-direction: column; gap: 6px; min-width: 0; margin-bottom: 12px; }
.model-colors__label { min-height: 24px; display: flex; align-items: center; font-size: 12px; color: var(--tp-text-secondary); }
.model-colors__input-wrap { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 12px; background: var(--tp-bg-input); border-radius: var(--tp-radius-control); }
.model-colors__hex { flex: 1; min-width: 0; border: none; background: transparent; font-size: 15px; font-weight: 500; color: var(--tp-text-primary); outline: none; font-variant-numeric: tabular-nums; }
.model-colors__picker { flex-shrink: 0; width: 24px; height: 24px; padding: 0; border: none; border-radius: 6px; background: transparent; cursor: pointer; }
.model-colors__picker::-webkit-color-swatch-wrapper { padding: 0; }
.model-colors__picker::-webkit-color-swatch { border: 1px solid var(--tp-border-strong); border-radius: 6px; }
.model-colors__picker::-moz-color-swatch { border: 1px solid var(--tp-border-strong); border-radius: 6px; }
.model-colors__input-wrap:focus-within, button:focus-visible { outline: 2px solid var(--tp-text-accent); outline-offset: 2px; }
.model-colors:disabled .model-colors__input-wrap, button:disabled { opacity: 0.45; }
input:disabled, button:disabled { cursor: default; }
.model-colors__reset { padding: 6px 0; color: var(--tp-text-accent); font-size: 11px; font-weight: 600; }
p { margin: 4px 0 0; color: var(--tp-text-secondary); font-size: 10px; line-height: 1.5; }
.model-colors__delay { margin-bottom: 4px; font-size: 11px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
</style>
