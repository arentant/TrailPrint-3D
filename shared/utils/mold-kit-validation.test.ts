import assert from "node:assert/strict";
import { createDefaultConfig } from "../types/config";
import {
  MOLD_LID_MIN_HEIGHT_MM,
  validateMoldKitConfig,
} from "./mold-kit-validation";
import {
  computeMoldLidOuter,
  computeMoldSkirtOuter,
  outsetTerrainPrintByMm,
} from "./mold-kit-footprint";
import { validateMoldKitSection, validateModelGeneration } from "./model-validation";

function testDisabledSkipsValidation(): void {
  const mk = createDefaultConfig().moldKit;
  mk.enabled = false;
  mk.skirtHeightMm = 0;
  assert.equal(validateMoldKitConfig(mk).valid, true);
}

function testSkirtHeightMustBePositive(): void {
  const mk = createDefaultConfig().moldKit;
  mk.enabled = true;
  mk.skirtHeightMm = 0;
  const r = validateMoldKitConfig(mk);
  assert.equal(r.valid, false);
  assert.match(r.message ?? "", /裙边高度/);
}

function testLidClearance(): void {
  const mk = createDefaultConfig().moldKit;
  mk.enabled = true;
  mk.lidWidthMm = 0.2;
  mk.lidClearanceMm = 0.2;
  const r = validateMoldKitConfig(mk);
  assert.equal(r.valid, false);
  assert.match(r.message ?? "", /配合间隙/);
}

function testLidMinHeight(): void {
  const mk = createDefaultConfig().moldKit;
  mk.enabled = true;
  mk.lidHeightMm = MOLD_LID_MIN_HEIGHT_MM - 0.1;
  const r = validateMoldKitConfig(mk);
  assert.equal(r.valid, false);
  assert.match(r.message ?? "", /盖板/);
}

function testOutsetCircle(): void {
  const config = createDefaultConfig();
  config.mapCrop.shape = "circle";
  config.mapCrop.radiusMm = 50;
  config.moldKit.skirtWidthMm = 2;
  const outer = computeMoldSkirtOuter(config);
  const r = Math.hypot(outer.verts[0]!.x, outer.verts[0]!.y);
  assert.ok(Math.abs(r - 52) < 0.01);
}

function testLidOuterUsesClearance(): void {
  const config = createDefaultConfig();
  config.mapCrop.shape = "circle";
  config.mapCrop.radiusMm = 50;
  config.moldKit.lidWidthMm = 2;
  config.moldKit.lidClearanceMm = 0.2;
  const lid = computeMoldLidOuter(config);
  const r = Math.hypot(lid.verts[0]!.x, lid.verts[0]!.y);
  assert.ok(Math.abs(r - 51.8) < 0.01);
  const zero = outsetTerrainPrintByMm(config, 0);
  const r0 = Math.hypot(zero.verts[0]!.x, zero.verts[0]!.y);
  assert.ok(Math.abs(r0 - 50) < 0.01);
}

function testModelGenerationIncludesMoldKit(): void {
  const config = createDefaultConfig();
  config.gpx.imported = true;
  config.gpx.points = [
    { lat: 31, lon: 121 },
    { lat: 31.001, lon: 121.001 },
  ];
  config.gpx.rawPoints = config.gpx.points;
  config.moldKit.enabled = true;
  config.moldKit.skirtHeightMm = 0;
  const r = validateModelGeneration(config, { requireGpx: true });
  assert.equal(r.valid, false);
  assert.equal(r.scope, "moldKit");
}

function testSectionHelper(): void {
  const config = createDefaultConfig();
  assert.equal(validateMoldKitSection(config).valid, true);
  config.moldKit.enabled = true;
  config.moldKit.lidClearanceMm = -1;
  assert.equal(validateMoldKitSection(config).valid, false);
}

testDisabledSkipsValidation();
testSkirtHeightMustBePositive();
testLidClearance();
testLidMinHeight();
testOutsetCircle();
testLidOuterUsesClearance();
testModelGenerationIncludesMoldKit();
testSectionHelper();
console.log("mold-kit tests passed");
