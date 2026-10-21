import { readFile } from 'node:fs/promises';
import type { Route } from '@playwright/test';

const tile = await readFile('fixtures/city-picture.mvt');
const style = {
  version: 8,
  sources: { city: { type: 'vector', tiles: ['https://tiles.openfreemap.org/test/{z}/{x}/{y}.pbf'], maxzoom: 14 } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#557762' } },
    { id: 'buildings', type: 'fill', source: 'city', 'source-layer': 'building', paint: { 'fill-color': '#c7c4bb' } },
    { id: 'roads', type: 'line', source: 'city', 'source-layer': 'transportation', paint: { 'line-color': '#fff', 'line-width': 4 } },
  ],
};

export function fulfillCityPicture(route: Route) {
  return route.request().url().endsWith('.pbf')
    ? route.fulfill({ contentType: 'application/x-protobuf', body: tile })
    : route.fulfill({ contentType: 'application/json', body: JSON.stringify(style) });
}
