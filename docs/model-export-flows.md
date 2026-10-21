# Model export flows

TrailPrint supports `mountain-trail` (the default) and `city-map` in both Electron
and the browser. Each workspace keeps independent GPX imports, framing and model
settings for the session. Switching disposes its preview and clears progress and
download status. Switching is disabled while an export is running. Mountain
presets keep their existing format and behavior; City has no presets or accessories.

GPX is optional in both workspaces. Frame an area on the map and generate a
terrain/tray or city model without a route. Importing a GPX adds the trail and
matching groove; **Remove GPX** keeps the current map framing and restores the
surface without a groove. Imported routes still need valid points within the
print area. Standalone trail downloads require GPX. ZIPs and complete model 3MFs
omit the trail part when no route is imported, and filenames use `TrailPrint`
as their fallback prefix. Water, tray labels, magnets and mold kits remain
available without a route; NFC has a recess and cover but no endpoint LED pockets.
City map pictures also work without GPX and contain no route overlay.

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

## Terrain colors and natural snow

In the 3D preview, choose **Natural snow** for black rock and white upper slopes.
The snowline starts around mid-height; **Snowline height** adjusts where snow
begins. Slope and repeatable spatial variation break up the boundary. This is a
stylized terrain-based snow pattern, independent of satellite availability.
**Auto-color** continues to classify satellite imagery, with a terrain fallback.
Both palettes can be edited or painted by hand.

**Download model 3MF** preserves these regions as closed, non-overlapping material
volumes, together with the trail, water and optional tray. Assign the exported
colors to filaments in the slicer. ZIP downloads with an active color plan also
include the model 3MF; STL files retain geometry only. Paint masks remain available
for painting a single-material print. Regenerating terrain clears its color plan;
apply colors again after changing the model geometry.

## Mountain base and labels

The separate tray base is optional and defaults to off. Enable **Generate base**
in **4. Tray base** to include its outline, preview and exported parts. While off,
base dimensions, labels, keychain holes, NFC and magnets remain saved but do not
block terrain generation or add files/3MF parts. Presets retain the toggle;
older presets without the setting default to off. Terrain keeps its own solid
thickness and rests at Z = 0 in the preview when the tray is disabled.

The terrain and tray are separate printed parts. The tray has a recessed seat;
its floor is at `totalThicknessMm - recessDepthMm`. The preview lifts the terrain
and trail by that floor height plus `baseSolidThicknessMm`, putting the terrain's
bottom directly on the seat. Defaults leave a 2 mm recess, 3 mm floor and 0.2 mm
clearance per side. The rim locates the terrain; glue provides permanent attachment.
Underside magnet pockets mount the tray rather than coupling it to the terrain.
STLs retain each part's local coordinates for separate printing. To view them as
an assembly in a slicer, move terrain and trail together upward by the preview
offset (5 mm with defaults), preserving their shared XY center.

The recess uses parallel offsets of the terrain's polygon/rounded outline, so the
clearance is measured perpendicular to each edge. Circle recesses circumscribe
the terrain instead of clipping it with inscribed facets. The 2D tray outline,
3D preview and STL share this footprint.

`tray.text` stores an enable switch, size, raised height and up to one label per
rim edge (four positions around a circle). Text follows circular rims and fits
within the available space; labels that would be under 1.5 mm tall are rejected.
The bundled bold fonts support Armenian uppercase/lowercase letters, և,
Armenian punctuation and presentation ligatures, plus Latin/Greek letters,
numbers, punctuation and ↑. Armenian glyphs come from Noto Sans Armenian Bold;
both local JSON assets are embedded in browser and Electron builds for offline use.
Unsupported characters report an error without silently replacing glyphs. Layout
is shared by validation and generation. The combined mesh replaces the rim cap
and joins letter walls/top faces, preserving glyph counters and a closed shell.
Generation also returns an unlabeled `baseMesh` and closed `textMesh`; their
volumes meet at the rim without overlap. Preview uses separate materials from
`colors.tray` and `colors.text`. Color edits update materials without regenerating
geometry, and download flushes any pending valid color edit.

With labels enabled, the full archive includes `Tray_Base.stl`, `Tray_Text.stl`
and `Tray_AMS.3mf`. The standalone **Download base for AMS** target generates
only the tray and text, without fetching elevation. The 3MF builds one component
assembly with Base and Text parts, standard color groups, and Bambu part metadata
assigning Base to filament 1 and Text to filament 2. Users select printer/filament
profiles and map these parts to their AMS slots in the slicer. The two STLs can
also be imported together as parts of one object, preserving their coordinates.
Presets save labels and text color; older palettes default to white text and
older tray presets load with labels disabled. NFC and underside magnet pockets
remain compatible, with pocket walls oriented into their cavities.

`tray.keychain` enables one round through-hole in the base rim, with a 4 mm
default diameter, an edge selection and an offset along that edge. Circle offsets
follow the rim's arc; polygon/rectangle offsets run along the selected side.
Layout validates a minimum 2 mm wall to both the outside and terrain recess,
2 mm separation from magnet/NFC/LED pockets, and 0.6 mm from raised text contours.
The final mesh rebuilds both rim and underside caps with the hole opening and
joins an inward-facing bore wall, retaining magnet openings and letter counters.
Preview and STL use that same mesh. Disabling the feature restores the original
base geometry; older presets load with the feature disabled.

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

