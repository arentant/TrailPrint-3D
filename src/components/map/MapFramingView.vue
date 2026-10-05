<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, useId, watch } from "vue";
import L from "leaflet";
import "leaflet-rotate";
import {
  buildMaskGeometry,
  maskEvenOddPath,
  maskHoleOutlinePath,
  maskPolygonPoints,
  type MaskScreenGeometry,
} from "@/utils/map-mask-geometry";
import {
  buildTrayMaskOverlay,
  trayOuterPolygonPoints,
} from "@/utils/tray-mask-geometry";
import { maskFitPadding } from "@shared/utils/map-projection";
import { gcj02ToWgs84, wgs84ToGcj02 } from "@shared/utils/geo-coord";
import {
  type BasemapSpec,
  resolveBasemap,
} from "@/utils/basemap-tiles";

import type { MapCropConfig, GpxState, GpxPoint, TrayConfig } from '@shared/types/config';
const props = defineProps<{
  crop: MapCropConfig;
  gpx: GpxState;
  points: GpxPoint[];
  segments?: GpxPoint[][];
  tray?: TrayConfig;
  fitNonce: number;
  gridVisible?: boolean;
  restoreView?: boolean;
}>();
const emit = defineEmits<{
  'update:crop': [crop: MapCropConfig];
  viewport: [value: { w: number; h: number }];
  ready: [value: boolean];
}>();
const config = computed(() => ({ mapCrop: props.crop, gpx: props.gpx, tray: props.tray }));
const effectivePoints = computed(() => props.points);
const initialFitNonce = props.fitNonce;

const mapWrap = ref<HTMLDivElement | null>(null);
const mapRoot = ref<HTMLDivElement | null>(null);
const maskGeom = ref<MaskScreenGeometry | null>(null);
const maskW = ref(1);
const maskH = ref(1);
const mapInstance = shallowRef<L.Map | null>(null);
const trackLayer = shallowRef<L.Polyline | null>(null);
const tileLayer = shallowRef<L.TileLayer | null>(null);
/** 当前底图；GCJ 瓦片时地图交互坐标需转换 */
const activeBasemap = shallowRef<BasemapSpec | null>(null);
const basemapStatus = ref<string | null>(null);
const gridClipId = useId();
let applyingMapView = false;

const gridClipPath = computed(() =>
  maskHoleOutlinePath(config.value.mapCrop, maskW.value, maskH.value),
);

const gridLines = computed(() => {
  const m = maskGeom.value;
  if (!m) return { vertical: [], horizontal: [] };
  const hw = m.hw ?? m.r ?? Math.max(...(m.vertices ?? []).map((v) => Math.abs(v.x - m.cx)), 0);
  const hh = m.hh ?? m.r ?? Math.max(...(m.vertices ?? []).map((v) => Math.abs(v.y - m.cy)), 0);
  const spacing = Math.max(24, Math.min(hw, hh) / 4);
  const vertical: number[] = [];
  const horizontal: number[] = [];
  for (let x = spacing; x < hw; x += spacing) {
    vertical.push(m.cx - x, m.cx + x);
  }
  for (let y = spacing; y < hh; y += spacing) {
    horizontal.push(m.cy - y, m.cy + y);
  }
  return { vertical, horizontal };
});

/** 滚轮每变化一级缩放所需像素；Leaflet 默认 60，越大单次缩放越平缓 */
const WHEEL_PX_PER_ZOOM_LEVEL = 5;
/** 允许小数缩放，避免每次滚轮跳一整级 */
const ZOOM_SNAP = 0.01;

const TRACK_STYLE: L.PolylineOptions = {
  color: "#e53935",
  weight: 5,
  opacity: 0.95,
  lineCap: "round",
  lineJoin: "round",
};

function updateMaskLayout(): void {
  const wrap = mapWrap.value;
  if (!wrap) return;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  if (w < 1 || h < 1) return;
  emit('viewport', { w, h });
  maskW.value = w;
  maskH.value = h;
  maskGeom.value = buildMaskGeometry(config.value.mapCrop, w, h);
}

function rectBoxStyle(m: MaskScreenGeometry): Record<string, string> | undefined {
  if (m.kind !== "rect" || !m.hw || !m.hh) return undefined;
  const style: Record<string, string> = {
    left: `${m.cx}px`,
    top: `${m.cy}px`,
    transform: "translate(-50%, -50%)",
    width: `${m.hw * 2}px`,
    height: `${m.hh * 2}px`,
  };
  if (m.cornerR && m.cornerR > 0.5) {
    style.borderRadius = `${m.cornerR}px`;
  }
  return style;
}

