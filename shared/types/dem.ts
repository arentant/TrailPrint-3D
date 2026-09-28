/** OpenTopography Global DEM API 数据集（与 portal 参数 demtype 一致） */
export type OpenTopoDemType =
  | "COP30"
  | "COP90"
  | "NASADEM"
  | "SRTMGL1"
  | "SRTMGL3";

export interface OpenTopoDemOption {
  value: OpenTopoDemType;
  label: string;
  /** 下拉框下方一行摘要 */
  hint: string;
  /** 水平分辨率说明 */
  resolution: string;
  /** 详细说明（用于 tooltip） */
  summary: string;
  /** 推荐使用场景 */
  bestFor: string;
}

export const OPEN_TOPO_DEM_OPTIONS: ReadonlyArray<OpenTopoDemOption> = [
  {
    value: "COP30",
    label: "COP30 (30m)",
    hint: "Recommended · Global 30m data with balanced detail and speed",
    resolution: "Approx. 30 m",
    summary:
      "The Copernicus global 30m elevation model (GLO-30) offers broad coverage and is a good default for most 3D terrain prints.",
    bestFor: "General terrain keepsakes with detailed ridges and valleys.",
  },
  {
    value: "COP90",
    label: "COP90 (90m)",
    hint: "Faster downloads · Less detail",
    resolution: "Approx. 90 m",
    summary:
      "The Copernicus global 90m model averages elevation over larger areas, producing smoother terrain with less fine detail.",
    bestFor: "Broad terrain shapes with shorter download and generation times.",
  },
  {
    value: "NASADEM",
    label: "NASADEM (30m)",
    hint: "NASA reprocessed SRTM · Improved gap filling",
    resolution: "Approx. 30 m",
    summary:
      "NASA reprocessed the SRTM data to reduce gaps and noise. Elevations are similar to SRTM, with generally cleaner results.",
    bestFor: "An alternative 30m source when COP30 is unavailable or for comparison.",
  },
  {
    value: "SRTMGL1",
    label: "SRTM 30m",
    hint: "Established global 30m data · Some mountain areas may have gaps",
    resolution: "Approx. 30m (1 arc-second)",
    summary:
      "A widely used elevation model from the Shuttle Radar Topography Mission. Steep, vegetated areas can contain gaps. OpenTopography combines tiles for the selected area.",
    bestFor: "Matching an existing SRTM workflow or dataset.",
  },
  {
    value: "SRTMGL3",
    label: "SRTM 90m",
    hint: "Low resolution · Best for broad shapes",
    resolution: "Approx. 90m (3 arc-seconds)",
    summary: "A lower-resolution SRTM model. Like COP90, it captures broad shapes rather than fine terrain detail.",
    bestFor: "Quick previews where fine detail is not needed.",
  },
] as const;

/** DEM 数据源说明（侧边栏 tooltip 全文） */
export function openTopoDemTooltipText(): string {
  const lines = [
    "A digital elevation model (DEM) provides terrain heights. The app downloads elevation rasters for the selected map area from OpenTopography and samples them into a 3D mesh.",
    "",
    "Key differences:",
    "· Resolution (30m vs 90m): smaller values capture finer ridges and valleys; 90m is smoother and faster.",
    "· Source and processing: datasets differ in how they fill gaps and reduce noise in mountains and coastal areas.",
    "· Mesh quality: a denser mesh cannot add detail absent from the source DEM. A 90m DEM cannot produce true 30m detail.",
    "",
    ...OPEN_TOPO_DEM_OPTIONS.flatMap((o) => [
      `[${o.label}]${o.resolution}`,
      o.summary,
      `Best for: ${o.bestFor}`,
      "",
    ]),
    "For terrain keepsakes, start with COP30 and High or Ultra mesh quality.",
  ];
  return lines.join("\n").trim();
}

export interface DemFetchOptions {
  dataset: OpenTopoDemType;
  /** OpenTopography API Key */
  openTopographyApiKey: string;
}
