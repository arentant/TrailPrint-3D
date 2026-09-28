import type { TerrainMeshPayload } from "@shared/types/terrain";

const HEADER_BYTES = 80;
const TRIANGLE_RECORD_BYTES = 50;

/**
 * 将索引三角网格写出为二进制 STL（单位 mm，小端 float32）。
 */
export function encodeBinaryStl(
  mesh: TerrainMeshPayload,
  solidName = "mesh",
): Uint8Array {
  const triangleCount = mesh.indices.length / 3;
  if (triangleCount < 1 || mesh.indices.length % 3 !== 0) {
    throw new Error("The mesh has no valid triangles and cannot be exported as STL");
  }

  const buffer = new Uint8Array(HEADER_BYTES + 4 + triangleCount * TRIANGLE_RECORD_BYTES);
  buffer.set(new TextEncoder().encode(`TrailPrint ${solidName}`.slice(0, 79)));
  const view = new DataView(buffer.buffer);
  view.setUint32(HEADER_BYTES, triangleCount, true);

  const pos = mesh.positions;
  let offset = HEADER_BYTES + 4;

  for (let t = 0; t < triangleCount; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;

    const ax = pos[i0 * 3]!;
    const ay = pos[i0 * 3 + 1]!;
    const az = pos[i0 * 3 + 2]!;
    const bx = pos[i1 * 3]!;
    const by = pos[i1 * 3 + 1]!;
    const bz = pos[i1 * 3 + 2]!;
    const cx = pos[i2 * 3]!;
    const cy = pos[i2 * 3 + 1]!;
    const cz = pos[i2 * 3 + 2]!;

    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const nlen = Math.hypot(nx, ny, nz) || 1;
    nx /= nlen;
    ny /= nlen;
    nz /= nlen;

    view.setFloat32(offset, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);
    offset += 12;

    view.setFloat32(offset, ax, true);
    view.setFloat32(offset + 4, ay, true);
    view.setFloat32(offset + 8, az, true);
    offset += 12;
    view.setFloat32(offset, bx, true);
    view.setFloat32(offset + 4, by, true);
    view.setFloat32(offset + 8, bz, true);
    offset += 12;
    view.setFloat32(offset, cx, true);
    view.setFloat32(offset + 4, cy, true);
    view.setFloat32(offset + 8, cz, true);
    offset += 12;

    view.setUint16(offset, 0, true);
    offset += 2;
  }

  return buffer;
}
