import { copyFile, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";
import { dialog, shell, type BrowserWindow } from "electron";
import { STL_FILE_NAMES, type ExportGenerateRequest, type ExportGenerateResponse } from "@shared/types/export";
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
  const trailOnly = req.target === "trail";
  const workDir = await mkdtemp(join(tmpdir(), "trailprint-export-"));
  const zipTempPath = join(workDir, "bundle.zip");
  try {
    const names = await generateModelFiles(req, onProgress, async (name, data) => {
      if (basename(name) !== name || name.includes("\\")) throw new Error("Invalid export filename");
      await writeFile(join(workDir, name), data);
    });
    if (!trailOnly) {
      const zipEntries = names.map((name) => ({ name, filePath: join(workDir, name) }));
      onProgress({
        phase: "zip",
        progress: 0.78,
        message: "Creating ZIP archive…",
      });
      await packZip(zipTempPath, zipEntries);
    }

    onProgress({
      phase: "save",
      progress: 0.9,
      message: "Choose a save location…",
    });

    const saveOptions = {
      title: trailOnly ? "Save trail STL" : "Save TrailPrint STL archive",
      defaultPath: trailOnly ? STL_FILE_NAMES.trailLine : defaultZipName(),
      filters: trailOnly
        ? [{ name: "STL model", extensions: ["stl"] }]
        : [{ name: "ZIP archive", extensions: ["zip"] }],
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

    const extension = trailOnly ? ".stl" : ".zip";
    const dest = filePath.toLowerCase().endsWith(extension) ? filePath : `${filePath}${extension}`;
    await copyFile(trailOnly ? join(workDir, STL_FILE_NAMES.trailLine) : zipTempPath, dest);

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
