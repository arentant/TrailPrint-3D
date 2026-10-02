import type { AppConfig } from "./config.js";
import type { SprayPaintPlan } from "./spray-paint.js";

export const STL_FILE_NAMES = {
  terrainMain: "Terrain_Main.stl",
  trailLine: "Trail_Line.stl",
  trayBase: "Tray_Base.stl",
  trayCover: "Tray_Cover.stl",
  moldMaster: "Mold_Master.stl",
  moldLid: "Mold_Lid.stl",
} as const;

export type ExportPhase =
  | "validate"
  | "terrain"
  | "tray"
  | "stl"
  | "masks"
  | "zip"
  | "save"
  | "done";

export type ExportTarget = "all" | "trail";

export interface ExportGenerateRequest {
  config: AppConfig;
  viewportWidth: number;
  viewportHeight: number;
  /** Defaults to the complete ZIP; trail downloads a standalone STL. */
  target?: ExportTarget;
  /** 预览已分色时传入，避免导出时重复分色 */
  sprayPaintPlan?: SprayPaintPlan | null;
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
