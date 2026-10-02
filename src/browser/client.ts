import type { TrailPrintApi } from '../../electron/preload'
import type { BrowserExport, ProgressEvent, WorkerMethod, WorkerReply, WorkerRequest } from './protocol'

export function createBrowserApi(): TrailPrintApi & { runtime: 'browser' } {
  let worker: Worker | undefined
  let sequence = 0
  let download: { url: string; name: string } | undefined
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const listeners = new Map<ProgressEvent, Set<(progress: any) => void>>()

  function failAll(message: string): void {
    for (const task of pending.values()) task.reject(new Error(message))
    pending.clear()
    worker?.terminate()
    worker = undefined
  }

  function getWorker(): Worker {
    if (worker) return worker
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      if ('event' in data) {
        for (const listener of listeners.get(data.event) ?? []) listener(data.progress)
        return
      }
      const task = pending.get(data.id)
      if (!task) return
      pending.delete(data.id)
      if ('error' in data) {
        if (data.error.code === 'UNAUTHENTICATED') window.dispatchEvent(new Event('trailprint:auth-required'))
        task.reject(new Error(data.error.message))
      }
      else task.resolve(data.result)
    }
    worker.onerror = () => failAll('Model processing stopped. Try a lower mesh quality or reload the page.')
    worker.onmessageerror = () => failAll('Could not read the model result. Reload the page and try again.')
    return worker
  }

  function invoke<M extends WorkerMethod>(method: M, request: Parameters<TrailPrintApi[M]>[0]): ReturnType<TrailPrintApi[M]> {
    return new Promise<unknown>((resolve, reject) => {
      const id = ++sequence
      pending.set(id, { resolve, reject })
      try {
        getWorker().postMessage({ id, method, request } as WorkerRequest)
      } catch (error) {
        pending.delete(id)
        reject(error)
      }
    }) as ReturnType<TrailPrintApi[M]>
  }

  function onProgress(event: ProgressEvent, callback: (progress: any) => void): () => void {
    const group = listeners.get(event) ?? new Set()
    group.add(callback)
    listeners.set(event, group)
    return () => { group.delete(callback) }
  }

  function triggerDownload(): void {
    if (!download) throw new Error('Generate an export first')
    const link = document.createElement('a')
    link.href = download.url
    link.download = download.name
    document.body.append(link)
    link.click()
    link.remove()
  }

  window.addEventListener('pagehide', () => {
    if (download) URL.revokeObjectURL(download.url)
    download = undefined
    failAll('The page was closed')
  })

  return {
    runtime: 'browser',
    ping: async (request) => ({ reply: request?.message ?? 'TrailPrint 3D', process: 'main', timestamp: Date.now() }),
    enqueueTask: async () => { throw new Error('Use the model generation controls to start a browser task') },
    getTaskStatus: async () => ({ tasks: [] }),
    parseGpx: async (request) => {
      const xml = request.content
      if (!xml) throw new Error('Select a GPX file from your device')
      if (new TextEncoder().encode(xml).length > 10 * 1024 * 1024) throw new Error('Choose a GPX file smaller than 10 MB')
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('GPX files with XML entities are not supported')
      const document = new DOMParser().parseFromString(xml, 'application/xml')
      if (document.querySelector('parsererror') || document.documentElement.localName !== 'gpx' || document.querySelector('trkpt trkpt')) {
        throw new Error('This is not a valid GPX file')
      }
      const points = document.querySelectorAll('trkpt, rtept, wpt')
      if (points.length > 100_000) throw new Error('Choose a GPX file with fewer than 100,000 points')
      for (const point of points) {
        const lat = Number(point.getAttribute('lat'))
        const lon = Number(point.getAttribute('lon'))
        if (!point.hasAttribute('lat') || !point.hasAttribute('lon') || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          throw new Error('The GPX file contains invalid coordinates')
        }
      }
      return invoke('parseGpx', request)
    },
    generateTerrain: (request) => invoke('generateTerrain', request),
    generateTray: (request) => invoke('generateTray', request),
    segmentSprayPaint: (request) => invoke('segmentSprayPaint', request),
    generateSprayMasks: (request) => invoke('generateSprayMasks', request),
    generateExport: async (request) => {
      const result = await invoke('generateExport', request) as BrowserExport
      const blob = new Blob([result.data], { type: result.mimeType })
      if (download) URL.revokeObjectURL(download.url)
      download = { url: URL.createObjectURL(blob), name: result.fileName }
      triggerDownload()
      return { savedPath: result.fileName, cancelled: false, generationMs: result.generationMs }
    },
    revealExport: async () => { triggerDownload(); return { ok: true } },
    onTerrainProgress: (callback) => onProgress('terrain', callback),
    onExportProgress: (callback) => onProgress('export', callback),
    onSprayProgress: (callback) => onProgress('spray', callback),
  }
}
