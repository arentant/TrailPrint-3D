import { writeFile } from "fs/promises";
import type { TerrainMeshPayload } from "@shared/types/terrain";
import { encodeBinaryStl } from "@shared/utils/binary-stl";

export async function writeBinaryStl(filePath: string, mesh: TerrainMeshPayload, solidName = "mesh"): Promise<void> {
  await writeFile(filePath, encodeBinaryStl(mesh, solidName));
}
