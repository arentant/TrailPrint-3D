<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useConfigStore } from '@/stores/config'

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  applied: [name: string]
  deleted: [name: string]
  renamed: [name: string]
}>()

const configStore = useConfigStore()
const { schemes, activeSchemeId } = storeToRefs(configStore)
const selectedId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const editingId = ref<string | null>(null)
const editName = ref('')
const editError = ref('')
const editInputEl = ref<HTMLInputElement | null>(null)

const sortedSchemes = computed(() =>
  [...schemes.value].sort((a, b) => b.updatedAt - a.updatedAt),
)

const canApply = computed(
  () => !!selectedId.value && schemes.value.some((s) => s.id === selectedId.value),
)

watch(open, (v) => {
  if (!v) return
  confirmDeleteId.value = null
  cancelEdit()
  selectedId.value =
    activeSchemeId.value &&
    schemes.value.some((s) => s.id === activeSchemeId.value)
      ? activeSchemeId.value
      : null
})

function formatTime(ts: number): string {
  try {
    return new Intl.DateTimeFormat('en', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ts))
  } catch {
    return ''
  }
}

function close(): void {
  open.value = false
}

function selectScheme(id: string): void {
  if (editingId.value) return
  selectedId.value = id
  confirmDeleteId.value = null
}

function applySelected(): void {
  const id = selectedId.value
  if (!id || editingId.value) return
  const scheme = schemes.value.find((s) => s.id === id)
  if (!scheme || !configStore.loadScheme(id)) return
  emit('applied', scheme.name)
  close()
}

async function startEdit(id: string): Promise<void> {
  const scheme = schemes.value.find((s) => s.id === id)
  if (!scheme) return
  confirmDeleteId.value = null
  editingId.value = id
  editName.value = scheme.name
  editError.value = ''
  await nextTick()
  editInputEl.value?.focus()
  editInputEl.value?.select()
}

function cancelEdit(): void {
  editingId.value = null
  editName.value = ''
  editError.value = ''
}

function commitEdit(): void {
  const id = editingId.value
  if (!id) return
  const name = editName.value.trim()
  if (!name) {
    editError.value = 'Enter a name'
    return
  }
  const current = schemes.value.find((s) => s.id === id)
  if (current && current.name === name) {
    cancelEdit()
    return
  }
  if (schemes.value.some((s) => s.id !== id && s.name === name)) {
    editError.value = 'That preset name is already in use'
    return
  }
  try {
    if (!configStore.renameScheme(id, name)) {
      editError.value = 'Could not rename the preset'
      return
    }
    emit('renamed', name)
    cancelEdit()
  } catch (err) {
    editError.value = err instanceof Error ? err.message : 'Could not rename the preset'
  }
}

function setEditInputEl(el: unknown): void {
  editInputEl.value = (el as HTMLInputElement | null) ?? null
}

function requestDelete(id: string): void {
  cancelEdit()
  confirmDeleteId.value = id
}

function confirmDelete(id: string): void {
  const name = schemes.value.find((s) => s.id === id)?.name ?? ''
  if (!configStore.deleteScheme(id)) return
  confirmDeleteId.value = null
  if (selectedId.value === id) selectedId.value = null
  emit('deleted', name)
}

function onDialogKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (editingId.value) {
      e.stopPropagation()
      cancelEdit()
      return
    }
    close()
  }
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
        aria-labelledby="load-scheme-title"
        @click.self="close"
        @keydown="onDialogKeydown"
      >
        <div class="scheme-dialog__panel">
          <header class="scheme-dialog__header">
            <h2 id="load-scheme-title" class="scheme-dialog__title">Apply preset</h2>
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
            Select a preset and choose Apply. You can also rename or delete presets.
          </p>

          <ul v-if="sortedSchemes.length" class="scheme-dialog__list">
            <li
              v-for="scheme in sortedSchemes"
              :key="scheme.id"
              class="scheme-dialog__item"
              :class="{
                'scheme-dialog__item--selected': scheme.id === selectedId,
                'scheme-dialog__item--editing': editingId === scheme.id,
              }"
            >
              <template v-if="editingId === scheme.id">
                <div class="scheme-dialog__edit">
                  <input
                    :ref="setEditInputEl"
                    v-model="editName"
                    type="text"
                    class="scheme-dialog__edit-input"
                    :class="{ 'scheme-dialog__edit-input--error': !!editError }"
                    maxlength="40"
                    @keydown.enter.prevent="commitEdit"
                    @keydown.esc.prevent.stop="cancelEdit"
                  />
                  <p v-if="editError" class="scheme-dialog__edit-error">{{ editError }}</p>
                </div>
                <div class="scheme-dialog__item-actions">
                  <button
                    type="button"
                    class="scheme-dialog__mini scheme-dialog__mini--accent"
                    @click="commitEdit"
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    class="scheme-dialog__mini"
                    @click="cancelEdit"
                  >
                    Cancel
                  </button>
                </div>
              </template>
              <template v-else>
                <button
                  type="button"
                  class="scheme-dialog__select"
                  @click="selectScheme(scheme.id)"
                >
                  <span class="scheme-dialog__name">{{ scheme.name }}</span>
                  <span class="scheme-dialog__time">{{ formatTime(scheme.updatedAt) }}</span>
                </button>
                <div class="scheme-dialog__item-actions">
                  <template v-if="confirmDeleteId === scheme.id">
                    <button
                      type="button"
                      class="scheme-dialog__mini scheme-dialog__mini--danger"
                      @click="confirmDelete(scheme.id)"
                    >
                      Confirm delete
                    </button>
                    <button
                      type="button"
                      class="scheme-dialog__mini"
                      @click="confirmDeleteId = null"
                    >
                      Cancel
                    </button>
                  </template>
                  <template v-else>
                    <button
                      type="button"
                      class="scheme-dialog__mini"
                      @click="startEdit(scheme.id)"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      class="scheme-dialog__mini"
                      @click="requestDelete(scheme.id)"
                    >
                      Delete
                    </button>
                  </template>
                </div>
              </template>
            </li>
          </ul>
          <p v-else class="scheme-dialog__empty">No presets yet. Use Save preset to create one.</p>

          <footer class="scheme-dialog__footer">
            <button type="button" class="scheme-dialog__btn scheme-dialog__btn--ghost" @click="close">
              Close
            </button>
            <button
              type="button"
              class="scheme-dialog__btn scheme-dialog__btn--primary"
              :disabled="!canApply"
              @click="applySelected"
            >
              Apply
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
  width: min(420px, 100%);
  max-height: min(560px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
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

.scheme-dialog__list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  flex: 1;
}

.scheme-dialog__item {
  display: flex;
  align-items: stretch;
  gap: 6px;
  padding: 4px;
  border-radius: 12px;
  background: var(--tp-bg-input);
  border: 1px solid transparent;
}

.scheme-dialog__item--selected {
  border-color: rgba(0, 122, 255, 0.45);
  background: linear-gradient(
    135deg,
    rgba(0, 122, 255, 0.1) 0%,
    var(--tp-bg-input) 65%
  );
}

.scheme-dialog__item--editing {
  border-color: rgba(0, 122, 255, 0.28);
}

.scheme-dialog__select {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  text-align: left;
  border-radius: 10px;
}

.scheme-dialog__select:hover {
  background: rgba(255, 255, 255, 0.7);
}

.scheme-dialog__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--tp-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.scheme-dialog__time {
  font-size: 11px;
  color: var(--tp-text-secondary);
}

.scheme-dialog__edit {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
}

.scheme-dialog__edit-input {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1.5px solid var(--tp-border-strong);
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  background: #fff;
  color: var(--tp-text-primary);
}

.scheme-dialog__edit-input:focus {
  outline: none;
  border-color: var(--tp-text-accent);
  box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.15);
}

.scheme-dialog__edit-input--error {
  border-color: rgba(255, 59, 48, 0.55);
}

.scheme-dialog__edit-error {
  margin: 0;
  font-size: 11px;
  color: #ff3b30;
}

.scheme-dialog__item-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 4px;
  flex-shrink: 0;
}

.scheme-dialog__mini {
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--tp-text-secondary);
  background: transparent;
}

.scheme-dialog__mini:hover {
  background: rgba(0, 0, 0, 0.05);
  color: var(--tp-text-primary);
}

.scheme-dialog__mini--accent {
  color: var(--tp-text-accent);
  background: rgba(0, 122, 255, 0.1);
}

.scheme-dialog__mini--danger {
  color: #ff3b30;
  background: rgba(255, 59, 48, 0.1);
}

.scheme-dialog__empty {
  margin: 0;
  padding: 24px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--tp-text-secondary);
  background: var(--tp-bg-input);
  border-radius: 12px;
}

.scheme-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
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
  min-width: 88px;
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
