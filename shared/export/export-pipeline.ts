import { IpcException } from "../ipc/types.js";
import type {
  ExportBundle,
  ExportFileSink,
  ExportProgressCallback,
  ModelExportFlow,
} from "../types/export.js";

export type ExportFlowRegistry<Request extends { flow?: string }> = {
  [Id in NonNullable<Request["flow"]>]: ModelExportFlow<Extract<Request, { flow?: Id }>>;
};

/** Routes model generation without knowing any flow's config, input data or targets. */
export function createExportPipeline<Request extends { flow?: string }>(
  flows: ExportFlowRegistry<Request>,
  defaultFlow: NonNullable<Request["flow"]>,
) {
  return async (
    request: Request,
    onProgress: ExportProgressCallback,
    onFile: ExportFileSink,
  ): Promise<ExportBundle> => {
    const flowId = request.flow ?? defaultFlow;
    if (!Object.prototype.hasOwnProperty.call(flows, flowId)) {
      throw new IpcException("EXPORT_FLOW_UNSUPPORTED", `Unsupported model export flow: ${flowId}`);
    }
    // The runtime key selects the corresponding request variant; TypeScript
    // cannot retain that correlation when indexing a mapped registry.
    const flow = flows[flowId as NonNullable<Request["flow"]>] as ModelExportFlow<Request>;
    const artifact = flow.describeArtifact(request);
    const fileNames: string[] = [];
    const emittedNames = new Set<string>();
    await flow.generateFiles(request, onProgress, async (name, data) => {
      if (!name || name === "." || name === ".." || /[/\\\0]/.test(name)) {
        throw new IpcException("EXPORT_FILE_INVALID", "Invalid export filename");
      }
      if (emittedNames.has(name)) {
        throw new IpcException("EXPORT_FILE_DUPLICATE", `Duplicate export filename: ${name}`);
      }
      emittedNames.add(name);
      fileNames.push(name);
      await onFile(name, data);
    });
    if (fileNames.length === 0 || (artifact.kind === "file" &&
      (fileNames.length !== 1 || fileNames[0] !== artifact.fileName))) {
      throw new IpcException("EXPORT_OUTPUT_INVALID", "The model flow did not produce the expected export files");
    }
    return { artifact, fileNames };
  };
}
