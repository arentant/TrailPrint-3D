import { DEFAULT_MODEL_FLOW, type ExportGenerateRequest } from "@shared/types/export";
import { createExportPipeline, type ExportFlowRegistry } from "@shared/export/export-pipeline";
import { mountainTrailExportFlow } from "./mountain-trail-flow";

/** Shared by Electron and the browser worker. Register new model flows here. */
const exportFlows: ExportFlowRegistry<ExportGenerateRequest> = {
  "mountain-trail": mountainTrailExportFlow,
};

export const generateExportBundle = createExportPipeline<ExportGenerateRequest>(
  exportFlows,
  DEFAULT_MODEL_FLOW,
);
