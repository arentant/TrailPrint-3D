import { writeFile } from "fs/promises";
import type { AppConfig } from "@shared/types/config";
import type { SprayPaintPlan } from "@shared/types/spray-paint";
import { buildSprayPaintManifest } from "@shared/utils/spray-manifest";
export * from "@shared/utils/spray-manifest";

export async function writeSprayPaintManifest(filePath: string, config: AppConfig, plan: SprayPaintPlan): Promise<void> {
  const manifest = await buildSprayPaintManifest(config, plan);
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
