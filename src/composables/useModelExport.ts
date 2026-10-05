import { storeToRefs } from "pinia";
import { useUiStore } from "@/stores/ui";
import { formatIpcError, ipcGenerateExport } from "@/ipc/client";
import type { ExportGenerateRequest, ExportGenerateResponse } from "@shared/types/export";

export interface ModelExportController<Options, Request extends ExportGenerateRequest> {
  /** Validate inputs and prepare a serializable request for this model flow. */
  prepareRequest(options: Options): Request;
  describeSuccess(response: ExportGenerateResponse, request: Request): string;
}

/** Common export lifecycle; input validation and model settings belong to a flow. */
export function useModelExport<Options, Request extends ExportGenerateRequest>(controller: ModelExportController<Options, Request>) {
  const ui = useUiStore();
  const { generating, statusMessage } = storeToRefs(ui);

  async function generateAndSave(options: Options): Promise<void> {
    if (generating.value) return;
    generating.value = true;
    ui.exportProgress = 0;
    try {
      ui.runPrepareExport();
      const request = controller.prepareRequest(options);
      statusMessage.value = "Preparing export…";
      const response = await ipcGenerateExport(request);
      if (response.cancelled) {
        statusMessage.value = "Export canceled. Choose Download again and select a save location.";
      } else if (response.savedPath) {
        ui.lastExportPath = response.savedPath;
        statusMessage.value = controller.describeSuccess(response, request);
      }
    } catch (error) {
      statusMessage.value = formatIpcError(error);
    } finally {
      generating.value = false;
      ui.exportProgress = 0;
    }
  }

  return { generateAndSave, generating };
}
