import type { ManifoldToplevel } from 'manifold-3d';
import { join } from 'node:path';
let runtime: Promise<ManifoldToplevel> | undefined;
export function getManifold(): Promise<ManifoldToplevel> {
  return runtime ??= import('manifold-3d').then(async ({ default: Module }) => {
    const module = await Module(typeof __dirname === 'string' ? { locateFile: () => join(__dirname, 'manifold.wasm') } : undefined);
    module.setup();
    return module;
  }).catch((error) => { runtime = undefined; throw error; });
}
