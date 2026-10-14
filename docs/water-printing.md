# Water review and printing

Enable **Include water** in Terrain. Water loads independently of elevation data, so no elevation key or 3D preview is needed to review it. Under **Detected water**, check a feature to keep it or uncheck it to hide it from the model and exports. Clicking its map outline makes the same choice; hidden features retain a faint dashed outline so you can restore them. Categories, per-feature choices, minimum printed area/width, river width multiplier, and color are saved with presets. The list distinguishes hidden, too-small, incomplete, and preferred-source coverage. Widened rivers are marked **Exaggerated**.

The default print mode remains **Separate inserts**: 1 mm minimum water thickness, 0.15 mm clearance per side, 0.16 mm² minimum area, and 0.4 mm minimum printable width. Rivers default to 1× measured width and a 0.8 mm printed minimum. Islands, the supported trail corridor, and a 0.6 mm crop border stay in the terrain. Small pieces are filtered after clearance; omitted pieces never cut seats. Inland tops follow terrain; sea tops use the terrain's elevation transform at 0 m.

Choose **Fused multicolor** and **Download model 3MF** for touching terrain, trail, and water material volumes. Open the exported `Model.3mf` in Bambu Studio and map its colors to your AMS filaments. Booleans cut zero-clearance water seats and partition the trail across terrain and water material volumes. The tray and its text form an independent group. The writer preserves alignment inside each group and arranges groups without overlap in positive XY, with each group on the bed. Large models may need separate plates in Bambu Studio. Material colors, names, dataset versions, attribution, coverage errors, and feature mappings are embedded in the 3MF.

The ZIP export still includes STLs, masks, NFC covers, and mold parts when enabled. Every individual STL is centered in XY and lifted to minimum Z = 0. `Assembly.json` and `Assembly.txt` record the inverse translations needed to restore assembly positions. Import tray/text as a group using their 3MF, or use the recorded translations when assembling their STLs. Downloads rebuild from current settings; they do not export a stale preview.

## Extra coverage: setup for the project owner

OSM polygons and river centerlines work immediately. HydroLAKES, GRWL, and sea coverage remain unavailable until the indexed catalog is hosted. The app displays this explicitly instead of reporting that the area has no water.

Your first step is to create a [Cloudflare account and an R2 bucket](https://developers.cloudflare.com/r2/get-started/s3/), named for example `trailprint-water`. In its Settings, enable the public development URL for testing, and copy that URL. A [custom domain](https://developers.cloudflare.com/r2/buckets/public-buckets/) is the production option; `r2.dev` is rate-limited and intended for development. This bucket stores public map data, not GPX tracks or elevation keys.

Dataset preparation and upload are separate from that account setup. The repository includes the build and verification tools below. No global datasets or Cloudflare credentials are bundled, and no production bucket or manifest has been published yet.

## Prepare and validate a release

Use Python 3.9–3.12 with the pinned GIS wheels:

```sh
python3.12 -m venv .venv-water
.venv-water/bin/pip install -r scripts/water/requirements.txt
.venv-water/bin/python scripts/water/build_catalog.py --config scripts/water/sources.local.json --output data/water/releases
node scripts/water/validate_catalog.mjs data/water/releases/manifest-water-2026-10-14.json
```

Copy `scripts/water/sources.example.json` to `sources.local.json` and adjust the actual paths, source versions, ID/width fields, and attribution. Obtain source files from:

- [HydroLAKES](https://www.hydrosheds.org/products/hydrolakes): polygons with `Hylak_id`; coverage starts at 10 hectares. Smaller mapped lakes remain OSM features. HydroLAKES v1 is CC BY 4.0.
- [GRWL](https://doi.org/10.5281/zenodo.1297434): vector centerlines with source IDs and widths in meters. The adapter requires LineString/MultiLineString records. GRWL pixel-point products need a separate vectorization step; they must not be connected arbitrarily by record order. Confirm the exact downloaded release's fields and license before publishing.
- [Processed OSM water polygons](https://osmdata.openstreetmap.de/data/water-polygons.html): coastline-derived sea polygons. Islands are retained. If the assembled polygon has no single OSM feature ID, the builder derives a stable geometry hash and preserves the original dataset record ID separately.

The builder streams features into EPSG:4326 FlatGeobuf with `SPATIAL_INDEX=YES`. It retains full source geometry and holes, rejects invalid geometry and duplicate IDs, checks the generated features, and writes SHA-256 checksums, counts, extents, source versions, and attribution into a candidate manifest. Existing release directories are immutable. `inputBounds` optionally selects features in the source CRS without clipping their geometry; prepare separate named shards to reduce offline memory needs.

Upload the version directory (for example `water-2026-10-14/*.fgb`) first. Use R2's dashboard or an S3-compatible tool for bulk files. Set immutable caching on versioned datasets. Configure [CORS](https://developers.cloudflare.com/r2/buckets/cors/) using `scripts/water/r2-cors.json`; the public files allow GET/HEAD and the Range header, and expose Content-Range. Keep short/revalidated caching on `manifest.json`.

Verify the uploaded files before replacing the published manifest:

```sh
node scripts/water/validate_catalog.mjs data/water/releases/manifest-water-2026-10-14.json https://YOUR-PUBLIC-BUCKET-URL/
```

The validator checks local checksums and spatial indexes, then checks remote range responses. Also open the app against the candidate manifest to check browser CORS, representative lakes/islands/rivers/coasts, source preference, and outages. Only after those checks pass, upload the candidate as `manifest.json`. Roll back by republishing the previous manifest; never overwrite a versioned dataset.

Set `VITE_WATER_CATALOG_URL=https://YOUR-PUBLIC-BUCKET-URL/manifest.json` when building the browser app and `WATER_CATALOG_URL` to the same URL for desktop. Rebuild/restart. Requests go directly to the public dataset host; global files do not pass through Vercel. Servers that ignore Range are rejected before consuming their full response.

## Validation status and remaining release gates

Automated fixtures exercise islands, enclosing lakes, crop shapes/rotation, trail crossings, narrow parts split by clearance, source overlap/exclusion, river widening, flat seas, closed material volumes, bed placement, range access, cancellation, partial outages, caching, old presets, and browser downloads.

The included `artifacts/water-printing/TrailPrint_Complete_Model.3mf` and `TrailPrint_Mountain_Relief.3mf` are synthetic fixtures, not measured terrain from a user's GPX. The flat fixture's four colors were recognized by Bambu Studio 2.8.2.61's standard color import. Command-line imports verify two closed groups with their expected dimensions for both fixtures. That version shows a [known warning for standard 3MF files without printer settings](https://github.com/bambulab/BambuStudio/issues/11927); continue through the warning and map the imported colors to your filaments. Printer, nozzle, temperature, and filament profiles remain in Bambu Studio. Bambu Studio is the supported slicer for this release.

Physical fit is unvalidated. `artifacts/water-printing/Clearance_Coupons.zip` contains six bed-ready STL files for three matching terrain/water pairs. Print a small coupon with 0.10, 0.15, and 0.20 mm clearance per side, plus a representative lake and river insert. Check dry fit, island edges, narrow channels, seat contact, floor thickness, and trail crossings. Do not treat 0.15 mm as a printer-calibrated fit until those prints succeed.

The global production datasets, R2 publishing, browser verification against that host, Bambu slicing with the intended printer/filaments, and physical prints remain release gates. Future place search, landcover palettes, portable settings, multi-day routes, and puzzle tiling are outside this release.
