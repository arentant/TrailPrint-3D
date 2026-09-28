import { copyFile, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";
import { dialog, shell, type BrowserWindow } from "electron";
import type { ExportGenerateRequest, ExportGenerateResponse } from "@shared/types/export";
import { IpcException } from "@shared/ipc/types";
import { packZip } from "./zip-packager";
import { generateModelFiles, defaultZipName, type ExportProgressCallback } from "./generate-model-files";
export type { ExportProgressCallback } from "./generate-model-files";

export function revealExportZip(zipPath: string): void {
  if (!zipPath.trim()) throw new IpcException("INVALID_PATH", "Invalid file path");
  shell.showItemInFolder(zipPath);
}

export async function generateModelsZip(req: ExportGenerateRequest, onProgress: ExportProgressCallback, browserWindow?: BrowserWindow | null): Promise<ExportGenerateResponse> {
  const started = Date.now();
  const workDir = await mkdtemp(join(tmpdir(), "trailprint-export-"));
  const zipTempPath = join(workDir, "bundle.zip");
  try {
    const names = await generateModelFiles(req, onProgress, async (name, data) => {
      if (basename(name) !== name || name.includes("\\")) throw new Error("Invalid export filename");
      await writeFile(join(workDir, name), data);
    });
    const zipEntries = names.map((name) => ({ name, filePath: join(workDir, name) }));
    onProgress({
      phase: "zip",
      progress: 0.78,
      message: "Creating ZIP archive…",
    });

    await packZip(zipTempPath, zipEntries);

    onProgress({
      phase: "save",
      progress: 0.9,
      message: "Choose a save location…",
    });

    const saveOptions = {
      title: "Save TrailPrint STL archive",
      defaultPath: defaultZipName(),
      filters: [{ name: "ZIP archive", extensions: ["zip"] }],
    };
    const { canceled, filePath } = browserWindow
      ? await dialog.showSaveDialog(browserWindow, saveOptions)
      : await dialog.showSaveDialog(saveOptions);

    if (canceled || !filePath) {
      onProgress({
        phase: "done",
        progress: 1,
        message: "Save canceled",
      });
      return {
        cancelled: true,
        generationMs: Date.now() - started,
      };
    }

    const dest = filePath.endsWith(".zip") ? filePath : `${filePath}.zip`;
    await copyFile(zipTempPath, dest);

    shell.showItemInFolder(dest);

    const fileName = basename(dest);
    onProgress({
      phase: "done",
      progress: 1,
      message: `Saved ${fileName}; shown in your file manager`,
    });

    return {
      savedPath: dest,
      cancelled: false,
      generationMs: Date.now() - started,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
