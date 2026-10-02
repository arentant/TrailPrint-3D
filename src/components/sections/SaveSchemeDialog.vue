<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useConfigStore } from '@/stores/config'
import { useUiStore } from '@/stores/ui'

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  saved: [name: string]
}>()

const configStore = useConfigStore()
const ui = useUiStore()
const { schemes } = storeToRefs(configStore)

const nameInput = ref('')
const error = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
const composing = ref(false)
const includeMapView = ref(true)

const trimmed = computed(() => nameInput.value.trim())

const nameTaken = computed(() => {
  const name = trimmed.value
  if (!name) return false
  return schemes.value.some((s) => s.name === name)
})

/** 有内容即可点；重名在点击时提示，避免灰按钮无反馈 */
const canClick = computed(() => trimmed.value.length > 0 || composing.value)

watch(open, async (v) => {
  if (!v) return
  nameInput.value = ''
  error.value = ''
  composing.value = false
  includeMapView.value = true
  await nextTick()
  inputEl.value?.focus()
})

watch(trimmed, (name) => {
  if (!name || composing.value) {
    error.value = ''
    return
  }
  error.value = nameTaken.value ? 'That preset name is already in use. Choose another name.' : ''
})

function close(): void {
  open.value = false
}

function onCompositionStart(): void {
  composing.value = true
}

function onCompositionEnd(e: CompositionEvent): void {
  composing.value = false
  // 部分输入法在 compositionend 时 v-model 尚未同步，强制读一次
  const target = e.target as HTMLInputElement
  nameInput.value = target.value
}

function submit(): void {
  if (composing.value) return
  const name = trimmed.value
  if (!name) {
    error.value = 'Enter a preset name'
    return
  }
  if (schemes.value.some((s) => s.name === name)) {
    error.value = 'That preset name is already in use. Choose another name.'
    return
  }
  try {
    ui.runPrepareExport()
    const scheme = configStore.saveScheme(name, includeMapView.value)
    emit('saved', scheme.name)
    close()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not save the preset'
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="scheme-dialog">
      <div
        v-if="open"
        class="scheme-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-scheme-title"
        @click.self="close"
        @keydown="onKeydown"
      >
        <div class="scheme-dialog__panel">
          <header class="scheme-dialog__header">
            <h2 id="save-scheme-title" class="scheme-dialog__title">Save preset</h2>
            <button
              type="button"
              class="scheme-dialog__close"
              aria-label="Close"
              @click="close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </header>
          <p class="scheme-dialog__hint">
            Save size, terrain, trail, tray, and other settings. GPX data and your API key are excluded.
          </p>
          <label class="scheme-dialog__label" for="save-scheme-name">Preset name</label>
          <input
            id="save-scheme-name"
            ref="inputEl"
            v-model="nameInput"
            type="text"
            class="scheme-dialog__input"
            :class="{ 'scheme-dialog__input--error': !!error }"
            placeholder="e.g. 80mm circular base"
            maxlength="40"
            @compositionstart="onCompositionStart"
            @compositionend="onCompositionEnd"
            @keydown.enter.prevent="submit"
          />
          <p v-if="error" class="scheme-dialog__error">{{ error }}</p>
          <label class="scheme-dialog__option">
            <input v-model="includeMapView" type="checkbox" />
            <span>Save map coordinates and framing</span>
          </label>
          <p class="scheme-dialog__option-hint">
            Restore this location, zoom, and rotation when you apply the preset.
          </p>
          <footer class="scheme-dialog__footer">
            <button type="button" class="scheme-dialog__btn scheme-dialog__btn--ghost" @click="close">
              Cancel
            </button>
            <button
              type="button"
              class="scheme-dialog__btn scheme-dialog__btn--primary"
              :disabled="!canClick"
              @click="submit"
            >
              Save
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.scheme-dialog {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.36);
}

.scheme-dialog__panel {
  width: min(400px, 100%);
  padding: 20px;
  border-radius: 16px;
  background: var(--tp-bg-panel);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.18);
}

.scheme-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.scheme-dialog__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.scheme-dialog__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  color: var(--tp-text-secondary);
}

.scheme-dialog__close:hover {
  background: var(--tp-bg-input);
  color: var(--tp-text-primary);
}

.scheme-dialog__hint {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--tp-text-secondary);
}

.scheme-dialog__label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--tp-text-secondary);
}

.scheme-dialog__input {
  width: 100%;
  padding: 10px 12px;
  border: 1.5px solid var(--tp-border-strong);
  border-radius: 10px;
  font-size: 15px;
  font-weight: 500;
  background: #fff;
  color: var(--tp-text-primary);
}

.scheme-dialog__input:focus {
  outline: none;
  border-color: var(--tp-text-accent);
  box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.15);
}

.scheme-dialog__input--error {
  border-color: rgba(255, 59, 48, 0.55);
}

.scheme-dialog__error {
  margin: 8px 0 0;
  font-size: 12px;
  color: #ff3b30;
}

.scheme-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}

.scheme-dialog__option {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  font-size: 13px;
  cursor: pointer;
}

.scheme-dialog__option input {
  width: 16px;
  height: 16px;
  accent-color: var(--tp-text-accent);
}

.scheme-dialog__option-hint {
  margin: 6px 0 0 24px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--tp-text-secondary);
}

.scheme-dialog__btn {
  height: 40px;
  padding: 0 16px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
}

.scheme-dialog__btn--ghost {
  background: var(--tp-bg-input);
  color: var(--tp-text-primary);
}

.scheme-dialog__btn--primary {
  background: var(--tp-cta);
  color: #fff;
}

.scheme-dialog__btn--primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.scheme-dialog-enter-active,
.scheme-dialog-leave-active {
  transition: opacity 0.15s ease;
}

.scheme-dialog-enter-active .scheme-dialog__panel,
.scheme-dialog-leave-active .scheme-dialog__panel {
  transition: transform 0.15s ease, opacity 0.15s ease;
}

.scheme-dialog-enter-from,
.scheme-dialog-leave-to {
  opacity: 0;
}

.scheme-dialog-enter-from .scheme-dialog__panel,
.scheme-dialog-leave-to .scheme-dialog__panel {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}
</style>
