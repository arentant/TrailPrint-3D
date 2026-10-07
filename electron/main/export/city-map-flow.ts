import type { CityMapExportRequest, ModelExportFlow } from '@shared/types/export';
import { STL_FILE_NAMES } from '@shared/types/export';
import { modelExportFileName, modelExportStem } from '@shared/export/export-artifact';
import { encodeBinaryStl } from '@shared/utils/binary-stl';
import { generateCityModel, generateCityTrailModel, generateCityMapPicture } from '../city/city-model-service';

export const cityMapExportFlow: ModelExportFlow<CityMapExportRequest> = {
  describeArtifact(request) {
    if (request.target && !['all', 'trail', 'map'].includes(request.target)) throw new Error('Unsupported city export target.');
    if (request.target === 'trail') return { kind: 'file', fileName: modelExportFileName(request.config, STL_FILE_NAMES.trailLine), extension: 'stl', mimeType: 'model/stl', saveDialogTitle: 'Save city running trail STL' };
    if (request.target === 'map') return { kind: 'file', fileName: modelExportFileName(request.config, 'City_Map.svg'), extension: 'svg', mimeType: 'image/svg+xml', saveDialogTitle: 'Save printable city map picture' };
    return { kind: 'zip', fileName: `${modelExportStem(request.config)}.zip`, extension: 'zip', mimeType: 'application/zip', saveDialogTitle: 'Save city and running route STL archive' };
  },
  async generateFiles(request, progress, file) {
    if (request.target === 'map') {
      const picture = await generateCityMapPicture(request, (p) => progress({ phase: 'map', progress: p.progress, message: p.message }));
      await file(modelExportFileName(request.config, 'City_Map.svg'), picture);
      return;
    }
    if (request.target === 'trail') {
      const mesh = await generateCityTrailModel(request, (p) => progress({ phase: 'model', progress: p.progress * 0.75, message: p.message }));
      progress({ phase: 'stl', progress: 0.78, message: 'Writing running trail STL…' });
      await file(modelExportFileName(request.config, STL_FILE_NAMES.trailLine), encodeBinaryStl(mesh, modelExportFileName(request.config, STL_FILE_NAMES.trailLine).replace(/\.stl$/i, '')));
      return;
    }
    const result = await generateCityModel(request, (p) => progress({ phase: 'model', progress: p.progress * 0.75, message: p.message }));
    progress({ phase: 'stl', progress: 0.78, message: 'Writing city and route STLs…' });
    const cityStl = modelExportFileName(request.config, STL_FILE_NAMES.cityMain);
    const trailStl = modelExportFileName(request.config, STL_FILE_NAMES.trailLine);
    await file(cityStl, encodeBinaryStl(result.cityMesh, cityStl.replace(/\.stl$/i, '')));
    await file(trailStl, encodeBinaryStl(result.routeMesh, trailStl.replace(/\.stl$/i, '')));
    const c = request.config.city;
    const instructions = `TrailPrint City — Assembly\n\n${cityStl} and ${trailStl} use millimeters and matching XYZ coordinates.\nImport both as parts of one assembly; preserve their relative positions. Do not center each STL independently.\nPrint the city base flat. The route follows the terrain and may contain separate islands; use appropriate supports or print in assembly coordinates.\nSeat the route in the groove: ${c.routeWidthMm} mm width, ${c.routeSeatDepthMm} mm seating depth, ${c.routeReliefMm} mm visible relief, ${c.routeClearanceMm} mm clearance per side, with 0.01 mm extra vertical floor clearance.\nBuildings use flat roofs and solid support. Heights: mapped height, then levels × 3 m, then ${c.fallbackBuildingHeightM} m fallback.\nSurface mode: ${c.surface}. Route coordinates retain the supplied GPX; no snapping.\n\nMap data © OpenStreetMap contributors. https://www.openstreetmap.org/copyright\nOpenStreetMap data is available under the Open Database License (ODbL).\n\n${result.warnings.length ? 'Model notes:\n' + result.warnings.map((w) => '- ' + w).join('\n') : ''}\n`;
    await file(modelExportFileName(request.config, 'Assembly_Instructions.txt'), new TextEncoder().encode(instructions));
  },
};
