<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, useId, watch } from "vue";
import L from "leaflet";
import "leaflet-rotate";
import MapRotationControls from './MapRotationControls.vue';
import ModelColorControls from '@/components/ui/ModelColorControls.vue';
import type { WaterReviewFeature } from '@/stores/water';
import type { ModelColors } from '@shared/types/model-colors';
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
import { cropSelectionFrame } from '@shared/utils/crop-selection';
import { maskBoundaryPoints } from '@shared/utils/crop-region';
import { containerPointToLatLng, latLngToCrsPoint, crsPointToLatLng } from '@shared/utils/leaflet-projection';
import { gcj02ToWgs84, wgs84ToGcj02 } from "@shared/utils/geo-coord";
import {
  type BasemapSpec,
  resolveBasemap,
} from "@/utils/basemap-tiles";

import type { MapCropConfig, GpxState, GpxPoint, TrayConfig } from '@shared/types/config';
const props = defineProps<{
  crop: MapCropConfig;
  colors: ModelColors;
  gpx: GpxState;
  points: GpxPoint[];
  segments?: GpxPoint[][];
  tray?: TrayConfig;
  trayToleranceMm?: number;
  fitNonce: number;
  gridVisible?: boolean;
  restoreView?: boolean;
  waterReview?: WaterReviewFeature[];
}>();
const emit = defineEmits<{
  'update:crop': [crop: MapCropConfig];
  'update:colors': [colors: ModelColors];
  viewport: [value: { w: number; h: number }];
  ready: [value: boolean];
  toggleWater: [featureId: string];
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
let waterLayer: L.LayerGroup | undefined;
let includedWaterLayers: L.GeoJSON[] = [];

function updateWaterColor(color: string): void {
  for (const layer of includedWaterLayers) layer.setStyle({ color, fillColor: color });
}

function updateWaterLayer(): void {
  const map = mapInstance.value;
  if (!map) return;
  waterLayer?.remove();
  waterLayer = L.layerGroup().addTo(map);
  includedWaterLayers = [];
  for (const item of props.waterReview ?? []) {
    if (!item.geometry.coordinates.length || ['covered', 'outside-crop', 'incomplete'].includes(item.status.state)) continue;
    const included = item.status.state === 'included';
    const color = included ? props.colors.water : item.status.state === 'too-small' ? '#c78925' : '#687b86';
    const geojson = { type: 'Feature' as const, properties: {}, geometry: item.geometry };
    const layer = L.geoJSON(geojson, {
      coordsToLatLng: ([lon, lat]) => toMapLatLng(lat, lon),
      style: { color, fillColor: color, fillOpacity: included ? .45 : .12, weight: 2, dashArray: included ? undefined : '5 4', fillRule: 'evenodd' },
    });
    const label = document.createElement('span');
    const selectable = ['included', 'excluded', 'too-small'].includes(item.status.state);
    const status = item.status.state === 'included' ? 'Kept · Click to hide' : item.status.state === 'excluded' ? 'Hidden · Click to keep' : item.status.state.replaceAll('-', ' ');
    label.textContent = `${item.feature.name} · ${status}${item.status.exaggerated ? ' · Exaggerated' : ''}`;
    layer.bindTooltip(label);
    if (selectable) layer.on('click', () => emit('toggleWater', item.feature.id));
    waterLayer.addLayer(layer);
    if (included) includedWaterLayers.push(layer);
  }
  trackLayer.value?.bringToFront();
}
/** 当前底图；GCJ 瓦片时地图交互坐标需转换 */
const activeBasemap = shallowRef<BasemapSpec | null>(null);
const basemapStatus = ref<string | null>(null);
const gridClipId = useId();
let applyingMapView = false;
const shapeHandles = ref<{ center: { x: number; y: number }; resize: { x: number; y: number } } | null>(null);
const shapeSelected = computed(() => !!props.crop.selection);

function polygonPath(points: Array<{ x: number; y: number }>): string {
  return points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ') + ' Z';
}

function projectSelectionPoint(x: number, y: number): L.Point {
  const frame = cropSelectionFrame(props.crop, maskW.value, maskH.value);
  const geo = containerPointToLatLng(x, y, frame.mapCrop, frame.width, frame.height);
  return mapInstance.value!.latLngToContainerPoint(toMapLatLng(geo.lat, geo.lon));
}

function projectSelectionMask(mask: MaskScreenGeometry): MaskScreenGeometry {
  const center = projectSelectionPoint(mask.cx, mask.cy);
  return { kind: 'polygon', cx: center.x, cy: center.y,
    vertices: maskBoundaryPoints(mask, 128).map(p => projectSelectionPoint(p.x, p.y)) };
}

const gridClipPath = computed(() =>
  shapeSelected.value && maskGeom.value?.vertices ? polygonPath(maskGeom.value.vertices) : maskHoleOutlinePath(config.value.mapCrop, maskW.value, maskH.value),
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
  if (shapeSelected.value && mapInstance.value) {
    const frame = cropSelectionFrame(props.crop, w, h);
    const source = buildMaskGeometry(frame.mapCrop, frame.width, frame.height);
    maskGeom.value = projectSelectionMask(source);
    const corner = maskBoundaryPoints(source, 128).reduce((best, point) => point.x > best.x ? point : best);
    shapeHandles.value = { center: projectSelectionPoint(source.cx, source.cy), resize: projectSelectionPoint(corner.x, corner.y) };
  } else {
    maskGeom.value = buildMaskGeometry(config.value.mapCrop, w, h);
    shapeHandles.value = null;
  }
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
  if (shapeSelected.value) return `M 0 0 H ${maskW.value} V ${maskH.value} H 0 Z ${polygonPath(maskGeom.value.vertices!)}`;
  return maskEvenOddPath(config.value.mapCrop, maskW.value, maskH.value);
});