const maskHoleStyle = computed(() => {
  const m = maskGeom.value;
  if (!m || m.kind === "polygon") return undefined;
  const base: Record<string, string> = {
    left: `${m.cx}px`,
    top: `${m.cy}px`,
    transform: "translate(-50%, -50%)",
  };
  if (m.kind === "circle" && m.r) {
    return {
      ...base,
      width: `${m.r * 2}px`,
      height: `${m.r * 2}px`,
      borderRadius: "50%",
    };
  }
  if (m.kind === "rect") {
    return rectBoxStyle(m);
  }
  return undefined;
});

const polygonDimPath = computed(() => {
  if (maskGeom.value?.kind !== "polygon") return "";
  return maskEvenOddPath(config.value.mapCrop, maskW.value, maskH.value);
});

const polygonOutlinePoints = computed(() => {
  const verts = maskGeom.value?.vertices;
  if (!verts?.length) return "";
  return maskPolygonPoints(verts);
});

const trayOverlay = computed(() => {
  if (!props.tray || maskW.value < 1 || maskH.value < 1) return null;
  return buildTrayMaskOverlay(
    config.value.mapCrop,
    props.tray,
    maskW.value,
    maskH.value,
  );
});

const trayOuterStyle = computed(() => {
  const t = trayOverlay.value;
  const m = t?.outer;
  if (!m || m.kind === "polygon") return undefined;
  const base: Record<string, string> = {
    left: `${m.cx}px`,
    top: `${m.cy}px`,
    transform: "translate(-50%, -50%)",
  };
  if (m.kind === "circle" && m.r) {
    return {
      ...base,
      width: `${m.r * 2}px`,
      height: `${m.r * 2}px`,
      borderRadius: "50%",
    };
  }
  if (m.kind === "rect") {
    return rectBoxStyle(m);
  }
  return undefined;
});

const trayPolygonOutline = computed(() => {
  const t = trayOverlay.value;
  if (!t || t.outer.kind !== "polygon") return "";
  return trayOuterPolygonPoints(t);
});

function toMapLatLng(lat: number, lon: number): L.LatLng {
  if (activeBasemap.value?.usesGcj02) {
    const g = wgs84ToGcj02(lat, lon);
    return L.latLng(g.lat, g.lon);
  }
  return L.latLng(lat, lon);
}

function fromMapLatLng(lat: number, lng: number): { lat: number; lon: number } {
  if (activeBasemap.value?.usesGcj02) {
    const w = gcj02ToWgs84(lat, lng);
    return { lat: w.lat, lon: w.lon };
  }
  return { lat, lon: lng };
}

function syncStoreFromMap(): void {
  const map = mapInstance.value;
  if (!map || applyingMapView) return;
  const c = map.getCenter();
  const wgs = fromMapLatLng(c.lat, c.lng);
  emit('update:crop', { ...props.crop, mapCenterLat: wgs.lat, mapCenterLon: wgs.lon,
    mapZoom: map.getZoom(), mapBearingDeg: typeof map.getBearing === 'function' ? map.getBearing() : props.crop.mapBearingDeg,
    mapPaneX: 0, mapPaneY: 0,
  });
}

function updateTrackLayer(): void {
  const map = mapInstance.value;
  if (!map) return;

  if (trackLayer.value) {
    map.removeLayer(trackLayer.value);
    trackLayer.value = null;
  }

  const points = effectivePoints.value;
  if (!points.length) return;

  const latlngs = (props.segments ?? [points]).map((segment) => segment.map((p) => toMapLatLng(p.lat, p.lon)));
  trackLayer.value = L.polyline(latlngs, TRACK_STYLE).addTo(map);
}

let fitRetryTimer: ReturnType<typeof setTimeout> | null = null;

function fitTrackInView(attempt = 0): void {
  const map = mapInstance.value;
  const bounds = config.value.gpx.bounds;
  if (!map || !bounds || !config.value.gpx.imported) return;

  updateMaskLayout();
  map.invalidateSize({ animate: false });

  const wrap = mapWrap.value;
  const w = wrap?.clientWidth ?? 0;
  const h = wrap?.clientHeight ?? 0;
  if (w < 32 || h < 32) {
    if (attempt < 8) {
      fitRetryTimer = setTimeout(() => fitTrackInView(attempt + 1), 50);
    }
    return;
  }

  const sw = toMapLatLng(bounds.minLat, bounds.minLon);
  const ne = toMapLatLng(bounds.maxLat, bounds.maxLon);
  const latLngBounds = L.latLngBounds(sw, ne);
  const pad = maskFitPadding(config.value.mapCrop, w, h);
  map.fitBounds(latLngBounds, {
    paddingTopLeft: [pad[3], pad[0]],
    paddingBottomRight: [pad[1], pad[2]],
    maxZoom: 19,
    animate: false,
  });
  syncStoreFromMap();
  updateTrackLayer();
}

