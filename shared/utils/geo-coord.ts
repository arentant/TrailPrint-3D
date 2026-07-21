/**
 * WGS-84 ↔ GCJ-02（火星坐标）。
 * 高德等国内瓦片为 GCJ-02；GPX / DEM / 导出仍使用 WGS-84。
 */

const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

export function outOfChina(lat: number, lon: number): boolean {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(lng: number, lat: number): number {
  let ret =
    -100.0 +
    2.0 * lng +
    3.0 * lat +
    0.2 * lat * lat +
    0.1 * lng * lat +
    0.2 * Math.sqrt(Math.abs(lng));
  ret +=
    ((20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) *
      2.0) /
    3.0;
  ret +=
    ((20.0 * Math.sin(lat * PI) + 40.0 * Math.sin((lat / 3.0) * PI)) * 2.0) /
    3.0;
  ret +=
    ((160.0 * Math.sin((lat / 12.0) * PI) + 320 * Math.sin((lat * PI) / 30.0)) *
      2.0) /
    3.0;
  return ret;
}

function transformLon(lng: number, lat: number): number {
  let ret =
    300.0 +
    lng +
    2.0 * lat +
    0.1 * lng * lng +
    0.1 * lng * lat +
    0.1 * Math.sqrt(Math.abs(lng));
  ret +=
    ((20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) *
      2.0) /
    3.0;
  ret +=
    ((20.0 * Math.sin(lng * PI) + 40.0 * Math.sin((lng / 3.0) * PI)) * 2.0) /
    3.0;
  ret +=
    ((150.0 * Math.sin((lng / 12.0) * PI) + 300.0 * Math.sin((lng / 30.0) * PI)) *
      2.0) /
    3.0;
  return ret;
}

function delta(lat: number, lon: number): { dLat: number; dLon: number } {
  const dLat = transformLat(lon - 105.0, lat - 35.0);
  const dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  return {
    dLat: (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI),
    dLon: (dLon * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI),
  };
}

export function wgs84ToGcj02(
  lat: number,
  lon: number,
): { lat: number; lon: number } {
  if (outOfChina(lat, lon)) return { lat, lon };
  const { dLat, dLon } = delta(lat, lon);
  return { lat: lat + dLat, lon: lon + dLon };
}

/** 粗迭代反解，预览精度足够 */
export function gcj02ToWgs84(
  lat: number,
  lon: number,
): { lat: number; lon: number } {
  if (outOfChina(lat, lon)) return { lat, lon };
  let wgsLat = lat;
  let wgsLon = lon;
  for (let i = 0; i < 4; i++) {
    const gcj = wgs84ToGcj02(wgsLat, wgsLon);
    wgsLat -= gcj.lat - lat;
    wgsLon -= gcj.lon - lon;
  }
  return { lat: wgsLat, lon: wgsLon };
}
