import { ESRI_TILE_URL } from "@shared/utils/satellite-tiles";

export type BasemapKind = "esri" | "gaode";

export interface BasemapSpec {
  kind: BasemapKind;
  /** Leaflet tile URL template */
  url: string;
  attribution: string;
  maxZoom: number;
  subdomains?: string;
  /** 瓦片为 GCJ-02 时，地图交互需做坐标转换 */
  usesGcj02: boolean;
}

export const ESRI_BASEMAP: BasemapSpec = {
  kind: "esri",
  url: ESRI_TILE_URL,
  attribution:
    "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
  maxZoom: 19,
  usesGcj02: false,
};

/** 高德卫星（国内可达）；坐标系 GCJ-02 */
export const GAODE_BASEMAP: BasemapSpec = {
  kind: "gaode",
  url: "https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
  attribution: '&copy; <a href="https://www.amap.com/">AMap</a>',
  maxZoom: 18,
  subdomains: "1234",
  usesGcj02: true,
};

/** 用 Image 探测瓦片是否可加载（受 CSP / 网络影响） */
export function probeTileUrl(
  url: string,
  timeoutMs = 2800,
): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.referrerPolicy = "no-referrer";
    img.src = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
  });
}

export function esriProbeUrl(): string {
  return ESRI_TILE_URL.replace("{z}", "3")
    .replace("{y}", "3")
    .replace("{x}", "3");
}

export function gaodeProbeUrl(): string {
  return GAODE_BASEMAP.url
    .replace("{s}", "1")
    .replace("{z}", "3")
    .replace("{y}", "3")
    .replace("{x}", "3");
}

/**
 * 中文环境优先高德（国内可达）；其它环境优先 Esri（WGS-84，无偏移）。
 * 首选失败时自动回退。
 */
export async function resolveBasemap(): Promise<BasemapSpec> {
  const preferDomestic =
    typeof navigator !== "undefined" &&
    /^zh\b/i.test(navigator.language || "");

  if (preferDomestic) {
    if (await probeTileUrl(gaodeProbeUrl(), 2000)) return GAODE_BASEMAP;
    if (await probeTileUrl(esriProbeUrl(), 2500)) return ESRI_BASEMAP;
    return GAODE_BASEMAP;
  }

  if (await probeTileUrl(esriProbeUrl(), 2800)) return ESRI_BASEMAP;
  if (await probeTileUrl(gaodeProbeUrl(), 2000)) return GAODE_BASEMAP;
  return ESRI_BASEMAP;
}
