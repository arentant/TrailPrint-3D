import { strToU8, zipSync } from 'fflate';
import type { TerrainMeshPayload } from '../types/terrain';
import { isHexColor } from '../types/model-colors';
import { assertWatertightMesh } from '../utils/mesh-manifold';

export interface ColoredPart { name: string; color: string; mesh: TerrainMeshPayload }
export interface PrintableGroup { name: string; parts: ColoredPart[] }
export const xmlEscape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

function meshXml(mesh: TerrainMeshPayload): string {
  assertWatertightMesh(mesh, '3MF part');
  if (!mesh.indices.length || !mesh.positions.every(Number.isFinite)) throw new Error('3MF parts must contain finite printable geometry.');
  const remap = new Map<number, number>(), vertices: string[] = [], triangles: string[] = [];
  const vertex = (i: number) => {
    if (!Number.isInteger(i) || i < 0 || i * 3 + 2 >= mesh.positions.length) throw new Error('Invalid 3MF mesh vertex.');
    if (!remap.has(i)) { remap.set(i, remap.size); vertices.push(`<vertex x="${mesh.positions[i * 3]}" y="${mesh.positions[i * 3 + 1]}" z="${mesh.positions[i * 3 + 2]}"/>`); }
    return remap.get(i)!;
  };
  for (let t = 0; t < mesh.indices.length; t += 3) triangles.push(`<triangle v1="${vertex(mesh.indices[t]!)}" v2="${vertex(mesh.indices[t + 1]!)}" v3="${vertex(mesh.indices[t + 2]!)}"/>`);
  return `<mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh>`;
}

export function meshBounds(meshes: TerrainMeshPayload[]) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) for (let i = 0; i < mesh.positions.length; i++) { const axis = i % 3; min[axis] = Math.min(min[axis]!, mesh.positions[i]!); max[axis] = Math.max(max[axis]!, mesh.positions[i]!); }
  return { min, max };
}

/** Coordinates in the STL are bed-ready; inverse translation restores assembly. */
export function normalizePartToBed(mesh: TerrainMeshPayload) {
  const { min, max } = meshBounds([mesh]);
  const assemblyTranslation = [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, min[2]!];
  return { assemblyTranslation, mesh: { ...mesh, bottomZ: 0, minSurfaceZ: mesh.minSurfaceZ - min[2]!,
    positions: mesh.positions.map((v, i) => v - assemblyTranslation[i % 3]!) } };
}

/** Standard material colors and components, plus Bambu Studio part metadata. */
export function encodeColored3mf(groups: PrintableGroup[], title = 'TrailPrint model', metadata: unknown = {}): Uint8Array {
  if (!groups.length || groups.some(g => !g.parts.length)) throw new Error('3MF needs nonempty printable groups.');
  const parts = groups.flatMap(g => g.parts);
  if (parts.some(p => !isHexColor(p.color))) throw new Error('Choose valid part colors for the 3MF export.');
  const colors = [...new Set(parts.map(p => p.color))];
  const resources: string[] = [], builds: string[] = [], settings: string[] = [];
  const placements: unknown[] = [];
  let partOffset = 0, previousMaxY = 0;
  for (const [groupIndex, group] of groups.entries()) {
    const groupId = parts.length + 2 + groupIndex;
    const bounds = meshBounds(group.parts.map(p => p.mesh));
    // A vertical shelf keeps the common terrain + tray pair compact. Move every
    // group's entire assembly together, including its bed lift, into positive XY.
    const translation = [10 - bounds.min[0]!, previousMaxY + 10 - bounds.min[1]!, -bounds.min[2]!];
    previousMaxY = bounds.max[1]! + translation[1]!;
    const componentIds: number[] = [], partSettings: string[] = [];
    for (const part of group.parts) {
      const partId = ++partOffset + 1, colorIndex = colors.indexOf(part.color); componentIds.push(partId);
      resources.push(`<object id="${partId}" type="model" name="${xmlEscape(part.name)}" pid="1" pindex="${colorIndex}">${meshXml(part.mesh)}</object>`);
      partSettings.push(`<part id="${partId}" subtype="normal_part"><metadata key="name" value="${xmlEscape(part.name)}"/><metadata key="extruder" value="${colorIndex + 1}"/></part>`);
    }
    resources.push(`<object id="${groupId}" type="model" name="${xmlEscape(group.name)}"><components>${componentIds.map(id => `<component objectid="${id}"/>`).join('')}</components></object>`);
    const transform = translation.some(v => v !== 0) ? ` transform="1 0 0 0 1 0 0 0 1 ${translation.join(' ')}"` : '';
    builds.push(`<item objectid="${groupId}"${transform}/>`);
    settings.push(`<object id="${groupId}"><metadata key="name" value="${xmlEscape(group.name)}"/><metadata key="extruder" value="1"/>${partSettings.join('')}</object>`);
    placements.push({ name: group.name, translationMm: translation });
  }
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" requiredextensions="m">
<metadata name="Application">TrailPrint 3D</metadata><metadata name="Title">${xmlEscape(title)}</metadata><resources><m:colorgroup id="1">${colors.map(color => `<m:color color="${color.toUpperCase()}FF"/>`).join('')}</m:colorgroup>${resources.join('')}</resources><build>${builds.join('')}</build></model>`;
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/octet-stream"/><Default Extension="json" ContentType="application/json"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model': strToU8(model),
    'Metadata/model_settings.config': strToU8(`<?xml version="1.0" encoding="UTF-8"?><config>${settings.join('')}</config>`),
    'Metadata/trailprint.json': strToU8(JSON.stringify({ metadata, placements, palette: colors }, null, 2)),
  }, { level: 6 });
}
