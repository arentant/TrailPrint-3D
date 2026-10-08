import { createDefaultConfig, type GpxBounds, type GpxState, type MapModelConfig, type TerrainConfig } from './config.js';
import type { TerrainCropRegion, TerrainMeshPayload } from './terrain.js';
import { createDefaultModelColors } from './model-colors.js';

export interface CityPictureConfig {
  enabled: boolean;
  layout: 'cards' | 'minimal' | 'editorial';
  theme: 'paper' | 'midnight';
  title: string;
  athlete: string;
  date: string;
  distance: string;
  duration: string;
  pace: string;
}

export function createDefaultCityPicture(): CityPictureConfig {
  return { enabled: true, layout: 'cards', theme: 'paper', title: '', athlete: '', date: '', distance: '', duration: '', pace: '' };
}

export interface CityMapConfig extends MapModelConfig {
  gpx: GpxState;
  terrain: TerrainConfig;
  picture: CityPictureConfig;
  city: {
    surface: 'flat' | 'real';
    buildingsVisible: boolean;
    buildingHeightExaggeration: number;
    fallbackBuildingHeightM: number;
    roadsVisible: boolean;
    roadReliefMm: number;
    routeWidthMm: number;
    routeSeatDepthMm: number;
    routeReliefMm: number;
    routeClearanceMm: number;
  };
}

export function createDefaultCityConfig(): CityMapConfig {
  const defaults = createDefaultConfig();
  return {
    colors: createDefaultModelColors('city'),
    picture: createDefaultCityPicture(),
    gpx: defaults.gpx,
    mapCrop: defaults.mapCrop,
    terrain: { ...defaults.terrain, baseSolidThicknessMm: 3, zExaggeration: 1, meshQuality: 'high' },
    city: {
      surface: 'flat', buildingsVisible: true, buildingHeightExaggeration: 1.5,
      fallbackBuildingHeightM: 8, roadsVisible: true, roadReliefMm: 0.4,
      routeWidthMm: 1.2, routeSeatDepthMm: 0.6, routeReliefMm: 0.8, routeClearanceMm: 0.15,
    },
  };
}

export interface CityMapDataRequest {
  bounds: GpxBounds;
  buildings: boolean;
  roads: boolean;
}
export interface CityMapData {
  /** Complete OSM ways/relations and their referenced nodes, converted locally. */
  elements: unknown[];
}
export interface CityGenerateRequest {
  config: CityMapConfig;
  viewportWidth: number;
  viewportHeight: number;
}
export interface CityGenerateProgress {
  phase: 'prepare' | 'map' | 'dem' | 'geometry' | 'done';
  progress: number;
  message: string;
}
export interface CityGenerateResponse {
  crop: TerrainCropRegion;
  cityMesh: TerrainMeshPayload;
  routeMesh: TerrainMeshPayload;
  featureCounts: { buildings: number; roads: number; routeSegments: number; omitted: number };
  warnings: string[];
  generationMs: number;
}
