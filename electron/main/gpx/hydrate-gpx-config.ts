import type { GpxState } from "@shared/types";
import type { GpxImportResult } from "@shared/types/gpx";
import { getGpxSessionCache, setGpxSessionCache } from "./gpx-session-cache";
import { combineGpxFiles } from "@shared/utils/gpx-collection";
import { parseGpxFile } from "./parse-gpx";

function applyGpxResult<T extends { gpx: GpxState }>(
  config: T,
  result: GpxImportResult,
): T {
  return {
    ...config,
    gpx: {
      ...config.gpx,
      imported: true,
      importId: result.importId,
      segments: result.segments,
      points: result.points,
      rawPoints: result.points,
      bounds: result.bounds,
      pointCount: result.pointCount,
      distanceKm: result.distanceKm,
      trackName: result.trackName ?? config.gpx.trackName,
      activityDate: result.activityDate,
      elapsedSeconds: result.elapsedSeconds,
      athleteName: result.athleteName,
    },
  };
}

/**
 * 确保主进程能拿到完整 GPX 轨迹：优先用 IPC config，否则会话缓存或本机路径重读。
 */
export async function hydrateGpxConfig<T extends { gpx: GpxState }>(
  config: T,
): Promise<T> {
  if (!config.gpx.imported) return config;
  if (config.gpx.rawPoints?.length >= 2 || config.gpx.points?.length >= 2) return config;

  // A combined model must restore every source; never hydrate it from just one file.
  if (config.gpx.files?.length) {
    const files = [];
    for (const file of config.gpx.files) {
      if (file.points?.length) { files.push(file); continue; }
      let result = getGpxSessionCache(file.importId);
      if (!result && file.filePath) {
        result = await parseGpxFile(file);
        setGpxSessionCache(result);
      }
      if (!result) throw new Error(`Import ${file.fileName ?? 'your GPX file'} again to restore its track points`);
      files.push({ ...file, ...result, importId: file.importId });
    }
    return { ...config, gpx: combineGpxFiles(files) };
  }

  const cached = getGpxSessionCache(config.gpx.importId);
  if (cached && cached.points.length >= 2) {
    return applyGpxResult(config, cached);
  }

  const filePath = config.gpx.filePath?.trim();
  if (filePath) {
    const result = await parseGpxFile({
      filePath,
      importId: config.gpx.importId,
      fileName: config.gpx.fileName,
    });
    setGpxSessionCache(result);
    return applyGpxResult(config, result);
  }

  return config;
}
