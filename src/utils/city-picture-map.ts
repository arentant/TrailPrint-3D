import { cityPictureMapPlan, CITY_PICTURE_STYLE, MAX_PICTURE_PIXELS, MAX_PICTURE_BYTES, type CityPictureMap } from '@shared/city/picture-map';
import type { CityGenerateRequest } from '@shared/types/city';
import type { Map as LibreMap } from 'maplibre-gl';

// Retain at most two backgrounds. No renderer/WebGL contexts survive a job.
const cache = new Map<string, CityPictureMap>();
let queue = Promise.resolve();

export function loadCityPictureMap(request: CityGenerateRequest, onProgress?: (complete: number, total: number) => void,
  dpi?: number, signal?: AbortSignal): Promise<CityPictureMap> {
  const plan = cityPictureMapPlan(request, dpi);
  // Keep style revisions local to this cache, out of the shared export identity.
  const cacheKey = JSON.stringify([plan.key, 'no-street-labels']);
  const job = queue.then(async () => {
    signal?.throwIfAborted();
    const hit = cache.get(cacheKey);
    if (hit) { onProgress?.(3, 3); return hit; }
    onProgress?.(0, 3);
    const [libre, { default: workerUrl }] = await Promise.all([
      import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
    ]);
    signal?.throwIfAborted();
    libre.setWorkerUrl(workerUrl);
    const container = document.createElement('div');
    container.setAttribute('aria-hidden', 'true');
    // Keep a laid-out viewport without adding scrollbars or covering the editor.
    container.style.cssText = `position:fixed;left:0;top:0;width:${plan.width}px;height:${plan.height}px;visibility:hidden;pointer-events:none;contain:strict;`;
    document.body.append(container);
    let map: LibreMap | undefined;
    try {
      map = new libre.Map({
        container, center: plan.center, zoom: plan.zoom,
        bearing: 0, pitch: 0, maxZoom: 24,
        interactive: false, attributionControl: false, renderWorldCopies: false,
        trackResize: false, fadeDuration: 0, pixelRatio: plan.pixelRatio,
        maxCanvasSize: [MAX_PICTURE_PIXELS, MAX_PICTURE_PIXELS],
        canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
      });
      const renderer = map;
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearTimeout(timer); signal?.removeEventListener('abort', abort);
          renderer.off('idle', ready); renderer.off('error', failed); renderer.off('webglcontextlost', lost);
          error ? reject(error) : resolve();
        };
        const ready = () => finish();
        const failed = (event: { error: { message: string } }) => finish(new Error(`Could not load the OpenFreeMap map: ${event.error.message}. Try again.`));
        const lost = () => finish(new Error('Map graphics were interrupted. Close other previews and try again.'));
        const abort = () => finish(new DOMException('Map rendering cancelled', 'AbortError'));
        const timer = setTimeout(() => finish(new Error('The street map took too long to load. Check your connection and try again.')), 60_000);
        renderer.on('idle', ready); renderer.on('error', failed); renderer.on('webglcontextlost', lost);
        signal?.addEventListener('abort', abort, { once: true });
        renderer.once('load', () => onProgress?.(1, 3));
        if (signal?.aborted) abort();
        else renderer.setStyle(CITY_PICTURE_STYLE, {
          transformStyle: (_previous, next) => ({
            ...next,
            projection: { type: 'mercator' },
            // Hide street names and road shields without changing road geometry or place labels.
            layers: next.layers.filter(layer => !(layer.type === 'symbol' && layer['source-layer'] === 'transportation_name')),
          }),
        });
      });
      signal?.throwIfAborted();
      onProgress?.(2, 3);
      const canvas = map.getCanvas();
      const gl = canvas.getContext('webgl2');
      if (canvas.width !== plan.pixelWidth || canvas.height !== plan.pixelHeight || !gl || gl.isContextLost() ||
          gl.drawingBufferWidth !== plan.pixelWidth || gl.drawingBufferHeight !== plan.pixelHeight) {
        throw new Error('This device cannot render the map at the requested print resolution. Choose a smaller print size.');
      }
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not encode the map picture.')), 'image/png'));
      if (blob.size > MAX_PICTURE_BYTES) throw new Error('The map image exceeds 32 MB. Choose a smaller print size.');
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(new Error('Could not save the map picture.'));
        reader.readAsDataURL(blob);
      });
      signal?.throwIfAborted();
      const result = { bounds: plan.bounds, pixelWidth: canvas.width, pixelHeight: canvas.height, key: plan.key, dataUrl };
      cache.set(cacheKey, result);
      while (cache.size > 2) cache.delete(cache.keys().next().value!);
      onProgress?.(3, 3);
      return result;
    } finally { map?.remove(); container.remove(); }
  });
  queue = job.then(() => {}, () => {});
  return job;
}
