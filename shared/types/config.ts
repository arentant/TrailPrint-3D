/**
 * 全局参数状态模型 — 覆盖 PRD 五个功能模块的字段占位。
 * 渲染进程负责读写展示；重度计算在主进程读取同构快照。
 */

import type { OpenTopoDemType } from "./dem.js";

// ─── 模块一：地图选取与尺寸 ─────────────────────────────────────────

export type BaseShape = "circle" | "rectangle" | "polygon";

export interface MapCropConfig {
  shape: BaseShape;
  /** 圆形：打印半径 (mm)，仅用于 STL，不影响地图遮罩视觉大小 */
  radiusMm: number;
  /** 矩形：长 × 宽 (mm)；地图遮罩仅取长宽比，尺寸固定 */
  lengthMm: number;
  widthMm: number;
  /** 正多边形：边数 3–8 影响遮罩形状；边长 (mm) 仅用于 STL */
  polygonSides: number;
  polygonSideLengthMm: number;
  /** 矩形 / 正多边形外轮廓 R 角 (mm)，0 为直角 */
  cornerRadiusMm: number;
  /** 地图视窗中心与缩放（地理坐标，供构图与后续 DEM 采样） */
  mapCenterLat: number;
  mapCenterLon: number;
  mapZoom: number;
  /** 地图旋转角（度，0=北朝上），供裁剪与 STL 朝向 */
  mapBearingDeg: number;
  /** Leaflet mapPane 像素偏移；中心与 mapCenter 同步时通常为 0 */
  mapPaneX?: number;
  mapPaneY?: number;
}

// ─── 模块二：主模型生成 ─────────────────────────────────────────────

export type TerrainSmoothing = "raw" | "light" | "medium" | "heavy";

/** 地形 DEM 网格与 3D 预览精度 */
export type TerrainMeshQuality =
  | "standard"
  | "high"
  | "ultra"
  | "extreme"
  | "studio"
  | "custom";

/** meshQuality === "custom" 时生效：DEM 网格单边最大采样数 */
export interface TerrainMeshQualityCustom {
  maxGrid: number;
}

export interface TerrainConfig {
  baseSolidThicknessMm: number;
  zExaggeration: number;
  /** DEM 网格密度：影响 3D 预览与 STL 导出 */
  meshQuality: TerrainMeshQuality;
  /** 自定义精度参数（仅 meshQuality 为 custom 时使用） */
  meshQualityCustom: TerrainMeshQualityCustom;
  smoothing: TerrainSmoothing;
  /** OpenTopography 数据集，见 shared/types/dem.ts */
  demDataset: OpenTopoDemType;
  /** OpenTopography API Key（在应用面板填写，可选由 .env 预填） */
  openTopographyApiKey: string;
}

// ─── 模块三：轨迹模型 ─────────────────────────────────────────────────

export interface TrailConfig {
  gpxSimplify: boolean;
  trailWidthMm: number;
  trailDepthMm: number;
  /** 轨迹顶面高出主模型对应地表的高度 (mm)，用于导出 STL 装配 */
  heightAboveMainMm: number;
}

// ─── 模块四：托盘底座 ─────────────────────────────────────────────────

/** 底座内嵌 NFC 芯片与 0805 LED 指示结构 */
export interface TrayNfcConfig {
  enabled: boolean;
  /** 距打印轮廓内壁的距离 (mm) */
  wallClearanceMm: number;
  /** NFC 区域下沉深度 (mm) */
  recessDepthMm: number;
  /** LED 安装区域额外下沉深度 (mm) */
  ledExtraRecessDepthMm: number;
  /** LED 安装腔长度 (mm)，沿轨迹方向 */
  ledPocketLengthMm: number;
  /** LED 安装腔宽度 (mm) */
  ledPocketWidthMm: number;
  /** 装配盖片厚度 (mm)，与打印轮廓同形、LED 位开孔 */
  coverThicknessMm: number;
  /** 盖片外轮廓相对打印区的向内缩 (mm)，便于嵌入凹槽 */
  coverInsetMm: number;
}

export interface TrayConfig {
  totalThicknessMm: number;
  recessDepthMm: number;
  rimWidthMm: number;
  nfc: TrayNfcConfig;
}

// ─── 模块五：打印装配与磁铁 ───────────────────────────────────────────

export interface MagnetConfig {
  enabled: boolean;
  diameterMm: number;
  thicknessMm: number;
  /** 孔径/孔深装配公差 (mm)：孔内切圆直径 +2×、孔深 +1× */
  toleranceMm: number;
  /** 圆形底座磁铁孔数量（仅 shape===circle 时生效，默认 3，范围 2～12） */
  circleCount: number;
}

export interface AssemblyConfig {
  trailToleranceMm: number;
  trayToleranceMm: number;
  magnet: MagnetConfig;
}

// ─── GPX（任务-01）────────────────────────────────────────────────────

export interface GpxPoint {
  lat: number;
  lon: number;
  ele?: number;
}