function scheduleFitTrackInView(): void {
  if (fitRetryTimer) {
    clearTimeout(fitRetryTimer);
    fitRetryTimer = null;
  }
  requestAnimationFrame(() => {
    fitTrackInView();
    requestAnimationFrame(() => fitTrackInView());
  });
}

function resetMapView(): void {
  const map = mapInstance.value;
  if (!map) return;

  if (typeof map.setBearing === "function") {
    map.setBearing(0);
    emit('update:crop', { ...props.crop, mapBearingDeg: 0 });
  }

  if (config.value.gpx.imported && config.value.gpx.bounds) {
    scheduleFitTrackInView();
  } else {
    syncStoreFromMap();
  }
}

/** Alt/Option + 拖拽：绕视窗中心旋转地图（遮罩保持固定） */
function setupAltDragRotate(map: L.Map, container: HTMLElement): () => void {
  let rotating = false;
  let startBearing = 0;
  let startAngle = 0;
  let pivotX = 0;
  let pivotY = 0;

  const angleFromPointer = (clientX: number, clientY: number) =>
    (Math.atan2(clientY - pivotY, clientX - pivotX) * 180) / Math.PI;

  const onPointerDown = (e: PointerEvent) => {
    if (!e.altKey || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".leaflet-control")) return;

    const rect = container.getBoundingClientRect();
    pivotX = rect.left + rect.width / 2;
    pivotY = rect.top + rect.height / 2;
    startBearing = map.getBearing();
    startAngle = angleFromPointer(e.clientX, e.clientY);
    rotating = true;
    map.dragging.disable();
    container.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!rotating) return;
    const delta = angleFromPointer(e.clientX, e.clientY) - startAngle;
    map.setBearing(startBearing + delta);
  };

  const onPointerEnd = (e: PointerEvent) => {
    if (!rotating) return;
    rotating = false;
    map.dragging.enable();
    if (container.hasPointerCapture(e.pointerId)) {
      container.releasePointerCapture(e.pointerId);
    }
    syncStoreFromMap();
  };

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerEnd);
  container.addEventListener("pointercancel", onPointerEnd);

  return () => {
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerup", onPointerEnd);
    container.removeEventListener("pointercancel", onPointerEnd);
  };
}

let teardownAltRotate: (() => void) | null = null;

function attachBasemap(map: L.Map, spec: BasemapSpec): void {
  if (tileLayer.value) {
    map.removeLayer(tileLayer.value);
    tileLayer.value = null;
  }
  activeBasemap.value = spec;
  const layer = L.tileLayer(spec.url, {
    attribution: spec.attribution,
    maxZoom: spec.maxZoom,
    subdomains: spec.subdomains ?? "abc",
  });
  layer.addTo(map);
  tileLayer.value = layer;
  basemapStatus.value =
    spec.kind === "gaode" ? "Basemap: AMap satellite (fallback when Esri is unavailable)" : null;
}