Exports use the imported GPX filename rather than the internal track title.
The ZIP and every entry share a parameterized prefix, for example
`my-run_circle_R80mm_mesh-high_magnets-on-circle-6x2mm`. Names include the active shape,
radius in millimeters (rectangle: length × width), mesh quality and magnet state.
Polygons include their side count; custom quality includes its grid limit.
Enabled magnets also include their pocket shape and nominal dimensions: diameter
and thickness for round magnets, width across flats and thickness for hexagons,
or length × width × thickness for rectangles. Clearance is added to the geometry.
STL headers use the corresponding part filename, including Unicode safely within
the 80-byte header. Paint-manifest references use the same prefix.
Names preserve spaces and Unicode, sanitize unsupported filesystem characters,
and fall back to the desktop path, track title or `TrailPrint` if needed.

City ZIPs contain `<prefix>_City_Main.stl`, an optional `<prefix>_Trail_Line.stl` and
`<prefix>_Assembly_Instructions.txt`. Both STL parts use millimeters and shared XYZ
assembly coordinates. Instructions include OpenStreetMap attribution and ODbL
information. Separate route islands may need supports when printed individually.

City also accepts `target: "trail"` for only the matching route STL, and
`target: "map"` for `<prefix>_City_Map.zip`, containing both `<prefix>_City_Map.svg`
and `<prefix>_City_Map_4K.png`. Both targets can be downloaded directly from
City without a full-city preview, even after that preview fails. Trail-only
generation uses the GPX and the selected surface; it never downloads OSM buildings
or roads, fuses a city, or cuts a groove. Flat requires no network. Real terrain
fetches only elevation, with the existing grid cache. A matching finalized preview
can supply the identical route immediately.

The paper map uses the same rotated projection, footprint clipping, physical
sizes and vector GPX route as the STLs. Its background comes from OpenFreeMap
(OpenStreetMap / OpenMapTiles), rendered locally with MapLibre's Positron style.
No API key is required. Street names and road shields are hidden. 3D layer switches and material colors do not change the
paper basemap. SVGs embed a PNG background and keep the GPX and poster lettering
as vectors; they are self-contained and retain separate GPX segments. Every
layout, including Map only, displays OpenMapTiles/OpenStreetMap attribution and
the OpenStreetMap copyright URL without changing the map's physical dimensions.

Every map download also includes the complete poster as a PNG, with 4,096 pixels
on its longest side and the original aspect ratio. The renderer rasterizes the
same SVG, including the map, route, text, theme and attribution. Both files share
one ZIP download/save dialog, so browser multiple-download permissions are not
needed. PNG dimensions and its header are checked before packaging; a failed PNG
render fails the export instead of silently omitting the companion image.

Open the SVG in a browser and print at **100% / actual size**, with fit-to-page
disabled and paper large enough for the image. Choose Flat for a route insert to
place on the paper map. The app shows print instructions after download.

Both browser and Electron render the background in the UI renderer before
sending a serializable image to the export worker/main process. That boundary
validates the framing, print dimensions and PNG header; missing, stale or
preview-resolution images cannot be exported. Paper exports still hydrate GPX
and validate framing, but never download OSM feature geometry for 3D, initialize
solid geometry, or request elevation, even in Real terrain mode without a key.

Preview uses 120 DPI and export targets at least 600 DPI, increasing it for small
prints to supply enough source detail for the 4K PNG. Cartographic zoom and geographic
bounds stay fixed between them: higher DPI draws the same vector features and
labels with more pixels. Small geographic selections do not depend on raster
tile availability or silently fall back to low-detail images. Output is capped
at 8,192 pixels per axis and 32 MB of PNG data; very large print sizes therefore
have a lower effective DPI. A device that cannot allocate the planned canvas
reports an error instead of silently reducing resolution. Rendering is serialized,
times out after 60 seconds, and releases its WebGL context after each job. A
bounded cache retains two completed images, allowing poster text edits without
rerendering. Closing or replacing a preview cancels its render. Provider failures
are retryable. OpenFreeMap's public service has no SLA.

Only 3D city ZIP downloads require a valid 3D preview. Browser downloads and desktop
save/cancel behavior are shared across all targets.

Mountain tray magnet pockets can be round, rectangular or hexagonal, independently
of the map footprint. Set diameter for round magnets, length and width for rectangles
(equal dimensions make a square), or width across opposite flats for hexagons.
Thickness controls pocket depth. Clearance adds twice its value to the opening
dimensions and once to the depth. Existing presets default to round pockets;
new presets retain the selected shape and sizes. Invalid dimensions, overlapping
pockets, thin outer walls and excessive depth block generation with an explanation.
The map shape controls placement and count. Rounded polygons retain one pocket
per logical corner, rather than one per fillet segment. Preview, STL export and diagnostic
geometry share the same contour. Round facets add at most 0.01 mm radial error
at supported sizes while preserving fit. Aligned rectangular pocket edges are
split during bottom-plate triangulation to keep the mesh closed.

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
