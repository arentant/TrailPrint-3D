import type { CityMapExportRequest, ModelExportFlow } from '@shared/types/export';
import { STL_FILE_NAMES } from '@shared/types/export';
import { timestampedZipName } from '@shared/export/export-artifact';
import { encodeBinaryStl } from '@shared/utils/binary-stl';
import { generateCityModel } from '../city/city-model-service';

export const cityMapExportFlow: ModelExportFlow<CityMapExportRequest> = {
  describeArtifact: () => ({ kind: 'zip', fileName: timestampedZipName('TrailPrint-City'), extension: 'zip', mimeType: 'application/zip', saveDialogTitle: 'Save city and running route STL archive' }),
  async generateFiles(request, progress, file) {
    const result = await generateCityModel(request, (p) => progress({ phase: 'model', progress: p.progress * 0.75, message: p.message }));
    progress({ phase: 'stl', progress: 0.78, message: 'Writing city and route STLs…' });
    await file(STL_FILE_NAMES.cityMain, encodeBinaryStl(result.cityMesh, 'City_Main'));
    await file(STL_FILE_NAMES.trailLine, encodeBinaryStl(result.routeMesh, 'Trail_Line'));
    const c = request.config.city;
    const instructions = `TrailPrint City — Assembly\n\nCity_Main.stl and Trail_Line.stl use millimeters and matching XYZ coordinates.\nImport both as parts of one assembly; preserve their relative positions. Do not center each STL independently.\nPrint the city base flat. The route follows the terrain and may contain separate islands; use appropriate supports or print in assembly coordinates.\nSeat the route in the groove: ${c.routeWidthMm} mm width, ${c.routeSeatDepthMm} mm seating depth, ${c.routeReliefMm} mm visible relief, ${c.routeClearanceMm} mm clearance per side, with 0.01 mm extra vertical floor clearance.\nBuildings use flat roofs and solid support. Heights: mapped height, then levels × 3 m, then ${c.fallbackBuildingHeightM} m fallback.\nSurface mode: ${c.surface}. Route coordinates retain the supplied GPX; no snapping.\n\nMap data © OpenStreetMap contributors. https://www.openstreetmap.org/copyright\nOpenStreetMap data is available under the Open Database License (ODbL).\n\n${result.warnings.length ? 'Model notes:\n' + result.warnings.map((w) => '- ' + w).join('\n') : ''}\n`;
    await file('Assembly_Instructions.txt', new TextEncoder().encode(instructions));
  },
};