async function initMap(): Promise<void> {
  const el = mapRoot.value;
  if (!el || mapInstance.value) return;

  basemapStatus.value = "Checking basemap…";
  const spec = await resolveBasemap();

  // 异步探测期间组件可能已卸载
  if (!mapRoot.value || mapInstance.value) return;

  // A preset or GPX import can change the view while the basemap is loading.
  const { mapCenterLat, mapCenterLon, mapZoom, mapBearingDeg } = config.value.mapCrop;
  const savedView = props.restoreView;
  const useInitialCenter = !config.value.gpx.imported && !savedView && mapCenterLat === 0 && mapCenterLon === 0;
  const wgsLat = useInitialCenter ? 30 : mapCenterLat;
  const wgsLon = useInitialCenter ? 105 : mapCenterLon;

  const center = spec.usesGcj02
    ? (() => {
        const g = wgs84ToGcj02(wgsLat, wgsLon);
        return L.latLng(g.lat, g.lon);
      })()
    : L.latLng(wgsLat, wgsLon);

  const map = L.map(el, {
    center,
    zoom: mapZoom || 10,
    zoomControl: false,
    attributionControl: true,
    zoomSnap: ZOOM_SNAP,
    zoomDelta: ZOOM_SNAP,
    wheelPxPerZoomLevel: WHEEL_PX_PER_ZOOM_LEVEL,
    wheelDebounceTime: 60,
    rotate: true,
    bearing: mapBearingDeg ?? 0,
    touchRotate: true,
    shiftKeyRotate: true,
    rotateControl: false,
  });

  attachBasemap(map, spec);

  map.on("moveend", syncStoreFromMap);
  map.on("zoomend", syncStoreFromMap);
  map.on("rotate", syncStoreFromMap);
  map.on("rotateend", syncStoreFromMap);

  teardownAltRotate = setupAltDragRotate(map, el);

  mapInstance.value = map;
  syncStoreFromMap();
  updateMaskLayout();
  map.invalidateSize({ animate: false });
  updateTrackLayer();

  if (props.fitNonce !== initialFitNonce && props.gpx.imported) scheduleFitTrackInView();

  // 布局稳定后再刷一次，避免首帧容器尺寸为 0 导致瓦片不绘
  requestAnimationFrame(() => {
    if (mapInstance.value !== map) return;
    map.invalidateSize({ animate: false });
    setTimeout(() => {
      if (mapInstance.value !== map) return;
      map.invalidateSize({ animate: false });
      syncStoreFromMap();
      emit('ready', true);
    }, 120);
  });
}

let resizeObserver: ResizeObserver | null = null;



onMounted(() => {
  void initMap();
  const wrap = mapWrap.value;
  if (wrap) {
    resizeObserver = new ResizeObserver(() => {
      updateMaskLayout();
      mapInstance.value?.invalidateSize();
    });
    resizeObserver.observe(wrap);
  }
});

onUnmounted(() => {
  if (fitRetryTimer) clearTimeout(fitRetryTimer);
  resizeObserver?.disconnect();
  teardownAltRotate?.();
  teardownAltRotate = null;
  mapInstance.value?.remove();
  mapInstance.value = null;
  trackLayer.value = null;
  tileLayer.value = null;
  activeBasemap.value = null;
  basemapStatus.value = null;
});

watch(
  () => effectivePoints.value,
  () => updateTrackLayer(),
  { deep: true },
);

watch(
  () => config.value.gpx.imported,
  (v) => {
    if (v) scheduleFitTrackInView();
    else updateTrackLayer();
  },
);

watch(() => props.fitNonce, () => {
  if (config.value.gpx.imported && config.value.gpx.bounds) {
    scheduleFitTrackInView();
  }
});

watch(
  () => config.value.gpx.bounds,
  (bounds) => {
    if (config.value.gpx.imported && bounds) scheduleFitTrackInView();
  },
);

watch(
  () => [
    config.value.mapCrop.shape,
    config.value.mapCrop.lengthMm,
    config.value.mapCrop.widthMm,
    config.value.mapCrop.polygonSides,
    config.value.mapCrop.cornerRadiusMm,
    props.tray?.rimWidthMm,
  ],
  () => {
    updateMaskLayout();
  },
);

watch(
  () => [
    config.value.mapCrop.mapCenterLat,
    config.value.mapCrop.mapCenterLon,
    config.value.mapCrop.mapZoom,
    config.value.mapCrop.mapBearingDeg,
  ] as const,
  ([lat, lon, zoom, bearing]) => {
    const map = mapInstance.value;
    if (!map) return;
    const center = toMapLatLng(lat, lon);
    const current = map.getCenter();
    applyingMapView = true;
    try {
      if (typeof map.getBearing === "function" && Math.abs(map.getBearing() - bearing) > 0.05) {
        map.setBearing(bearing);
      }
      if (Math.abs(current.lat - center.lat) > 1e-8 ||
          Math.abs(current.lng - center.lng) > 1e-8 ||
          Math.abs(map.getZoom() - zoom) > 1e-8) {
        map.setView(center, zoom, { animate: false });
      }
    } finally {
      applyingMapView = false;
    }
  },
);

defineExpose({
  fitTrackInView: scheduleFitTrackInView,
  syncStoreFromMap,
  resetMapView,
});
</script>

