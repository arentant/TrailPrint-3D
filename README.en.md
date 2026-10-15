# 🏔️ TrailPrint 3D

**[Main README](README.md)**

**Turn hiking GPX tracks into 3D-printable terrain models · GPX to STL**

### 🎁 Custom printed models

If you don't have a 3D printer or prefer a finished physical terrain model based on your GPX track, contact the author on WeChat for custom printing.

- **WeChat ID:** `gg_0328_bao`
- **WeChat QR code:**

![WeChat QR code](wechat-qr-new.JPG)

---

TrailPrint 3D is an open-source desktop app that combines GPX activity tracks with real-world elevation data (DEM) to generate STL models ready for 3D printing. Import a `.gpx` file from platforms like [2bulu](https://www.2bulu.com/), frame the area on a map, tune print size and terrain settings, and export split parts — no manual 3D modeling required.

### Use cases

- **Hiking & trail-running keepsakes:** Turn routes like West Lake Heart Trail, Wugong Mountain, MacLehose Trail, or Tiger Leaping Gorge into a displayable terrain model
- **GPX to STL:** Import a track and get `<gpx-name>_Terrain_Main.stl` (terrain), `<gpx-name>_Trail_Line.stl` (trail), and `<gpx-name>_Tray_Base.stl` (tray base) automatically
- **Multi-color FDM printing:** Split exports for Bambu Lab and other multi-color FDM printers — trail grooves plus a separate line part for color swaps, magnet holes for glue-free assembly
- **Terrain relief display pieces:** Adjustable elevation exaggeration, surface smoothing, and a picture-frame base to make subtle real-world relief readable at desk scale

> If this project helps you, consider giving it a **Star** ⭐ — it helps you follow updates and helps others discover the repo.

---

## 🛠️ Workflow

### 0. Get a GPX file (optional)

Export your target track as a `.gpx` file from your GPS app or platform of choice (e.g. Garmin, Strava, AllTrails, or [2bulu](https://www.2bulu.com/) for Chinese hiking communities).

![Export GPX](docs/images/readme/00-gpx-export-2bulu.webp)

### 1. Import the track

Launch the app and frame a place on the map. You can generate Mountain terrain
and City models without a GPX. To add a trail, upload the `.gpx` file from the
previous step. **Remove GPX** returns to a model without a route and keeps your
map framing. Trail-only downloads require a GPX; other downloads omit the trail
part when no track is imported.

![Import GPX track](docs/images/readme/01-import-gpx.webp)

### 2. Frame and tune parameters

The tray base is optional and off by default. Turn on **Generate base** in
**4. Tray base** to include it in previews and downloads, then configure its
dimensions, labels, keychain hole, NFC or magnets.

Choose a base shape (circle, rectangle, or regular polygon). The shape stays anchored to the same geographic area while you zoom and pan. Drag its center handle to move it or its edge handle to resize it. **Place shape here** creates a selection in the current view; **Show shape** brings an existing selection back into view. Print dimensions set the physical model size independently of map zoom. Use **Map rotation** at the top left: the arrow buttons turn the map by 15°, the slider adjusts the angle, and **Reset north** restores north without changing position or zoom. You can also hold **Alt / Option** and drag to rotate. These controls work in both Mountain and City views. Use the sidebar to set print dimensions, corner radius, elevation exaggeration, surface smoothing, tray base, and assembly tolerances.

Use **Grid on/off** above the map for positioning guides. **Save preset** can also save the map coordinates, zoom, and rotation; leave **Save map coordinates and framing** unchecked to reuse only the print settings. Presets are stored locally on this device and do not include GPX data or your API key.

![Frame and tune parameters](docs/images/readme/02-compose-framing.webp)

Open **Colors** below the rotation controls to choose the trail, terrain, and tray colors (or the city base in City view). Enabling **Text on base** adds a separate **Text** color. Changes apply to the map and 3D preview one second after you stop editing. Mountain presets save the palette. STL files contain geometry; the complete model 3MF includes terrain, trail and water colors, with tray/text in their own printable group.

### 3. Preview and export

Check the terrain, trail, and tray in the 3D preview, then generate and download the model archive.

To export the trail separately, choose **Download trail STL** in Trail settings or the 3D preview. This saves `<gpx-name>_Trail_Line.stl` directly with its terrain-following surface, centered in XY and placed on the print bed.

![Export model](docs/images/readme/03-export-model.webp)

### 4. Import into Bambu Studio and assign colors

Unzip the archive and drag `<gpx-name>_Terrain_Main.stl`, `<gpx-name>_Trail_Line.stl`, and `<gpx-name>_Tray_Base.stl` into [Bambu Studio](https://bambulab.com/en/download/studio). Assign filament colors to terrain, trail, and base, preview the multi-color assembly, then slice and print.

For a base with colored text, choose **Download base for AMS** in the preview and open `<gpx-name>_Tray_AMS.3mf`. It contains one object with **Base** and **Text** parts assigned to filament 1 and 2. Select your printer and filament profiles, map the two parts to your AMS filaments, then slice and print them together. The same 3MF is included in the full archive. Alternatively, import `Tray_Base.stl` and `Tray_Text.stl` together as parts of one object and preserve their positions. Print terrain and trail separately and assemble them into the recessed base.

![Import into Bambu Studio](docs/images/readme/04-bambu-studio-import.webp)

![Colored preview in Bambu Studio](docs/images/readme/05-bambu-studio-colored.webp)

### 5. Print and assemble

After printing, assemble the terrain, trail, and tray parts into the finished physical model.

![Printed result](docs/images/readme/06-printed-result.webp)

![Printed result](docs/images/readme/07-printed-result-2.webp)

---

## 🚀 Quick start

This project is an **Electron + Vue 3** desktop app managed with npm.

A browser edition is also available with Google sign-in and an email allowlist.
Configure authentication, then run `npm run dev:web` locally or deploy the
repository to Vercel. See [Browser app and Vercel deployment](docs/vercel-deployment.md)
for setup, data handling, and validation commands.

### Requirements

- [Node.js](https://nodejs.org/) 18 or later
- npm (bundled with Node.js)

### Install and run

```bash
# Clone the repo and enter the project directory
cd TrailPrint-3D

# Install dependencies
npm install

# Start dev mode (opens an Electron window)
npm run dev
```

### OpenTopography API Key

Elevation data comes from [OpenTopography](https://portal.opentopography.org/requestService?service=api). After launching the app, enter your API key in the **OpenTopography API Key** card at the top of the sidebar ([free registration](https://portal.opentopography.org/requestService?service=api)). The key is stored locally only and is not distributed with the repo.

### Optional environment variables

Copy `.env.example` to `.env` for development options. You can also pre-fill the API key via environment variables (not required):

```bash
OPENTOPOGRAPHY_API_KEY=your_key_here
VITE_OPENTOPOGRAPHY_API_KEY=your_key_here
```

For high-resolution studio exports or large custom grids, you can raise the V8 heap limit (MB, default 8192):

```bash
TRAILPRINT_HEAP_MB=8192
```

### Other commands

| Command             | Description                                |
| ------------------- | ------------------------------------------ |
| `npm run dev`       | Dev mode with hot reload                   |
| `npm run build`     | Build production output to `out/`          |
| `npm run preview`   | Preview the built app                      |
| `npm run package`   | Build and package installers to `release/` |
| `npm run typecheck` | Run TypeScript type checking               |

---

## ✨ Core features

### 🗺️ 1. Framing and map crop

- **Base shape:** Circular, rectangular, or regular polygon crop regions.
- **Print size:** Scale the model to your actual print dimensions (e.g. 150mm × 150mm).
- **Map framing:** Move and resize the crop shape to select an area, then pan and zoom independently without changing its geographic coverage.
- **Map rotation:** Arrow buttons, an angle slider, and Reset north in both workspaces; Alt / Option + drag also rotates the map while the crop stays anchored to its geographic area.
- **Corner radius:** Rounded outer contours for rectangles and polygons (0 = sharp corners).

### ⛰️ 2. Terrain generation and trail processing

- **Height multiplier:** Exaggerate Z-axis elevation so subtle real-world relief reads at desk scale.
- **Mesh quality:** Standard / high / ultra / extreme / studio / custom tiers to control DEM sampling density and STL detail.
- **DEM dataset:** Choose OpenTopography datasets (e.g. COP30 30m) based on region and resolution needs.
- **Surface smoothing:** Raw, light, medium, and heavy levels to reduce noise and stair-stepping for cleaner prints.
- **Trail filtering:** Optional GPX simplification to filter GPS drift and noise for smoother trail lines.
- **Text on model:** In **2. Terrain**, add a front caption on an integrated ledge, centered underside lettering, or both. Choose raised or engraved text, an optional second line, size and relief. **View underside** in the 3D preview shows the bottom lettering. Engraved underside text keeps a flat bottom; raised text lifts the model by its relief. Front captions require the separate base to be off. Model lettering uses the terrain material and is included in the terrain STL and model 3MF.
- **Keychain hole on model:** Add a hole directly through the terrain in **2. Terrain**, with diameter, edge, inset and offset controls. The same opening cuts any crossing trail and water parts. Validation keeps 2 mm of material around the hole and clearance from text. Model text and hole settings are saved in presets. Turn off the mold kit when using either feature.
- **Logos and placement:** Enable **Logo on model** to import an SVG or PNG for engraving or raised artwork. Select dark, light or opaque shapes; SVG text must be outlined. In **Arrange text & logo**, choose one of nine quick positions (center, edges and corners), drag either item, or enter exact horizontal/vertical offsets and rotation. Quick placement preserves size and rotation and fits the model outline. Front and underside positions are independent, and the front ledge grows to fit. Imported outlines, size, depth and positions are retained in presets and included in the 3D preview, STL and 3MF. Logos use the terrain material.
- **Water review and printing:** Enable **Include water** in **2. Terrain** to review OSM lake/reservoir polygons and river centerlines directly on the map. Toggle categories or individual features, filter small parts, widen rivers and choose a water color. Separate flat-bottom inserts remain the default; islands, trail support and the crop border are preserved. **Fused multicolor** creates touching terrain/trail/water volumes for **Download model 3MF**, with tray/text in an independent group. Every STL is bed-normalized and the ZIP records its assembly translation. Extra large-lake, river-width and sea coverage requires the indexed dataset host; unavailable coverage is shown explicitly. See [water printing and dataset setup](docs/water-printing.md).

### 🖼️ 3. Tray base

- **Inset frame structure:** Automatically generates a picture-frame base that wraps the main terrain mesh.
- **Adjustable parameters:** Set total thickness, inset depth, and border width for different print and display needs.
- **Text on base:** Enable raised rim labels in **4. Tray base**. Add custom text, choose each edge, and adjust size and relief. Circular labels follow the rim curve. Choose a separate **Text** color in **Colors** and export the base for AMS; Base and Text remain separate selectable parts in the 3MF. Presets retain labels and colors. The bundled bold fonts support Armenian (uppercase, lowercase, և and punctuation), Latin/Greek letters, numbers and an elevation arrow (↑); unsupported characters show an error.
- **Keychain hole:** Enable a round through-hole in **4. Tray base**, set its diameter (default 4 mm), choose a rim edge and adjust its offset along that edge. The hole keeps at least 2 mm of material around it and checks for conflicts with labels and magnet/NFC/LED pockets. It appears in the 3D preview and base STL, and presets retain the settings.
- **Terrain seat:** The terrain rests on the recess floor. Defaults are a 2 mm recess, a 3 mm solid floor and 0.2 mm clearance per side. The terrain's 2 mm base puts its flat surface flush with the rim. The rim locates the insert; use glue for permanent attachment. Underside magnets mount the tray and do not lock the terrain into it.
- **NFC & LED:** Reserve NFC chip pockets and 0805 LED indicator slots in the tray recess, with an optional `<gpx-name>_Tray_Cover.stl` cover plate.

### 🧩 4. Split printing and assembly

Built for multi-color printing and post-print assembly:

- **Print tolerances:** Separate clearance settings for trail grooves and base slots (e.g. 0.15mm) to compensate for filament expansion.
- **Magnet holes:** Enter magnet dimensions to generate holes on the tray bottom (2–12 for circles, 4 corners for rectangles, 1 per vertex for polygons) for mounting and display.

---

## 📦 Output files

Downloads use the imported GPX filename. For `my-run.gpx`, the archive is `my-run.zip`, the standalone trail is `my-run_Trail_Line.stl`, and every file inside the archive starts with `my-run_`. This applies in both Mountain and City views. Unsupported filename characters are replaced with underscores.

The Mountain archive contains:

| File               | Description                                             | Condition           |
| ------------------ | ------------------------------------------------------- | ------------------- |
| `<gpx-name>_Terrain_Main.stl` | Main terrain mesh with base thickness and trail grooves | Always              |
| `<gpx-name>_Trail_Line.stl`   | Separate trail line mesh for color-swap printing        | With an imported GPX |
| `<gpx-name>_Tray_Base.stl`    | Tray base with inset groove and magnet holes            | Generate base enabled |
| `<gpx-name>_Tray_Text.stl`    | Bed-ready raised text; assembly placement in the guide                 | With enabled labels |
| `<gpx-name>_Tray_AMS.3mf`     | Base and text assembly with separate filament assignments | With enabled labels |
| `<gpx-name>_Tray_Cover.stl`   | NFC / LED cover plate                                   | When NFC is enabled |
| `<gpx-name>_Water_Insert.stl` (or numbered inserts) | Water parts with flat undersides, sized to sit in matching terrain recesses | With detected printable water |
| `<gpx-name>_Water_Assembly.txt` | Fit settings, assembly steps and water-detection status | When water is enabled |
| `<gpx-name>_Model.3mf` | Named colored terrain/trail/water and independent tray/text group | Direct 3MF target; fused ZIP |
| `<gpx-name>_Assembly.json` / `.txt` | STL placement transforms, water sources, versions and feature mappings | Complete ZIP |

Import the STL files into your slicer, assign colors and print settings, and start making.

---

## 📋 TODO

The following capabilities are still in development and not yet available to users:

- **Spray-paint segmentation:** After printing a single-color white model, apply rule-based surface coloring and generate fit-checked 3D stencil shells (`<gpx-name>_Mask_Color_XX.stl`) plus a color manifest for partitioned spray painting. See [PRD-spray-paint-masks.md](./PRD-spray-paint-masks.md).

---

## ⭐ Support the project

TrailPrint 3D is maintained by an individual developer. If you find it useful, please star the repo. Feedback and suggestions are welcome via [Issues](https://github.com/baozjj/TrailPrint-3D/issues).
