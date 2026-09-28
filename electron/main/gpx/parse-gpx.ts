import { readFile } from 'fs/promises'
import type { GpxImportResult, GpxParseRequest } from '@shared/types/gpx'
import { IpcException } from '@shared/ipc/types'
import { parseGpxXml } from '@shared/utils/gpx-parser'

export async function parseGpxFile(req: GpxParseRequest): Promise<GpxImportResult> {
  let xml: string
  const fileName = req.fileName

  if (req.filePath) {
    try {
      xml = await readFile(req.filePath, 'utf-8')
    } catch {
      throw new IpcException('GPX_READ_FAILED', 'Could not read the GPX file')
    }
  } else if (req.content) {
    xml = req.content
  } else {
    throw new IpcException('INVALID_REQUEST', 'A file path or file content is required')
  }

  return parseGpxXml(xml, fileName)
}