const polygonOutlinePoints = computed(() => {
  const verts = maskGeom.value?.vertices;
  if (!verts?.length) return "";
  return maskPolygonPoints(verts);
});

const trayOverlay = computed(() => {
  if (!props.tray?.enabled || maskW.value < 1 || maskH.value < 1) return null;
  if (shapeSelected.value && mapInstance.value) {
    // maskGeom tracks camera movement so the tray projection updates with it.
    void maskGeom.value;
    const frame = cropSelectionFrame(props.crop, maskW.value, maskH.value);
    const source = buildTrayMaskOverlay(frame.mapCrop, props.tray, frame.width, frame.height, props.trayToleranceMm);
    return source ? { ...source, outer: projectSelectionMask(source.outer) } : null;
  }
  return buildTrayMaskOverlay(
    config.value.mapCrop,
    props.tray,
    maskW.value,
    maskH.value,
    props.trayToleranceMm,
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

function placeShapeHere(): void {
  const map = mapInstance.value;
  if (!map || maskW.value < 64 || maskH.value < 64) return;
  const center = map.getCenter(), wgs = fromMapLatLng(center.lat, center.lng);
  const pose = { mapCenterLat: wgs.lat, mapCenterLon: wgs.lon, mapZoom: map.getZoom(), mapBearingDeg: map.getBearing() };
  emit('update:crop', { ...props.crop, ...pose, mapPaneX: 0, mapPaneY: 0,
    selection: { ...pose, viewportWidth: maskW.value, viewportHeight: maskH.value } });
}

function showShape(): void {
  const map = mapInstance.value;
  if (!map || !props.crop.selection) return;
  const frame = cropSelectionFrame(props.crop, maskW.value, maskH.value);
  const mask = buildMaskGeometry(frame.mapCrop, frame.width, frame.height);
  const points = maskBoundaryPoints(mask, 128).map(p => {
    const geo = containerPointToLatLng(p.x, p.y, frame.mapCrop, frame.width, frame.height);
    return toMapLatLng(geo.lat, geo.lon);
  });
  map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 19, animate: false });
}

function resizeShape(delta: number): void {
  const selected = props.crop.selection;
  if (selected) emit('update:crop', { ...props.crop, selection: { ...selected, mapZoom: Math.max(1, Math.min(22, selected.mapZoom + delta)) } });
}

let shapeDrag: { action: 'move' | 'resize'; selection: NonNullable<MapCropConfig['selection']>; start: { x: number; y: number }; distance: number; target: HTMLElement; dragging: boolean } | undefined;
function startShapeDrag(event: PointerEvent, action: 'move' | 'resize'): void {
  const map = mapInstance.value, selected = props.crop.selection;
  if (!map || !selected || !shapeHandles.value || event.button !== 0) return;
  event.preventDefault(); event.stopPropagation();
  const target = event.currentTarget as HTMLElement;
  const latlng = map.mouseEventToLatLng(event), geo = fromMapLatLng(latlng.lat, latlng.lng);
  const screen = map.mouseEventToContainerPoint(event);
  shapeDrag = { action, selection: { ...selected }, start: latLngToCrsPoint(geo.lat, geo.lon, 0),
    distance: Math.max(1, screen.distanceTo(L.point(shapeHandles.value.center.x, shapeHandles.value.center.y))), target, dragging: map.dragging.enabled() };
  map.dragging.disable(); target.setPointerCapture(event.pointerId);
}
function moveShapeDrag(event: PointerEvent): void {
  const map = mapInstance.value, drag = shapeDrag;
  if (!map || !drag || !shapeHandles.value) return;
  event.preventDefault(); event.stopPropagation();
  let selected = { ...drag.selection };
  if (drag.action === 'move') {
    const latlng = map.mouseEventToLatLng(event), geo = fromMapLatLng(latlng.lat, latlng.lng);
    const now = latLngToCrsPoint(geo.lat, geo.lon, 0), center = latLngToCrsPoint(selected.mapCenterLat, selected.mapCenterLon, 0);
    const next = crsPointToLatLng(center.x + now.x - drag.start.x, center.y + now.y - drag.start.y, 0);
    selected = { ...selected, mapCenterLat: next.lat, mapCenterLon: next.lon };
  } else {
    const distance = map.mouseEventToContainerPoint(event).distanceTo(L.point(shapeHandles.value.center.x, shapeHandles.value.center.y));
    selected.mapZoom = Math.max(1, Math.min(22, drag.selection.mapZoom - Math.log2(Math.max(distance, 1) / drag.distance)));
  }
  emit('update:crop', { ...props.crop, selection: selected });
}
function endShapeDrag(event: PointerEvent): void {
  if (!shapeDrag) return;
  if (shapeDrag.target.hasPointerCapture(event.pointerId)) shapeDrag.target.releasePointerCapture(event.pointerId);
  if (shapeDrag.dragging) mapInstance.value?.dragging.enable();
  shapeDrag = undefined;
}
function moveShapeByKey(event: KeyboardEvent): void {
  const offsets: Record<string, [number, number]> = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] };
  const delta = offsets[event.key], map = mapInstance.value, selected = props.crop.selection;
  if (!delta || !map || !selected || !shapeHandles.value) return;
  event.preventDefault(); event.stopPropagation();
  const center = shapeHandles.value.center;
  const point = map.containerPointToLatLng(L.point(center.x + delta[0], center.y + delta[1]));
  const next = fromMapLatLng(point.lat, point.lng);
  emit('update:crop', { ...props.crop, selection: { ...selected, mapCenterLat: next.lat, mapCenterLon: next.lon } });
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
  trackLayer.value = L.polyline(latlngs, { ...TRACK_STYLE, color: props.colors.trail }).addTo(map);
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
  if (!props.crop.selection) placeShapeHere();
  updateTrackLayer();

  updateWaterLayer();
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

