import { defineStore } from "pinia";
import { ref, watch } from "vue";
import {
  createDefaultConfig,
  type AppConfig,
  type ConfigScheme,
  type ConfigSchemePayload,
  type GpxPoint,
  type TrailConfig,
} from "@shared/types";
import type { GpxImportResult } from "@shared/types/gpx";
import { zoomToFitBoundsInMask } from "@shared/utils/map-projection";
import { useUiStore } from "@/stores/ui";

const OPENTOPO_API_KEY_STORAGE = "trailprint.openTopographyApiKey";
const SCHEMES_STORAGE = "trailprint.configSchemes";

function envOpenTopoApiKey(): string {
  return import.meta.env.VITE_OPENTOPOGRAPHY_API_KEY?.trim() ?? "";
}

function loadPersistedApiKey(): string {
  try {
    return localStorage.getItem(OPENTOPO_API_KEY_STORAGE)?.trim() ?? "";
  } catch {
    return "";
  }
}

function resolveOpenTopoApiKeyForUi(): string {
  return loadPersistedApiKey() || envOpenTopoApiKey();
}

function applyOpenTopoApiKey(cfg: AppConfig): void {
  cfg.terrain.openTopographyApiKey = resolveOpenTopoApiKeyForUi();
}

function ensureTrailConfigDefaults(cfg: AppConfig): void {
  const trail = cfg.trail as TrailConfig & { heightAboveMainMm?: number };
  if (trail.heightAboveMainMm == null) {
    const legacy = (cfg.assembly as { trailProtrusionMm?: number })
      .trailProtrusionMm;
    trail.heightAboveMainMm = legacy ?? 0.12;
  }
}

function ensureMagnetConfigDefaults(cfg: AppConfig): void {
  const magnet = cfg.assembly.magnet as AppConfig["assembly"]["magnet"] & {
    circleCount?: number;
    toleranceMm?: number;
  };
  if (magnet.circleCount == null) {
    magnet.circleCount = 3;
  }
  if (magnet.toleranceMm == null) {
    magnet.toleranceMm = 0.1;
  }
}

function ensureTrayNfcDefaults(cfg: AppConfig): void {
  const tray = cfg.tray as AppConfig["tray"] & { nfc?: AppConfig["tray"]["nfc"] };
  if (!tray.nfc) {
    tray.nfc = createDefaultConfig().tray.nfc;
    return;
  }
  const defaults = createDefaultConfig().tray.nfc;
  if (tray.nfc.ledPocketLengthMm == null) {
    tray.nfc.ledPocketLengthMm = defaults.ledPocketLengthMm;
  }
  if (tray.nfc.ledPocketWidthMm == null) {
    tray.nfc.ledPocketWidthMm = defaults.ledPocketWidthMm;
  }
  if (tray.nfc.coverThicknessMm == null) {
    tray.nfc.coverThicknessMm = defaults.coverThicknessMm;
  }
  if (tray.nfc.coverInsetMm == null) {
    tray.nfc.coverInsetMm = defaults.coverInsetMm;
  }
}

function ensureSprayPaintDefaults(cfg: AppConfig): void {
  if (!cfg.sprayPaint) {
    cfg.sprayPaint = createDefaultConfig().sprayPaint;
  }
}

