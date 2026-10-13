import { strToU8, zipSync } from "fflate";
import type { TerrainMeshPayload } from "../types/terrain";
import { isHexColor } from "../types/model-colors";
import { assertWatertightMesh } from "../utils/mesh-manifold";

const xml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

function meshXml(mesh: TerrainMeshPayload): string {
  assertWatertightMesh(mesh, "AMS part");
  if (!mesh.indices.length || !mesh.positions.every(Number.isFinite)) throw new Error("AMS parts must contain finite printable geometry.");
  const remap = new Map<number, number>(), vertices: string[] = [], triangles: string[] = [];
  const vertex = (i: number) => {
    if (!Number.isInteger(i) || i < 0 || i * 3 + 2 >= mesh.positions.length) throw new Error("Invalid AMS mesh vertex.");
    if (!remap.has(i)) {
      remap.set(i, remap.size);
      vertices.push(`<vertex x="${mesh.positions[i * 3]}" y="${mesh.positions[i * 3 + 1]}" z="${mesh.positions[i * 3 + 2]}"/>`);
    }
    return remap.get(i)!;
  };
  for (let t = 0; t < mesh.indices.length; t += 3) {
    triangles.push(`<triangle v1="${vertex(mesh.indices[t]!)}" v2="${vertex(mesh.indices[t + 1]!)}" v3="${vertex(mesh.indices[t + 2]!)}"/>`);
  }
  return `<mesh><vertices>${vertices.join("")}</vertices><triangles>${triangles.join("")}</triangles></mesh>`;
}

/** Standard 3MF components plus Bambu part/filament metadata; no printer profile or G-code. */
export function encodeTrayAms3mf(base: TerrainMeshPayload, text: TerrainMeshPayload, baseColor: string, textColor: string, title = "TrailPrint base with text"): Uint8Array {
  if (!isHexColor(baseColor) || !isHexColor(textColor)) throw new Error("Choose valid base and text colors for the AMS export.");
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" requiredextensions="m">
<metadata name="Application">TrailPrint 3D</metadata><metadata name="Title">${xml(title)}</metadata>
<resources><m:colorgroup id="1"><m:color color="${baseColor.toUpperCase()}FF"/><m:color color="${textColor.toUpperCase()}FF"/></m:colorgroup>
<object id="2" type="model" name="Base" pid="1" pindex="0">${meshXml(base)}</object>
<object id="3" type="model" name="Text" pid="1" pindex="1">${meshXml(text)}</object>
<object id="4" type="model" name="${xml(title)}"><components><component objectid="2"/><component objectid="3"/></components></object>
</resources><build><item objectid="4"/></build></model>`;
  const settings = `<?xml version="1.0" encoding="UTF-8"?>
<config><object id="4"><metadata key="name" value="${xml(title)}"/><metadata key="extruder" value="1"/>
<part id="2" subtype="normal_part"><metadata key="name" value="Base"/><metadata key="extruder" value="1"/></part>
<part id="3" subtype="normal_part"><metadata key="name" value="Text"/><metadata key="extruder" value="2"/></part>
</object></config>`;
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/octet-stream"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`),
    "3D/3dmodel.model": strToU8(model),
    "Metadata/model_settings.config": strToU8(settings),
    "Metadata/project_settings.config": strToU8(JSON.stringify({ filament_colour: [baseColor, textColor], filament_settings_id: ["", ""] })),
  }, { level: 6 });
}
