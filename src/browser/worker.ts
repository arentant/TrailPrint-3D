/// <reference lib="webworker" />
import { zipSync } from 'fflate'
import { generateTerrainMain } from '../../electron/main/terrain/terrain-main-service'
import { generateTrayBase } from '../../electron/main/tray/tray-service'
import { generateModelFiles, defaultZipName } from '../../electron/main/export/generate-model-files'
import { segmentSprayPaint } from '../../electron/main/spray-paint/segment-service'
import { generateSprayMasks } from '../../electron/main/spray-paint/mask-generate-service'
import { parseGpxXml } from '@shared/utils/gpx-parser'
import { IpcException } from '@shared/ipc/types'
import type { BrowserExport, ProgressEvent, WorkerReply, WorkerRequest } from './protocol'

const scope = self as unknown as DedicatedWorkerGlobalScope

async function execute(task: WorkerRequest): Promise<void> {
  const progress = (event: ProgressEvent) => (value: unknown) =>
    scope.postMessage({ id: task.id, event, progress: value } satisfies WorkerReply)
  try {
    let result: unknown
    switch (task.method) {
      case 'parseGpx': {
        const xml = task.request.content
        if (!xml) throw new Error('Select a GPX file from your device')
        if (new TextEncoder().encode(xml).length > 10 * 1024 * 1024) throw new Error('Choose a GPX file smaller than 10 MB')
        result = { result: parseGpxXml(xml, task.request.fileName) }
        break
      }
      case 'generateTerrain': result = await generateTerrainMain(task.request, progress('terrain')); break
      case 'generateTray': result = await generateTrayBase(task.request); break
      case 'segmentSprayPaint': result = await segmentSprayPaint(task.request, progress('spray')); break
      case 'generateSprayMasks': result = await generateSprayMasks(task.request, progress('spray')); break
      case 'generateExport': {
        const started = Date.now()
        const files: Record<string, Uint8Array> = Object.create(null)
        await generateModelFiles(task.request, progress('export'), (name, data) => {
          if (name.includes('/') || name.includes('\\')) throw new Error('Invalid export filename')
          files[name] = data
        })
        progress('export')({ phase: 'zip', progress: 0.9, message: 'Creating ZIP download…' })
        const archive = zipSync(files, { level: 6 })
        result = { archive, fileName: defaultZipName(), cancelled: false, generationMs: Date.now() - started } satisfies BrowserExport
        progress('export')({ phase: 'done', progress: 1, message: 'Download ready' })
        scope.postMessage({ id: task.id, result } satisfies WorkerReply, [archive.buffer])
        return
      }
    }
    scope.postMessage({ id: task.id, result } satisfies WorkerReply)
  } catch (error) {
    scope.postMessage({ id: task.id, error: {
      code: error instanceof IpcException ? error.code : 'BROWSER_TASK_FAILED',
      message: error instanceof Error ? error.message : String(error),
    } } satisfies WorkerReply)
  }
}

// Serialize work so previews and exports cannot exhaust memory simultaneously.
let queue = Promise.resolve()
scope.onmessage = ({ data }: MessageEvent<WorkerRequest>) => { queue = queue.then(() => execute(data)) }
