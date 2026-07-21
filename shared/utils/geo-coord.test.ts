import assert from "node:assert/strict";
import { gcj02ToWgs84, wgs84ToGcj02, outOfChina } from "./geo-coord";

function almostEqual(a: number, b: number, eps = 1e-5): boolean {
  return Math.abs(a - b) < eps;
}

assert.equal(outOfChina(0, 0), true);

const shanghai = wgs84ToGcj02(31.2304, 121.4737);
assert.ok(shanghai.lat !== 31.2304 || shanghai.lon !== 121.4737);

const back = gcj02ToWgs84(shanghai.lat, shanghai.lon);
assert.ok(almostEqual(back.lat, 31.2304, 1e-4), `lat ${back.lat}`);
assert.ok(almostEqual(back.lon, 121.4737, 1e-4), `lon ${back.lon}`);

console.log("geo-coord tests passed");
