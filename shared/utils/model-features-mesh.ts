import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import type { AppConfig } from '../types/config';
import type { TerrainCropRegion, TerrainMeshPayload } from '../types/terrain';
import type { Vec2 } from './tray-footprint';
import type { TrayTextShape } from './tray-text-layout';
import { buildModelTextLayout, computeModelKeychainHole } from './model-features';
import { waterMeshPayload } from '../water/mesh-payload';

/** Use the same Boolean geometry for the interactive preview, STL and 3MF. */
export function applyModelFeatures(wasm: ManifoldToplevel, config: AppConfig, crop: TerrainCropRegion,
  mesh: TerrainMeshPayload, trailMesh: TerrainMeshPayload | null, waterMeshes: TerrainMeshPayload[]) {
  const allocations = new Set<Manifold | CrossSection>();
  const own = <T extends Manifold | CrossSection>(solid: T): T => { allocations.add(solid); return solid; };
  const solid = (payload: TerrainMeshPayload) => {
    const raw = new wasm.Mesh({ numProp: 3, tolerance: 0.00001,
      vertProperties: new Float32Array(payload.positions), triVerts: new Uint32Array(payload.indices) });
    raw.merge();
    const value = own(new wasm.Manifold(raw));
    if (value.status() !== 'NoError') throw new Error('The model could not be prepared for text and keychain holes. Try a lower mesh quality.');
    return value;
  };
  const extrude = (contours: Vec2[][], bottom: number, top: number) => {
    const section = own(new wasm.CrossSection(contours.map(loop => loop.map(p => [p.x, p.y] as [number, number])), 'EvenOdd'));
    return own(own(section.extrude(top - bottom)).translate([0, 0, bottom]));
  };
  const lettering = (shapes: TrayTextShape[], bottom: number, top: number) => extrude(shapes.flatMap(s => [s.contour, ...s.holes]), bottom, top);
  const payload = (value: Manifold, metadata: TerrainMeshPayload) => {
    if (value.status() !== 'NoError') throw new Error('Text or keychain hole geometry could not be completed. Adjust the size or position.');
    if (value.isEmpty()) return { ...metadata, positions: [], indices: [] };
    return waterMeshPayload(value, metadata, value.boundingBox().min[2]);
  };
  try {
    let main = solid(mesh);
    const layout = buildModelTextLayout(config, crop), text = config.terrain.text, logo = config.terrain.logo;
    if (layout.plaque.length) {
      const top = mesh.bottomZ + layout.plaqueThicknessMm;
      main = own(main.add(extrude([layout.plaque], mesh.bottomZ, top)));
    }
    for (const mark of [{ settings: text, front: layout.front, underside: layout.underside },
      { settings: logo, front: layout.logoFront, underside: layout.logoUnderside }]) {
      if (!mark.settings) continue;
      const { style, heightMm } = mark.settings;
      if (mark.front.length) {
        const top = mesh.bottomZ + layout.plaqueThicknessMm;
        const letters = style === 'raised' ? lettering(mark.front, top - 0.02, top + heightMm) : lettering(mark.front, top - heightMm, top + 0.02);
        main = own(style === 'raised' ? main.add(letters) : main.subtract(letters));
      }
      if (mark.underside.length) {
        const letters = style === 'raised' ? lettering(mark.underside, mesh.bottomZ - heightMm, mesh.bottomZ + 0.02)
          : lettering(mark.underside, mesh.bottomZ - 0.02, mesh.bottomZ + heightMm);
        main = own(style === 'raised' ? main.add(letters) : main.subtract(letters));
      }
    }
    const hole = computeModelKeychainHole(config, crop);
    let trail = trailMesh ? solid(trailMesh) : null;
    let waters = waterMeshes.map(solid);
    if (hole) {
      const all = [mesh, ...(trailMesh ? [trailMesh] : []), ...waterMeshes];
      let maxZ = mesh.bottomZ;
      for (const part of all) for (let i = 2; i < part.positions.length; i += 3) maxZ = Math.max(maxZ, part.positions[i]!);
      const relief = Math.max(text?.heightMm ?? 0, logo?.heightMm ?? 0);
      const cutter = extrude([hole.contour], mesh.bottomZ - relief - 1, maxZ + layout.plaqueThicknessMm + relief + 1);
      main = own(main.subtract(cutter));
      if (trail) trail = own(trail.subtract(cutter));
      waters = waters.map(value => own(value.subtract(cutter)));
    }
    const waterPartRemap = waters.map(() => -1);
    let nextIndex = 0;
    const outputWater = waters.flatMap((value, index) => {
      if (value.isEmpty()) return [];
      waterPartRemap[index] = nextIndex++;
      return [payload(value, waterMeshes[index]!)];
    });
    return { mesh: payload(main, mesh), trailMesh: trail && !trail.isEmpty() && trailMesh ? payload(trail, trailMesh) : null,
      waterMeshes: outputWater, waterPartRemap };
  } finally {
    for (const allocation of allocations) allocation.delete();
  }
}