function ensureMoldKitDefaults(cfg: AppConfig): void {
  if (!cfg.moldKit) {
    cfg.moldKit = createDefaultConfig().moldKit;
    return;
  }
  const defaults = createDefaultConfig().moldKit;
  const mk = cfg.moldKit as AppConfig["moldKit"] & {
    lidSyncWithSkirt?: boolean;
    lidClearanceMm?: number;
  };
  if (mk.lidSyncWithSkirt == null) mk.lidSyncWithSkirt = defaults.lidSyncWithSkirt;
  if (mk.lidClearanceMm == null) mk.lidClearanceMm = defaults.lidClearanceMm;
  if (mk.skirtHeightMm == null) mk.skirtHeightMm = defaults.skirtHeightMm;
  if (mk.skirtWidthMm == null) mk.skirtWidthMm = defaults.skirtWidthMm;
  if (mk.lidHeightMm == null) mk.lidHeightMm = defaults.lidHeightMm;
  if (mk.lidWidthMm == null) mk.lidWidthMm = defaults.lidWidthMm;
  if (mk.enabled == null) mk.enabled = defaults.enabled;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 方案只存底座造型/尺寸，不含地图中心、缩放、旋转等取景 */
function extractMapCropForScheme(mapCrop: AppConfig["mapCrop"]): AppConfig["mapCrop"] {
  return {
    shape: mapCrop.shape,
    radiusMm: mapCrop.radiusMm,
    lengthMm: mapCrop.lengthMm,
    widthMm: mapCrop.widthMm,
    polygonSides: mapCrop.polygonSides,
    polygonSideLengthMm: mapCrop.polygonSideLengthMm,
    cornerRadiusMm: mapCrop.cornerRadiusMm,
    // 占位字段，加载时一律沿用当前取景，不读方案里的值
    mapCenterLat: 0,
    mapCenterLon: 0,
    mapZoom: 12,
    mapBearingDeg: 0,
  };
}

function extractSchemePayload(cfg: AppConfig): ConfigSchemePayload {
  const { openTopographyApiKey: _key, ...terrainRest } = cfg.terrain;
  return deepClone({
    mapCrop: extractMapCropForScheme(cfg.mapCrop),
    terrain: terrainRest,
    trail: cfg.trail,
    tray: cfg.tray,
    assembly: cfg.assembly,
    sprayPaint: cfg.sprayPaint,
    moldKit: cfg.moldKit,
  });
}

function applySchemePayload(cfg: AppConfig, payload: ConfigSchemePayload): void {
  const apiKey = cfg.terrain.openTopographyApiKey;
  const gpx = cfg.gpx;
  const framing = {
    mapCenterLat: cfg.mapCrop.mapCenterLat,
    mapCenterLon: cfg.mapCrop.mapCenterLon,
    mapZoom: cfg.mapCrop.mapZoom,
    mapBearingDeg: cfg.mapCrop.mapBearingDeg,
    mapPaneX: cfg.mapCrop.mapPaneX,
    mapPaneY: cfg.mapCrop.mapPaneY,
  };

  const nextMap = extractMapCropForScheme(payload.mapCrop);
  cfg.mapCrop = { ...nextMap, ...framing };
  cfg.terrain = {
    ...deepClone(payload.terrain),
    openTopographyApiKey: apiKey,
  };
  cfg.trail = deepClone(payload.trail);
  cfg.tray = deepClone(payload.tray);
  cfg.assembly = deepClone(payload.assembly);
  cfg.sprayPaint = deepClone(payload.sprayPaint);
  cfg.moldKit = deepClone(payload.moldKit);
  cfg.gpx = gpx;
  ensureTrailConfigDefaults(cfg);
  ensureMagnetConfigDefaults(cfg);
  ensureTrayNfcDefaults(cfg);
  ensureSprayPaintDefaults(cfg);
  ensureMoldKitDefaults(cfg);
}

function loadPersistedSchemes(): ConfigScheme[] {
  try {
    const raw = localStorage.getItem(SCHEMES_STORAGE);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ConfigScheme =>
        !!item &&
        typeof item === "object" &&
        typeof (item as ConfigScheme).id === "string" &&
        typeof (item as ConfigScheme).name === "string" &&
        !!(item as ConfigScheme).payload,
    );
  } catch {
    return [];
  }
}

function persistSchemes(list: ConfigScheme[]): void {
  try {
    localStorage.setItem(SCHEMES_STORAGE, JSON.stringify(list));
  } catch {
    /* 隐私模式等环境可能禁用 localStorage */
  }
}

function newSchemeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `scheme-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 清理此前注入的联调测试方案 */
function purgeTestSchemes(existing: ConfigScheme[]): ConfigScheme[] {
  const cleaned = existing.filter((s) => !s.id.startsWith("test-scheme-"));
  if (cleaned.length !== existing.length) {
    persistSchemes(cleaned);
  }
  return cleaned;
}

export const useConfigStore = defineStore("config", () => {
  const config = ref<AppConfig>(createDefaultConfig());
  if (window.trailPrint.runtime === "browser") config.value.terrain.meshQuality = "high";
  applyOpenTopoApiKey(config.value);
  ensureTrailConfigDefaults(config.value);
  ensureMagnetConfigDefaults(config.value);
  ensureTrayNfcDefaults(config.value);
  ensureSprayPaintDefaults(config.value);
  ensureMoldKitDefaults(config.value);

  const schemes = ref<ConfigScheme[]>(
    purgeTestSchemes(loadPersistedSchemes()),
  );
  const activeSchemeId = ref<string | null>(null);

  watch(
    () => config.value.terrain.openTopographyApiKey,
    (key) => {
      try {
        const v = key.trim();
        if (v) localStorage.setItem(OPENTOPO_API_KEY_STORAGE, v);
        else localStorage.removeItem(OPENTOPO_API_KEY_STORAGE);
      } catch {
        /* 隐私模式等环境可能禁用 localStorage */
      }
    },
  );

  function resetConfig(): void {
    config.value = createDefaultConfig();
    if (window.trailPrint.runtime === "browser") config.value.terrain.meshQuality = "high";
    applyOpenTopoApiKey(config.value);
    ensureTrailConfigDefaults(config.value);
    ensureMagnetConfigDefaults(config.value);
    ensureTrayNfcDefaults(config.value);
    ensureSprayPaintDefaults(config.value);
    ensureMoldKitDefaults(config.value);
    activeSchemeId.value = null;
  }

  function patchConfig(partial: Partial<AppConfig>): void {
    config.value = { ...config.value, ...partial };
  }

  /** 写入 GPX 解析结果并更新建议地图中心 */
  function applyGpxImport(
    result: GpxImportResult,
    fileName?: string,
    filePath?: string,
  ): void {
    const raw = clonePoints(result.points);
    config.value.gpx = {
      imported: true,
      fileName,
      filePath,
      trackName: result.trackName,
      points: raw,
      rawPoints: raw,
      bounds: result.bounds,
      pointCount: result.pointCount,
      distanceKm: result.distanceKm,
      lastImportError: undefined,
    };
    if (result.bounds) {
      config.value.mapCrop.mapCenterLat =
        (result.bounds.minLat + result.bounds.maxLat) / 2;
      config.value.mapCrop.mapCenterLon =
        (result.bounds.minLon + result.bounds.maxLon) / 2;
      const ui = useUiStore();
      const w = Math.max(ui.previewViewport.w, 64);
      const h = Math.max(ui.previewViewport.h, 64);
      config.value.mapCrop.mapZoom = zoomToFitBoundsInMask(
        result.bounds,
        w,
        h,
        config.value.mapCrop,
      );
    } else {
      config.value.mapCrop.mapCenterLat = result.suggestedCenter.lat;
      config.value.mapCrop.mapCenterLon = result.suggestedCenter.lon;
    }
  }

  function setGpxImportError(message: string): void {
    config.value.gpx.lastImportError = message;
    config.value.gpx.imported = false;
  }

  function clearGpx(): void {
    config.value.gpx = createDefaultConfig().gpx;
  }

  /** 供主进程读取的快照（后续任务通过 IPC 传递） */
  function toSnapshot(): AppConfig {
    return deepClone(config.value);
  }

  /** 将当前参数保存为命名方案（名称必须唯一） */
  function saveScheme(name: string): ConfigScheme {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Enter a preset name");
    }
    if (schemes.value.some((s) => s.name === trimmed)) {
      throw new Error("That preset name is already in use. Choose another name.");
    }
    const now = Date.now();
    const scheme: ConfigScheme = {
      id: newSchemeId(),
      name: trimmed,
      createdAt: now,
      updatedAt: now,
      payload: extractSchemePayload(config.value),
    };
    schemes.value = [scheme, ...schemes.value];
    persistSchemes(schemes.value);
    activeSchemeId.value = scheme.id;
    return scheme;
  }

  function isSchemeNameTaken(name: string, excludeId?: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;
    return schemes.value.some(
      (s) => s.name === trimmed && s.id !== excludeId,
    );
  }

  /** 覆盖已有方案内容为当前参数 */
  function updateScheme(id: string): ConfigScheme | null {
    const target = schemes.value.find((s) => s.id === id);
    if (!target) return null;
    target.payload = extractSchemePayload(config.value);
    target.updatedAt = Date.now();
    schemes.value = [...schemes.value];
    persistSchemes(schemes.value);
    activeSchemeId.value = id;
    return target;
  }

  function loadScheme(id: string): boolean {
    const target = schemes.value.find((s) => s.id === id);
    if (!target) return false;
    applySchemePayload(config.value, target.payload);
    activeSchemeId.value = id;
    return true;
  }

  function deleteScheme(id: string): boolean {
    const next = schemes.value.filter((s) => s.id !== id);
    if (next.length === schemes.value.length) return false;
    schemes.value = next;
    persistSchemes(schemes.value);
    if (activeSchemeId.value === id) activeSchemeId.value = null;
    return true;
  }

  function renameScheme(id: string, name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const target = schemes.value.find((s) => s.id === id);
    if (!target) return false;
    if (
      schemes.value.some((s) => s.id !== id && s.name === trimmed)
    ) {
      throw new Error("A preset with that name already exists");
    }
    target.name = trimmed;
    target.updatedAt = Date.now();
    schemes.value = [...schemes.value];
    persistSchemes(schemes.value);
    return true;
  }

  return {
    config,
    schemes,
    activeSchemeId,
    resetConfig,
    patchConfig,
    applyGpxImport,
    setGpxImportError,
    clearGpx,
    toSnapshot,
    saveScheme,
    updateScheme,
    loadScheme,
    deleteScheme,
    renameScheme,
    isSchemeNameTaken,
  };
});

function clonePoints(points: GpxPoint[]): GpxPoint[] {
  return points.map((p) => ({ ...p }));
}