function setMapBearing(bearing: number): void {
  const map = mapInstance.value;
  if (!map || !Number.isFinite(bearing)) return;
  map.setBearing(bearing);
  syncStoreFromMap();
}

function resetMapView(): void {
  if (!mapInstance.value) return;
  setMapBearing(0);

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
    if (target.closest(".leaflet-control, .crop-handle")) return;

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
    minZoom: 1,
    attributionControl: true,
    zoomSnap: ZOOM_SNAP,
    zoomDelta: .5,
    wheelPxPerZoomLevel: WHEEL_PX_PER_ZOOM_LEVEL,
    wheelDebounceTime: 60,
    rotate: true,
    bearing: mapBearingDeg ?? 0,
    touchRotate: true,
    shiftKeyRotate: true,
    rotateControl: false,
  });

  attachBasemap(map, spec);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  map.on("moveend", syncStoreFromMap);
  map.on("zoomend", syncStoreFromMap);
  map.on("rotate", syncStoreFromMap);
  map.on("rotateend", syncStoreFromMap);
  map.on('move zoom rotate', updateMaskLayout);

  teardownAltRotate = setupAltDragRotate(map, el);

  mapInstance.value = map;
  updateWaterLayer();
  syncStoreFromMap();
  updateMaskLayout();
  map.invalidateSize({ animate: false });
  updateTrackLayer();

  if (props.fitNonce !== initialFitNonce && props.gpx.imported) scheduleFitTrackInView();
  else if (!props.crop.selection) placeShapeHere();

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
  waterLayer = undefined;
  includedWaterLayers = [];
});

