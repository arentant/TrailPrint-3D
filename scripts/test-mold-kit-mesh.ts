/**
 * 翻模裙边 / 盖板水密性快速校验
 * npx tsx --tsconfig tsconfig.node.json scripts/test-mold-kit-mesh.ts
 */
import { createDefaultConfig } from "../shared/types/config";
import { analyzeMesh } from "../shared/utils/mesh-manifold";
import {
  computeMoldLidOuter,
  computeMoldSkirtOuter,
} from "../shared/utils/mold-kit-footprint";
import { buildMoldSkirtMesh } from "../electron/main/mold/mold-master-mesh";
import {
  buildMoldLidMesh,
  computeMoldLidHandles,
} from "../electron/main/mold/mold-lid-mesh";

function assert(name: string, cond: boolean, detail = ""): void {
  if (!cond) throw new Error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`ok: ${name}`);
}

const config = createDefaultConfig();
config.mapCrop.shape = "circle";
config.mapCrop.radiusMm = 40;
config.moldKit.skirtWidthMm = 2;
config.moldKit.skirtHeightMm = 2;
config.moldKit.lidHeightMm = 2;
config.moldKit.lidWidthMm = 2;
config.moldKit.lidClearanceMm = 0.2;

const outer = computeMoldSkirtOuter(config).verts;
const skirt = buildMoldSkirtMesh(outer, -2, -4);
const sa = analyzeMesh(skirt);
assert(
  "skirt solid watertight",
  sa.boundaryEdges === 0 && sa.nonManifoldEdges === 0,
  JSON.stringify(sa),
);
assert("skirt has bottom+top+wall faces", sa.triangles > 20);

const lid = buildMoldLidMesh(config);
const la = analyzeMesh(lid);
assert(
  "lid watertight",
  la.boundaryEdges === 0 && la.nonManifoldEdges === 0,
  JSON.stringify(la),
);
assert("lid taller than plate (handles)", lid.minSurfaceZ > config.moldKit.lidHeightMm);

const lidOuter = computeMoldLidOuter(config).verts;
const handles = computeMoldLidHandles(lidOuter);
assert("two handles", handles.length === 2);
assert("handle height 5mm", handles[0]!.heightMm === 5);
assert("handles spaced", Math.abs(handles[0]!.cy - handles[1]!.cy) > 1);

console.log("mold-kit mesh tests passed");
