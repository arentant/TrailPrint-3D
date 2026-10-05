import type { MapModelConfig, MountainTrailConfig } from "./config.js";
import type { SprayPaintPlan } from "./spray-paint.js";
import type { CityMapConfig } from "./city.js";

export const STL_FILE_NAMES = {
  cityMain: "City_Main.stl",
  terrainMain: "Terrain_Main.stl",
  trailLine: "Trail_Line.stl",
  trayBase: "Tray_Base.stl",
  trayCover: "Tray_Cover.stl",
  moldMaster: "Mold_Master.stl",
  moldLid: "Mold_Lid.stl",
} as const;

export type ExportPhase =
  | "validate"
  | "model"
  | "terrain"
  | "tray"
  | "stl"
  | "masks"
  | "zip"
  | "save"
  | "done";

export type ExportTarget = "all" | "trail";

export interface MapModelExportRequest<Config extends MapModelConfig> {
  config: Config;
  viewportWidth: number;
  viewportHeight: number;
}

export interface MountainTrailExportRequest extends MapModelExportRequest<MountainTrailConfig> {
  /** Omitted by older callers; resolves to the mountain trail flow. */
  flow?: "mountain-trail";
  /** Defaults to the complete ZIP; trail downloads a standalone STL. */
  target?: ExportTarget;
  /** 预览已分色时传入，避免导出时重复分色 */
  sprayPaintPlan?: SprayPaintPlan | null;
}

/** Add each implemented flow's request here to extend IPC and worker typing. */
export interface ExportRequestMap {
  "mountain-trail": MountainTrailExportRequest;
  "city-map": CityMapExportRequest;
}

export interface CityMapExportRequest extends MapModelExportRequest<CityMapConfig> {
  flow: "city-map";
}

export type ModelFlowId = keyof ExportRequestMap;
export const DEFAULT_MODEL_FLOW: ModelFlowId = "mountain-trail";
export type ExportGenerateRequest = ExportRequestMap[ModelFlowId];

export type ExportProgressCallback = (progress: ExportProgress) => void;
export type ExportFileSink = (name: string, data: Uint8Array) => Promise<void> | void;

/** Delivery metadata belongs to a flow, not to a browser or desktop adapter. */
export interface ExportArtifact {
  kind: "file" | "zip";
  fileName: string;
  extension: string;
  mimeType: string;
  saveDialogTitle: string;
}

export interface ExportBundle {
  artifact: ExportArtifact;
  fileNames: string[];
}

export interface ModelExportFlow<Request> {
  describeArtifact(request: Request): ExportArtifact;
  generateFiles(request: Request, onProgress: ExportProgressCallback, onFile: ExportFileSink): Promise<void>;
}

export interface ExportProgress {
  phase: ExportPhase;
  /** 0–1 */
  progress: number;
  message: string;
}

export interface ExportGenerateResponse {
  /** 用户选择保存的路径；取消时为 undefined */
  savedPath?: string;
  cancelled: boolean;
  generationMs: number;
}