watch(
  () => effectivePoints.value,
  () => updateTrackLayer(),
  { deep: true },
);

watch(() => props.colors.trail, (color) => trackLayer.value?.setStyle({ color }));
// Review geometry is replaced as a whole. Palette edits only restyle existing
// paths, avoiding expensive reprojection and SVG rebuilding for detailed water.
watch(() => props.waterReview, updateWaterLayer);
watch(() => props.colors.water, updateWaterColor);

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
    config.value.mapCrop.selection,
    props.tray?.rimWidthMm,
  ],
  () => {
    updateMaskLayout();
  },
  { deep: true },
);

watch(() => props.crop.selection, (selected, previous) => {
  if (!selected && previous && !props.gpx.imported) requestAnimationFrame(() => {
    if (!props.crop.selection) placeShapeHere();
  });
});

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
    <div class="map-controls">
      <MapRotationControls :bearing="crop.mapBearingDeg" :disabled="!mapInstance"
        @update:bearing="setMapBearing" />
      <div class="shape-controls" role="group" aria-label="Crop shape controls">
        <strong>Shape on map</strong>
        <p>Zoom and pan freely. Drag the center to move the shape, or its edge handle to resize.</p>
        <div class="shape-controls__row">
          <button type="button" :disabled="!mapInstance" @click="placeShapeHere">Place shape here</button>
          <button type="button" :disabled="!shapeSelected" @click="showShape">Show shape</button>
        </div>
        <div class="shape-controls__row">
          <button type="button" :disabled="!shapeSelected" @click="resizeShape(.25)">Smaller shape</button>
          <button type="button" :disabled="!shapeSelected" @click="resizeShape(-.25)">Larger shape</button>
        </div>
      </div>
      <details class="map-colors">
        <summary>
          <span>Colors</span>
          <span class="map-colors__swatches" aria-hidden="true">
            <i :style="{ backgroundColor: colors.trail }" />
            <i :style="{ backgroundColor: colors.terrain }" />
            <i v-if="tray?.enabled" :style="{ backgroundColor: colors.tray }" />
            <i v-if="tray?.enabled && tray.text.enabled" :style="{ backgroundColor: colors.text }" />
          </span>
        </summary>
        <ModelColorControls :model-value="colors" :workspace="tray ? 'mountain' : 'city'"
          :show-tray="!!tray?.enabled" :show-text="!!tray?.enabled && tray.text.enabled" :show-water="!!waterReview?.length" @update:model-value="emit('update:colors', $event)" />
      </details>
    </div>
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
        v-else-if="polygonDimPath || trayPolygonOutline"
        class="map-mask__svg"
        :viewBox="`0 0 ${maskW} ${maskH}`"
      >
        <path :d="polygonDimPath" fill="rgba(0,0,0,0.45)" fill-rule="evenodd" />
        <polygon
          v-if="polygonOutlinePoints"
          class="crop-shape-outline"
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
      <template v-if="shapeHandles">
        <button type="button" class="crop-handle crop-handle--move" aria-label="Move crop shape" title="Drag to move the shape. Arrow keys move it on the map."
          :style="{ left: `${shapeHandles.center.x}px`, top: `${shapeHandles.center.y}px` }"
          @pointerdown="startShapeDrag($event, 'move')" @pointermove="moveShapeDrag" @pointerup="endShapeDrag" @pointercancel="endShapeDrag" @keydown="moveShapeByKey">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/></svg>
        </button>
        <button type="button" class="crop-handle crop-handle--resize" aria-label="Resize crop shape" title="Drag to resize the selected area. Use Smaller shape or Larger shape for keyboard control."
          :style="{ left: `${shapeHandles.resize.x}px`, top: `${shapeHandles.resize.y}px` }"
          @pointerdown="startShapeDrag($event, 'resize')" @pointermove="moveShapeDrag" @pointerup="endShapeDrag" @pointercancel="endShapeDrag">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 4h6M4 4v6M4 4l16 16M20 20h-6M20 20v-6"/></svg>
        </button>
      </template>
      <div class="mask-legend">
        <span class="mask-legend__item mask-legend__item--terrain">White · {{ props.tray ? 'Terrain' : 'City' }}</span>
        <span v-if="props.tray?.enabled" class="mask-legend__item mask-legend__item--tray">Yellow · Tray edge</span>
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

