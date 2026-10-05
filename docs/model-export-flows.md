# Model export flows

TrailPrint supports `mountain-trail` (the default) and `city-map` in both Electron
and the browser. Each workspace keeps independent GPX imports, framing and model
settings for the session. Switching disposes its preview and clears progress and
download status. Switching is disabled while an export is running. Mountain
presets keep their existing format and behavior; City has no presets or accessories.

## Shared boundaries

- `shared/types/export.ts` registers both request types. A request without `flow`
  remains a Mountain export; City requires `flow: "city-map"`.
- `shared/export/export-pipeline.ts` routes requests, validates filenames and
  streams files to a sink. Browser and desktop share these generators and their
  output metadata, including the existing desktop save/cancel/cleanup lifecycle.
- `src/components/map/MapFramingView.vue` accepts crop, GPX display data, optional
  tray, fit requests and grid state through props. It shares Leaflet projection,
  rotation, masks and fitting without importing a store. `MapLeafletView.vue` is
  the Mountain adapter and retains the preset behavior.
- `electron/main/terrain/prepare-heightfield.ts` shares DEM height normalization
  and smoothing without Mountain validation or trail grooves.
- `src/composables/useModelExport.ts` owns shared export progress and delivery;
  workspaces own their inputs and preview lifecycles.

## City generation

`generateCityModel` is exposed through Electron IPC and the browser worker, with
City progress events. `electron/main/city/city-model-service.ts` validates the
request, retrieves data, prepares optional DEM relief and caches the current
finalized model by all inputs. Both preview and `city-map-flow.ts` use that same
model. A changed request replaces the cache; failures are not cached. UI revision
checks discard preview responses whose inputs have changed or workspace has closed.
The preview includes route width, seating depth, visible relief and side clearance
controls. Edits rebuild automatically one second after the last input event,
including temporarily empty numeric fields. Further typing restarts the delay.
Updates retain the current view and camera, and disable download until the latest
model is ready.

City retains one map selection, one raw DEM sample grid and one prepared heightfield
per compute runtime. Trail edits reuse these inputs without map or elevation calls.
Map bounds/layers invalidate map data; crop, projection, grid, dataset or key changes
invalidate DEM samples. Smoothing and elevation exaggeration reprocess the raw grid
locally. Raw elevations are copied before preparation, which mutates its input.
The evaluated city solid before cutting the groove is also retained. Trail-only
edits reuse its fused buildings, roads and terrain, rebuilding only the insert and
groove. Each edit cuts the original city, so narrowing restores surrounding details.
City dimensions, framing, layers, building/road settings or prepared elevation
changes replace that solid. Progress distinguishes city fusion from trail updates.

`shared/city/map-provider.ts` uses Overpass to retrieve full way coordinates and
relation references, including every member way of multipolygons. Coordinate nodes
are embedded on ways rather than downloaded as separate elements. Only crop bounds
and layer switches reach the authenticated `api/city.ts`; GPX stays on the device.
Electron calls the same provider directly.
The server-only `CITY_OVERPASS_URL` changes the interpreter endpoint; default:
`https://overpass-api.de/api/interpreter`. Successful responses use a bounded
10-minute memory cache (8 entries, 48 MB total), with in-flight deduplication.
Requests identify TrailPrint-3D with its repository URL in a custom User-Agent,
as required by the public provider. HTTP 406 reports an access-policy rejection.
Provider downloads are capped at 48 MB to allow its pretty-printed JSON; normalized
data remains capped at 24 MB / 180,000 elements / 1,000,000 geometry references.
The 35,000-building solid limit applies after crop clipping and print-scale filtering.
Selections are limited to 2,500 km² and 100 km per axis. Provider timeouts, rate
limits, incomplete data and oversized selections produce explicit errors.

`shared/city/geometry.ts` converts OSM with `osmtogeojson` and clips it locally.
Manifold initializes once per compute runtime. Vite packages WASM as a local
browser asset and beside the Electron main bundle. Every temporary CrossSection
and Manifold is deleted in a `finally` block, including failed generations.
The retained footprint, terrain and uncut city have explicit ownership; replacing
the selection or clearing the model cache deletes all three. Route failures keep
the reusable city while releasing temporary route geometry.

- Buildings retain multipolygon holes and courtyards. Mapped parts remove their
  overlapping parent-shell footprint. Flat roofs use valid mapped height (meters
  or feet), then positive levels × 3 m, then an 8 m fallback. Building height uses
  1.5× exaggeration by default, with 0.4 mm minimum printable relief. Extrusions
  extend into the base to support the buildings on relief terrain.
- Roads include footpaths and use 0.4 mm relief by default. Mapped road width is
  preferred, otherwise 2 m for paths, 12 m for major roads and 6 m for others,
  with 0.4 mm minimum print width. Bridges, tunnels and covered roads are omitted
  and reported; supported road relief is fused into the terrain.
- Building and road contours simplify at 0.05 mm, with buildings below 0.16 mm² omitted.
  Missing geometry and omitted details appear in model warnings and instructions.
  Processing is bounded at 35,000 features and 100,000 printable stroke edges.
- Route segments retain GPX order, loops, crossings and clip-created islands.
  Routes are never snapped. A terrain-following insert is cut from a union of
  2D capsules; the matching wider corridor clears buildings and roads. Defaults:
  1.2 mm route, 0.6 mm seat, 0.8 mm visible relief and 0.15 mm clearance per side.
  Groove floors include 0.01 mm vertical fit clearance for STL float32 rounding.
- City defaults to Flat with a 3 mm level base and makes no elevation requests.
  Real terrain stays manual, defaults to COP30 / 1× / High, and uses the existing
  persisted OpenTopography key. Missing keys/provider failures never switch modes.
  City solid operations support DEM grids up to 512 × 512 (Extreme or Custom).

City ZIPs contain `City_Main.stl`, `Trail_Line.stl` and
`Assembly_Instructions.txt`. Both STL parts use millimeters and shared XYZ
assembly coordinates. Instructions include OpenStreetMap attribution and ODbL
information. Separate route islands may need supports when printed individually.

Water, parks, 3MF, City presets, trays, magnets and NFC are deferred.

## Verification

- `npm run test:export`: routing, geometry/STL integrity across rotated footprints
  and both surfaces, courtyards, parts, crossings, disconnected tracks, marathon
  input, cached preview/export, identity-scoped desktop hydration, save cancellation
  and temporary-file cleanup.
- `npm run test:api`: plain Node endpoint loading, authentication, request validation,
  complete/cached OSM data, empty/malformed/oversized/rate-limited provider responses
  and configurable interpreter endpoints.
- `npm run test:web`: Mountain regressions plus City import → preview → ZIP,
  repeated downloads, independent workspaces, manual surface selection, elevation
  failure reporting and stale-preview handling, using deterministic providers.
- `npm run typecheck`, `npm run build`, `npm run build:web`: both runtime builds.

Live provider responses vary with OSM coverage, OpenTopography access and service
availability. Test fixtures do not require live provider credentials.