<template>
  <div ref="mapWrap" class="map-wrap">
    <div ref="mapRoot" class="leaflet-map" />
    <p v-if="basemapStatus" class="basemap-status">{{ basemapStatus }}</p>
    <!-- 遮罩固定于屏幕；圆形/矩形用 CSS 避免 SVG 非等比拉伸导致虚线变形 -->
    <div v-if="maskGeom" class="map-mask">
      <svg
        v-if="props.gridVisible"
        class="map-grid"
        :viewBox="`0 0 ${maskW} ${maskH}`"
        aria-hidden="true"
      >
        <defs>
          <clipPath :id="gridClipId"><path :d="gridClipPath" /></clipPath>
        </defs>
        <g :clip-path="`url(#${gridClipId})`">
          <g class="map-grid__lines">
            <line v-for="x in gridLines.vertical" :key="`x-${x}`" :x1="x" :x2="x" y1="0" :y2="maskH" />
            <line v-for="y in gridLines.horizontal" :key="`y-${y}`" x1="0" :x2="maskW" :y1="y" :y2="y" />
          </g>
          <g class="map-grid__center">
            <line :x1="maskGeom.cx" :x2="maskGeom.cx" y1="0" :y2="maskH" />
            <line x1="0" :x2="maskW" :y1="maskGeom.cy" :y2="maskGeom.cy" />
          </g>
        </g>
      </svg>
      <div v-if="maskHoleStyle" class="mask-hole" :style="maskHoleStyle" />
      <div
        v-if="trayOuterStyle"
        class="mask-tray-outline"
        :style="trayOuterStyle"
      />
      <svg
        v-else-if="polygonDimPath"
        class="map-mask__svg"
        :viewBox="`0 0 ${maskW} ${maskH}`"
      >
        <path :d="polygonDimPath" fill="rgba(0,0,0,0.45)" fill-rule="evenodd" />
        <polygon
          v-if="polygonOutlinePoints"
          :points="polygonOutlinePoints"
          fill="none"
          stroke="rgba(255,255,255,0.95)"
          stroke-width="2.5"
          stroke-dasharray="10 6"
        />
        <polygon
          v-if="trayPolygonOutline"
          :points="trayPolygonOutline"
          fill="none"
          class="mask-tray-stroke"
          stroke-width="2.5"
          stroke-dasharray="8 5"
        />
      </svg>
      <div class="mask-legend">
        <span class="mask-legend__item mask-legend__item--terrain">White · {{ props.tray ? 'Terrain' : 'City' }}</span>
        <span v-if="props.tray" class="mask-legend__item mask-legend__item--tray">Yellow · Tray edge</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.map-wrap {
  position: absolute;
  inset: 0;
  isolation: isolate;
}

.leaflet-map {
  position: relative;
  z-index: 0;
  width: 100%;
  height: 100%;
  background: #1a1a2e;
}

.basemap-status {
  position: absolute;
  left: 12px;
  bottom: 28px;
  z-index: 1002;
  margin: 0;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: rgba(255, 255, 255, 0.88);
  font-size: 11px;
  pointer-events: none;
}

.map-mask {
  position: absolute;
  inset: 0;
  z-index: 1000;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: hidden;
}

.map-grid {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 3;
  pointer-events: none;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.65));
}

.map-grid__lines {
  stroke: rgba(255, 255, 255, 0.4);
  stroke-width: 1;
}

.map-grid__center {
  stroke: rgba(255, 255, 255, 0.85);
  stroke-width: 1.5;
  stroke-dasharray: 6 4;
}

.mask-hole {
  position: absolute;
  box-sizing: border-box;
  border: 2.5px dashed rgba(255, 255, 255, 0.95);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
  z-index: 2;
}

.mask-tray-outline {
  position: absolute;
  box-sizing: border-box;
  border: 2.5px dashed rgba(255, 193, 7, 0.95);
  pointer-events: none;
  z-index: 1;
}

:deep(.mask-tray-stroke) {
  stroke: rgba(255, 193, 7, 0.95);
}

.mask-legend {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.5);
  pointer-events: none;
}

.mask-legend__item {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.85);
}

.mask-legend__item--terrain::before {
  content: "";
  display: inline-block;
  width: 10px;
  height: 0;
  margin-right: 6px;
  border-top: 2px dashed rgba(255, 255, 255, 0.95);
  vertical-align: middle;
}

.mask-legend__item--tray::before {
  content: "";
  display: inline-block;
  width: 10px;
  height: 0;
  margin-right: 6px;
  border-top: 2px dashed rgba(255, 193, 7, 0.95);
  vertical-align: middle;
}

.map-mask__svg {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}

:deep(.leaflet-control-attribution) {
  z-index: 1001;
  font-size: 10px;
  background: rgba(255, 255, 255, 0.75);
  border-radius: 4px 0 0 0;
  margin: 0 !important;
}
</style>
