import { ipcParseGpx } from '@/ipc/client';
import type { GpxFileImport, GpxParseRequest } from '@shared/types/gpx';

export async function parseGpxRequest(request: GpxParseRequest): Promise<GpxFileImport> {
  const importId = crypto.randomUUID();
  const { result } = await ipcParseGpx({ ...request, importId });
  return { ...result, importId, fileName: request.fileName, filePath: request.filePath };
}

/** Parse the entire batch before changing the model, so failures preserve existing trails. */
export async function parseGpxFiles(files: File[]): Promise<GpxFileImport[]> {
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.gpx')) throw new Error(`${file.name}: select a .gpx file`);
    if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name}: choose a GPX file smaller than 10 MB`);
  }
  const results: GpxFileImport[] = [];
  let pointCount = 0;
  for (const file of files) {
    try {
      const filePath = (file as File & { path?: string }).path;
      const result = await parseGpxRequest({ fileName: file.name, ...(filePath ? { filePath } : { content: await file.text() }) });
      pointCount += result.pointCount;
      if (pointCount > 100_000) throw new Error('Use at most 100,000 GPX points across all files in one model');
      results.push(result);
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
      throw new Error(`${file.name}: ${message}`);
    }
  }
  return results;
}
