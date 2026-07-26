<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useUiStore } from '@/stores/ui'
import { useConfigStore } from '@/stores/config'
import { useGpxImport } from '@/composables/useGpxImport'
import { formatIpcError, ipcOnExportProgress, ipcRevealExport } from '@/ipc/client'
import { validateModelGeneration } from '@shared/utils/model-validation'
import GpxImportSummary from '@/components/gpx/GpxImportSummary.vue'
import OpenTopoApiKeyCard from '@/components/sections/OpenTopoApiKeyCard.vue'
import SaveSchemeDialog from '@/components/sections/SaveSchemeDialog.vue'
import LoadSchemeDialog from '@/components/sections/LoadSchemeDialog.vue'
import TrailPrintLogo from '@/components/ui/TrailPrintLogo.vue'
import MapSizeSection from '@/components/sections/MapSizeSection.vue'
import TerrainSection from '@/components/sections/TerrainSection.vue'
import TrailSection from '@/components/sections/TrailSection.vue'
import TraySection from '@/components/sections/TraySection.vue'
import AssemblySection from '@/components/sections/AssemblySection.vue'
import SprayPaintSection from '@/components/sections/SprayPaintSection.vue'
import MoldKitSection from '@/components/sections/MoldKitSection.vue'

const ui = useUiStore()
const configStore = useConfigStore()
const { generating, statusMessage, exportProgress, lastExportZipPath } = storeToRefs(ui)
const { schemes } = storeToRefs(configStore)

function exportFileName(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] ?? path
}

async function revealLastExport(): Promise<void> {
  const path = lastExportZipPath.value
  if (!path) return
  try {
    await ipcRevealExport(path)
  } catch (err) {
    statusMessage.value = formatIpcError(err)
  }
}

let unsubscribeExportProgress: (() => void) | null = null

onMounted(() => {
  unsubscribeExportProgress = ipcOnExportProgress((progress) => {
    ui.exportProgress = progress.progress
    statusMessage.value = progress.message
  })
})

onUnmounted(() => {
  unsubscribeExportProgress?.()
  unsubscribeExportProgress = null
})
const { importing, importFromFile } = useGpxImport()

const fileInput = ref<HTMLInputElement | null>(null)
/** 上次导出详情默认收起，减少底部占用 */
const exportDoneOpen = ref(false)
const saveSchemeOpen = ref(false)
const loadSchemeOpen = ref(false)

function openGpxPicker(): void {
  if (!importing.value) fileInput.value?.click()
}

async function onGpxSelected(e: Event): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  await importFromFile(file)
  ;(e.target as HTMLInputElement).value = ''
}

function openPreviewModal(): void {
  if (!configStore.config.gpx.imported) {
    statusMessage.value = '请先导入 GPX 轨迹文件'
    return
  }
  const check = validateModelGeneration(configStore.config, {
    viewportWidth: ui.previewViewport.w,
    viewportHeight: ui.previewViewport.h,
  })
  if (!check.valid) {
    statusMessage.value = check.message ?? '请修正参数后重试'
    return
  }
  ui.runPrepareExport()
  ui.terrainPreviewOpen = true
}

</script>

<template>
  <aside class="sidebar">
    <header class="sidebar__header">
      <div class="sidebar__brand">
        <TrailPrintLogo :size="36" />
        <div class="sidebar__brand-text">
          <h1 class="sidebar__title">印迹</h1>
          <p class="sidebar__subtitle">TrailPrint 3D</p>
        </div>
      </div>
      <div class="sidebar__header-actions">
        <button
          type="button"
          class="sidebar__import"
          :disabled="importing"
          @click="openGpxPicker"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {{ importing ? '解析中…' : '导入 GPX' }}
        </button>
        <button
          type="button"
          class="sidebar__scheme"
          title="应用已保存的配置方案"
          @click="loadSchemeOpen = true"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="9" y1="13" x2="15" y2="13" />
            <line x1="9" y1="17" x2="15" y2="17" />
          </svg>
          应用方案
          <span v-if="schemes.length" class="sidebar__scheme-count">{{ schemes.length }}</span>
        </button>
      </div>
      <input
        ref="fileInput"
        type="file"
        accept=".gpx,application/gpx+xml"
        class="sr-only"
        @change="onGpxSelected"
      />
    </header>

    <div class="sidebar__scroll">
      <OpenTopoApiKeyCard />
      <GpxImportSummary />
      <div class="sidebar__divider" role="separator" />
      <MapSizeSection />
      <TerrainSection />
      <TrailSection />
      <TraySection />
      <AssemblySection />
      <SprayPaintSection />
      <MoldKitSection />
    </div>

    <footer class="sidebar__footer">
      <div
        v-if="lastExportZipPath && !generating"
        class="sidebar__export-done"
      >
        <button
          type="button"
          class="sidebar__export-toggle"
          :aria-expanded="exportDoneOpen"
          @click="exportDoneOpen = !exportDoneOpen"
        >
          <span class="sidebar__export-label">上次导出</span>
          <span class="sidebar__export-path" :title="lastExportZipPath">
            {{ exportFileName(lastExportZipPath) }}
          </span>
          <svg
            class="sidebar__export-chevron"
            :class="{ 'sidebar__export-chevron--open': exportDoneOpen }"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <div v-show="exportDoneOpen" class="sidebar__export-details">
          <p class="sidebar__export-hint">{{ lastExportZipPath }}</p>
          <button
            type="button"
            class="sidebar__reveal"
            @click="revealLastExport"
          >
            在 Finder 中显示
          </button>
        </div>
      </div>
      <p v-if="statusMessage" class="sidebar__status">
        <template v-if="generating && exportProgress > 0">
          {{ Math.round(exportProgress * 100) }}% ·
        </template>
        {{ statusMessage }}
      </p>
      <div class="sidebar__cta-row">
        <button
          type="button"
          class="sidebar__save-scheme"
          :disabled="generating || importing"
          @click="saveSchemeOpen = true"
        >
          保存方案
        </button>
        <button
          type="button"
          class="sidebar__cta"
          :disabled="generating || importing"
          @click="openPreviewModal"
        >
          预览并下载 STL
        </button>
      </div>
    </footer>

    <SaveSchemeDialog v-model:open="saveSchemeOpen" />
    <LoadSchemeDialog v-model:open="loadSchemeOpen" />
  </aside>
