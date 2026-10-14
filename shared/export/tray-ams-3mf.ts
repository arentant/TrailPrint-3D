import type { TerrainMeshPayload } from '../types/terrain';
import { encodeColored3mf } from './colored-3mf';

/** Compatibility wrapper around the named-parts writer. */
export function encodeTrayAms3mf(base: TerrainMeshPayload, text: TerrainMeshPayload, baseColor: string, textColor: string, title = 'TrailPrint base with text'): Uint8Array {
  return encodeColored3mf([{ name: title, parts: [{ name: 'Base', mesh: base, color: baseColor }, { name: 'Text', mesh: text, color: textColor }] }], title);
}
