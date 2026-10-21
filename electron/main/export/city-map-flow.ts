import type { CityMapExportRequest, ModelExportFlow } from '@shared/types/export';
import { STL_FILE_NAMES } from '@shared/types/export';
import { modelExportFileName, modelExportStem } from '@shared/export/export-artifact';
import { encodeBinaryStl } from '@shared/utils/binary-stl';
import { generateCityModel, generateCityTrailModel, generateCityMapPicture } from '../city/city-model-service';
import { cityPicturePngBytes } from '@shared/city/picture-png';

export const cityMapExportFlow: ModelExportFlow<CityMapExportRequest> = {
  describeArtifact(request) {
    if (request.target && !['all', 'trail', 'map'].includes(request.target)) throw new Error('Unsupported city export target.');
    if (request.target === 'trail') return { kind: 'file', fileName: modelExportFileName(request.config, STL_FILE_NAMES.trailLine), extension: 'stl', mimeType: 'model/stl', saveDialogTitle: 'Save city running trail STL' };
    if (request.target === 'map') return { kind: 'zip', fileName: modelExportFileName(request.config, 'City_Map.zip'), extension: 'zip', mimeType: 'application/zip', saveDialogTitle: 'Save city map SVG and 4K PNG' };
    return { kind: 'zip', fileName: `${modelExportStem(request.config)}.zip`, extension: 'zip', mimeType: 'application/zip', saveDialogTitle: 'Save city and running route STL archive' };
  },
  async generateFiles(request, progress, file) {
    if (request.target === 'map') {
      const png = cityPicturePngBytes(request.picturePng, request);
      const picture = await generateCityMapPicture(request, (p) => progress({ phase: 'map', progress: p.progress, message: p.message }));
      await file(modelExportFileName(request.config, 'City_Map.svg'), picture);
      await file(modelExportFileName(request.config, 'City_Map_4K.png'), png);
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
    if (result.routeMesh) await file(trailStl, encodeBinaryStl(result.routeMesh, trailStl.replace(/\.stl$/i, '')));
    const c = request.config.city;
    const instructions = [
      'TrailPrint City — Assembly', '',
      ...(result.routeMesh ? [
        `${cityStl} and ${trailStl} use millimeters and matching XYZ coordinates.`,
        'Import both as parts of one assembly; preserve their relative positions. Do not center each STL independently.',
        'Print the city base flat. The route follows the terrain and may contain separate islands; use appropriate supports or print in assembly coordinates.',
        `Seat the route in the groove: ${c.routeWidthMm} mm width, ${c.routeSeatDepthMm} mm seating depth, ${c.routeReliefMm} mm visible relief, ${c.routeClearanceMm} mm clearance per side, with 0.01 mm extra vertical floor clearance.`,
        'Route coordinates retain the supplied GPX; no snapping.',
      ] : [`${cityStl} uses millimeters. Print the city base flat.`, 'Generated from the selected map area without a route or seating groove.']),
      `Buildings use flat roofs and solid support. Heights: mapped height, then levels × 3 m, then ${c.fallbackBuildingHeightM} m fallback.`,
      `Surface mode: ${c.surface}.`, '',
      'Map data © OpenStreetMap contributors. https://www.openstreetmap.org/copyright',
      'OpenStreetMap data is available under the Open Database License (ODbL).', '',
      ...(result.warnings.length ? ['Model notes:', ...result.warnings.map(w => '- ' + w)] : []), '',
    ].join('\n');
    await file(modelExportFileName(request.config, 'Assembly_Instructions.txt'), new TextEncoder().encode(instructions));
  },
};