</template>

<style scoped>
.sidebar {
  width: 400px;
  flex-shrink: 0;
  align-self: stretch;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-height: 0;
  background: var(--tp-bg-panel);
  border-radius: var(--tp-radius-panel);
  border: 1px solid var(--tp-border);
  box-shadow: var(--tp-shadow-panel);
  overflow: hidden;
}

.sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 20px 16px 4px;
  background: var(--tp-bg-panel);
}

.sidebar__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-shrink: 1;
}

.sidebar__brand-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.sidebar__title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
}

.sidebar__subtitle {
  margin: 0;
  font-size: 12px;
  color: var(--tp-text-secondary);
}

.sidebar__header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.sidebar__import,
.sidebar__scheme {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 11px;
  border-radius: 17px;
  background: var(--tp-bg-input);
  color: var(--tp-text-accent);
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
  white-space: nowrap;
}

.sidebar__scheme {
  color: var(--tp-text-primary);
}

.sidebar__scheme:hover,
.sidebar__import:hover {
  background: var(--tp-bg-segment);
}

.sidebar__import:disabled {
  opacity: 0.6;
  cursor: wait;
}

.sidebar__scheme-count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: rgba(0, 122, 255, 0.12);
  color: var(--tp-text-accent);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}

.sidebar__divider {
  height: 1px;
  background: var(--tp-border);
}

.sidebar__scroll {
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 12px 16px 16px;
  -webkit-overflow-scrolling: touch;
}

.sidebar__scroll > :deep(*) {
  margin-bottom: 12px;
}

.sidebar__scroll > :deep(*:last-child) {
  margin-bottom: 0;
}

.sidebar__footer {
  padding: 12px 20px 20px;
  background: var(--tp-bg-footer);
  border-top: 1px solid var(--tp-border);
}

.sidebar__export-done {
  margin-bottom: 10px;
  border-radius: 10px;
  background: var(--tp-bg-input);
  border: 1px solid var(--tp-border);
  overflow: hidden;
}

.sidebar__export-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  text-align: left;
}

.sidebar__export-label {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--tp-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.sidebar__export-path {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar__export-chevron {
  flex-shrink: 0;
  color: var(--tp-text-secondary);
  transition: transform 0.15s ease;
}

.sidebar__export-chevron--open {
  transform: rotate(180deg);
}

.sidebar__export-details {
  padding: 0 12px 10px;
}

.sidebar__export-hint {
  margin: 0 0 8px;
  font-size: 11px;
  color: var(--tp-text-secondary);
  line-height: 1.35;
  word-break: break-all;
}

.sidebar__reveal {
  width: 100%;
  height: 36px;
  border-radius: 8px;
  background: var(--tp-bg-panel);
  border: 1px solid var(--tp-border);
  font-size: 13px;
  font-weight: 600;
  color: var(--tp-text-accent);
}

.sidebar__reveal:hover {
  background: var(--tp-bg-footer);
}

.sidebar__status {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--tp-text-secondary);
  line-height: 1.4;
}

.sidebar__cta-row {
  display: flex;
  gap: 10px;
  align-items: stretch;
}

.sidebar__save-scheme {
  flex: 0 0 auto;
  min-width: 96px;
  height: 52px;
  padding: 0 14px;
  border-radius: var(--tp-radius-pill);
  background: var(--tp-bg-panel);
  border: 1.5px solid var(--tp-border-strong);
  color: var(--tp-text-primary);
  font-size: 14px;
  font-weight: 600;
  transition: background 0.15s, opacity 0.15s;
}

.sidebar__save-scheme:hover:not(:disabled) {
  background: var(--tp-bg-input);
}

.sidebar__save-scheme:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.sidebar__cta {
  flex: 1;
  min-width: 0;
  height: 52px;
  border-radius: var(--tp-radius-pill);
  background: var(--tp-cta);
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  box-shadow: var(--tp-shadow-cta);
  transition: opacity 0.15s;
}

.sidebar__cta:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}
</style>