export interface GpxBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface GpxState {
  imported: boolean;
  /** Identity of this import, used to scope desktop hydration. */
  importId?: string;
  /** Original GPX segments. Never bridge gaps when generating a city route. */
  segments?: GpxPoint[][];
  fileName?: string;
  /** 本机 GPX 路径（Electron 导入时有值，供主进程导出时重新读取） */
  filePath?: string;
  trackName?: string;
  /** 当前生效轨迹（任务-04 优化后可能替换） */
  points: GpxPoint[];
  /** 原始解析轨迹，供 gpxSimplify 管道使用 */
  rawPoints: GpxPoint[];
  bounds: GpxBounds | null;
  pointCount: number;
  distanceKm: number;
  lastImportError?: string;
}

// ─── 喷漆分色（任务-09）────────────────────────────────────────────────

export interface SprayPaintConfig {
  enabled: boolean;
  colorCount: number;
  categoryRuleVersion: number;
  maskShellThicknessMm: number;
  maskFitToleranceMm: number;
  bleedMarginMm: number;
}

// ─── 模块六：翻模套件（可选导出）──────────────────────────────────────

export interface MoldKitConfig {
  /** 总开关；false 时不导出 Mold_* */
  enabled: boolean;
  /** 裙边高度 (mm)：自浇注停面向下 */
  skirtHeightMm: number;
  /** 裙边外扩宽度 (mm)：相对山体打印外轮廓 */
  skirtWidthMm: number;
  /** 盖板高度 (mm) */
  lidHeightMm: number;
  /** 盖板外扩宽度 (mm)：相对山体打印外轮廓 */
  lidWidthMm: number;
  /**
   * 盖板外轮廓相对裙边外轮廓的内缩间隙 (mm)。
   * 实际盖板外扩 = lidWidthMm - lidClearanceMm。
   */
  lidClearanceMm: number;
  /** 盖板尺寸是否与裙边同步 */
  lidSyncWithSkirt: boolean;
}

// ─── 应用全局配置 ───────────────────────────────────────────────────────

/** Settings shared by map-based model flows. No GPX or terrain requirements. */
export interface MapModelConfig {
  mapCrop: MapCropConfig;
}

export interface MountainTrailConfig extends MapModelConfig {
  gpx: GpxState;
  terrain: TerrainConfig;
  trail: TrailConfig;
  tray: TrayConfig;
  assembly: AssemblyConfig;
  sprayPaint: SprayPaintConfig;
  moldKit: MoldKitConfig;
}

/** Compatibility name for the existing mountain workspace and saved presets. */
export type AppConfig = MountainTrailConfig;

/**
 * 可持久化的参数方案切片。
 * 不含 GPX 与 API Key。地图取景可选；旧方案加载时沿用当前取景。
 */
export interface ConfigSchemePayload {
  mapCrop: MapCropConfig;
  mapView?: Pick<MapCropConfig, "mapCenterLat" | "mapCenterLon" | "mapZoom" | "mapBearingDeg">;
  terrain: Omit<TerrainConfig, "openTopographyApiKey">;
  trail: TrailConfig;
  tray: TrayConfig;
  assembly: AssemblyConfig;
  sprayPaint: SprayPaintConfig;
  moldKit: MoldKitConfig;
}

export interface ConfigScheme {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  payload: ConfigSchemePayload;
}

export function createDefaultConfig(): AppConfig {
  return {
    gpx: {
      imported: false,
      points: [],
      rawPoints: [],
      bounds: null,
      pointCount: 0,
      distanceKm: 0,
    },
    mapCrop: {
      shape: "circle",
      radiusMm: 60,
      lengthMm: 120,
      widthMm: 80,
      polygonSides: 6,
      polygonSideLengthMm: 45,
      cornerRadiusMm: 0,
      mapCenterLat: 0,
      mapCenterLon: 0,
      mapZoom: 12,
      mapBearingDeg: 0,
    },
    terrain: {
      baseSolidThicknessMm: 2,
      zExaggeration: 2,
      meshQuality: "studio",
      meshQualityCustom: { maxGrid: 512 },
      smoothing: "raw",
      demDataset: "COP30",
      openTopographyApiKey: "",
    },
    trail: {
      gpxSimplify: false,
      trailWidthMm: 1,
      trailDepthMm: 1.5,
      heightAboveMainMm: 0.12,
    },
    tray: {
      totalThicknessMm: 5,
      recessDepthMm: 2,
      rimWidthMm: 9,
      nfc: {
        enabled: false,
        wallClearanceMm: 1,
        recessDepthMm: 0.5,
        ledExtraRecessDepthMm: 0.8,
        ledPocketLengthMm: 4,
        ledPocketWidthMm: 2.5,
        coverThicknessMm: 0.2,
        coverInsetMm: 0.2,
      },
    },
    assembly: {
      trailToleranceMm: 0.15,
      trayToleranceMm: 0.2,
      magnet: {
        enabled: false,
        diameterMm: 6,
        thicknessMm: 2,
        toleranceMm: 0.1,
        circleCount: 3,
      },
    },
    sprayPaint: {
      enabled: false,
      colorCount: 4,
      categoryRuleVersion: 1,
      maskShellThicknessMm: 1.0,
      maskFitToleranceMm: 0.2,
      bleedMarginMm: 0.5,
    },
    moldKit: {
      enabled: false,
      skirtHeightMm: 2,
      skirtWidthMm: 2,
      lidHeightMm: 2,
      lidWidthMm: 2,
      lidClearanceMm: 0.2,
      lidSyncWithSkirt: true,
    },
  };
}
