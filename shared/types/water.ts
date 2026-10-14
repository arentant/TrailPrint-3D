import type { GpxBounds, MapCropConfig } from './config.js';

export type WaterCategory = 'lake' | 'reservoir' | 'river' | 'sea';
export type WaterSourceId = 'osm' | 'hydrolakes' | 'grwl' | 'coastline';
export type WaterGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }
  | { type: 'LineString'; coordinates: number[][] }
  | { type: 'MultiLineString'; coordinates: number[][][] };
export interface WaterAttribution {
  id: WaterSourceId;
  version: string;
  attribution: string;
  license: string;
  url: string;
}
export interface WaterFeature {
  id: string;
  sourceId: string;
  name: string;
  category: WaterCategory;
  geometry: WaterGeometry;
  source: WaterAttribution;
  widthM?: number;
  complete: boolean;
}
export type WaterFeatureSummary = Omit<WaterFeature, 'geometry' | 'complete'>;
export interface WaterCatalog {
  key: string;
  features: WaterFeature[];
  sources: WaterAttribution[];
  errors: Array<{ source: string; message: string }>;
  fetchedAt: string;
}
export interface WaterCatalogRequest {
  mapCrop: MapCropConfig;
  viewportWidth: number;
  viewportHeight: number;
  requestId?: string;
  refresh?: boolean;
}
export type WaterFeatureState = 'included' | 'excluded' | 'category-disabled' | 'too-small' | 'outside-crop' | 'incomplete' | 'covered';
export interface WaterFeatureStatus {
  featureId: string;
  state: WaterFeatureState;
  reason?: string;
  areaMm2: number;
  exaggerated: boolean;
  printedWidthMm?: number;
  partIndices: number[];
}
export interface WaterPartMapping { partIndex: number; featureIds: string[] }
export interface WaterDataset extends WaterAttribution {
  url: string;
  sourceUrl: string;
  sha256: string;
  bytes: number;
  featureCount: number;
  bounds: GpxBounds;
}
export interface WaterManifest { schemaVersion: 1; version: string; datasets: WaterDataset[] }
