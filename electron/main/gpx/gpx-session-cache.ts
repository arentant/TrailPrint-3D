import type { GpxImportResult } from '@shared/types/gpx';
const imports = new Map<string, GpxImportResult>();
/** Bound memory while retaining separate Mountain and City imports. */
export function setGpxSessionCache(result: GpxImportResult): void {
  if (!result.importId) return;
  imports.delete(result.importId);
  imports.set(result.importId, result);
  while (imports.size > 8) imports.delete(imports.keys().next().value!);
}
export function getGpxSessionCache(importId?: string): GpxImportResult | null {
  return importId ? imports.get(importId) ?? null : null;
}
export function clearGpxSessionCache(): void { imports.clear(); }
