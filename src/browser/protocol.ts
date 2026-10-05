import type { TrailPrintApi } from '../../electron/preload'
import type { ExportGenerateResponse } from '@shared/types/export'

export type WorkerMethod = 'parseGpx' | 'generateTerrain' | 'generateTray' | 'generateExport' | 'segmentSprayPaint' | 'generateSprayMasks'
export type WorkerRequest = {
  [M in WorkerMethod]: { id: number; method: M; request: Parameters<TrailPrintApi[M]>[0] }
}[WorkerMethod]
export type ProgressEvent = 'terrain' | 'export' | 'spray'
export type BrowserExport = ExportGenerateResponse & { data: Uint8Array; fileName: string; mimeType: string }
export type WorkerReply =
  | { id: number; result: unknown }
  | { id: number; error: { code: string; message: string } }
  | { id: number; event: ProgressEvent; progress: unknown }
