import { onScopeDispose, toRef } from 'vue'
import { useConfigStore } from '@/stores/config'
import { useUiStore } from '@/stores/ui'
import { formatIpcError } from '@/ipc/client'
import { parseGpxFiles, parseGpxRequest } from '@/utils/gpx-import'
import type { GpxFileImport } from '@shared/types/gpx'

export function useGpxImport() {
  const configStore = useConfigStore()
  const ui = useUiStore()
  const importing = toRef(ui, 'gpxImporting')
  let disposed = false
  onScopeDispose(() => { disposed = true })

  async function importBatch(parse: () => Promise<GpxFileImport[]>): Promise<boolean> {
    if (importing.value || ui.generating) return false
    importing.value = true
    ui.statusMessage = 'Reading GPX…'
    configStore.config.gpx.lastImportError = undefined
    try {
      const files = await parse()
      if (disposed) return false
      configStore.addGpxImports(files)
      const gpx = configStore.config.gpx
      ui.statusMessage = `Imported ${files.length} GPX ${files.length === 1 ? 'file' : 'files'} · ${gpx.pointCount} points, approximately ${gpx.distanceKm.toFixed(2)} km total · Trails shown on the satellite map`
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

  async function importFromFiles(files: File[]): Promise<boolean> {
    if (!files.length) return false
    return importBatch(() => parseGpxFiles(files))
  }

  function importFromFile(file: File): Promise<boolean> {
    return importFromFiles([file])
  }

  function importFromPath(filePath: string, fileName?: string): Promise<boolean> {
    return importBatch(async () => [await parseGpxRequest({ filePath, fileName })])
  }

  return { importing, importFromFiles, importFromFile, importFromPath }
}