.map-controls {
  position: absolute;
  top: 72px;
  left: 16px;
  z-index: 1001;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 224px;
  max-width: calc(100% - 32px);
}

.map-colors {
  padding: 0 12px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  color: var(--tp-text-primary);
}

.map-colors summary { display: flex; align-items: center; gap: 8px; min-height: 40px; font-size: 12px; font-weight: 600; cursor: pointer; list-style: none; }
.map-colors summary::-webkit-details-marker { display: none; }
.map-colors summary::after { content: '+'; margin-left: auto; font-size: 16px; color: var(--tp-text-secondary); }
.map-colors[open] summary::after { content: '−'; }
.map-colors[open] { padding-bottom: 12px; }
.map-colors summary:focus-visible { outline: 2px solid var(--tp-text-accent); outline-offset: 2px; border-radius: 4px; }
.map-colors__swatches { display: flex; gap: 3px; }
.map-colors__swatches i { width: 12px; height: 12px; border-radius: 50%; border: 1px solid rgba(0, 0, 0, 0.12); }

.shape-controls { padding: 10px 12px; border: 1px solid rgba(0, 0, 0, .08); border-radius: 10px; background: rgba(255, 255, 255, .94); box-shadow: 0 2px 10px rgba(0, 0, 0, .12); color: var(--tp-text-primary); }
.shape-controls strong { font-size: 12px; }
.shape-controls p { margin: 6px 0 8px; font-size: 11px; line-height: 1.45; color: var(--tp-text-secondary); }
.shape-controls__row { display: flex; gap: 6px; }
.shape-controls__row + .shape-controls__row { margin-top: 6px; }
.shape-controls button { flex: 1; padding: 7px 3px; border-radius: 6px; background: var(--tp-bg-input); font-size: 11px; cursor: pointer; }
.shape-controls button:disabled { opacity: .45; cursor: default; }
.shape-controls button:focus-visible, .crop-handle:focus-visible { outline: 2px solid var(--tp-text-accent); outline-offset: 2px; }
.crop-handle { position: absolute; z-index: 4; width: 30px; height: 30px; padding: 0; display: grid; place-items: center; transform: translate(-50%, -50%); border: 2px solid #fff; border-radius: 50%; background: #fff; color: #263e50; box-shadow: 0 1px 6px rgba(0, 0, 0, .4); pointer-events: auto; touch-action: none; }
.crop-handle--move { cursor: move; }
.crop-handle--resize { cursor: nwse-resize; }

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
