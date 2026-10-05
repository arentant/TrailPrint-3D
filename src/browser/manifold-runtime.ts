import Module, { type ManifoldToplevel } from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
let runtime: Promise<ManifoldToplevel> | undefined;
export function getManifold(): Promise<ManifoldToplevel> {
  return runtime ??= Module({ locateFile: () => wasmUrl }).then((module) => {
    module.setup(); return module;
  }).catch((error) => { runtime = undefined; throw error; });
}
