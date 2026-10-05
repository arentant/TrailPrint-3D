import { onScopeDispose, ref } from 'vue'
import { useConfigStore } from '@/stores/config'
import { useUiStore } from '@/stores/ui'
import { formatIpcError, ipcParseGpx } from '@/ipc/client'
import type { GpxParseRequest } from '@shared/types/gpx'

type ElectronFile = File & { path?: string }

export function useGpxImport() {
  const configStore = useConfigStore()
  const ui = useUiStore()
  const importing = ref(false)
  let disposed = false
  onScopeDispose(() => { disposed = true })

  async function importFromFile(file: File): Promise<boolean> {
    if (!file.name.toLowerCase().endsWith('.gpx')) {
      configStore.setGpxImportError('Select a .gpx file')
      ui.statusMessage = 'Select a .gpx file'
      return false
    }

    importing.value = true
    ui.statusMessage = 'Reading GPX…'
    configStore.config.gpx.lastImportError = undefined

    try {
      const req = await buildParseRequest(file)
      const { result } = await ipcParseGpx(req)
      if (disposed) return false
      configStore.applyGpxImport(result, file.name, (file as ElectronFile).path)
      ui.requestGpxMapFit()
      ui.statusMessage = `${formatImportSummary(result.trackName, result.pointCount, result.distanceKm)} · Trail shown in red on the satellite map`
      return true
    } catch (err) {
      if (disposed) return false
      const msg = formatIpcError(err)
      configStore.setGpxImportError(msg)
      ui.statusMessage = msg
      return false
    } finally {
      importing.value = false
    }
  }

  async function importFromPath(filePath: string, fileName?: string): Promise<boolean> {
    importing.value = true
    ui.statusMessage = 'Reading GPX…'
    try {
      const { result } = await ipcParseGpx({ filePath, fileName })
      if (disposed) return false
      configStore.applyGpxImport(result, fileName, filePath)
      ui.requestGpxMapFit()
      ui.statusMessage = `${formatImportSummary(result.trackName, result.pointCount, result.distanceKm)} · Trail shown in red on the satellite map`
      return true
    } catch (err) {
      if (disposed) return false
      const msg = formatIpcError(err)
      configStore.setGpxImportError(msg)
      ui.statusMessage = msg
      return false
    } finally {
      importing.value = false
    }
  }

  return { importing, importFromFile, importFromPath }
}

async function buildParseRequest(file: File): Promise<GpxParseRequest> {
  const electronFile = file as ElectronFile
  if (electronFile.path) {
    return { filePath: electronFile.path, fileName: file.name }
  }
  const content = await file.text()
  return { content, fileName: file.name }
}

function formatImportSummary(
  trackName: string | undefined,
  pointCount: number,
  distanceKm: number
): string {
  const name = trackName ? `“${trackName}”` : 'Trail'
  return `Imported ${name}: ${pointCount} points, approximately ${distanceKm.toFixed(2)} km`
}
