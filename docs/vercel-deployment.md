# Browser app on Vercel

The browser edition supports GPX import, map framing, terrain and tray previews,
STL generation, and ZIP downloads using the existing Vue interface and geometry
pipeline. Electron commands still build and run the desktop edition.

## Run locally

Use Node.js 22 and npm:

```sh
npm ci
npm run dev:web
```

For the production build:

```sh
npm run build:web
npm run preview:web
```

Both web servers include the `/api/elevation` endpoint. Enter an OpenTopography
API key in the app, import a GPX file, frame the map, then choose **Preview &
export STL → Download**. **Download again** retrieves the last generated ZIP
without regenerating it.

## Deploy

Import this repository into Vercel, or run `vercel` from the project directory
with a signed-in Vercel account. Review the preview deployment before using
`vercel --prod` to publish production.

The checked-in `vercel.json` sets:

| Setting | Value |
| --- | --- |
| Framework | Vite |
| Install command | `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci` |
| Build command | `npm run build:web` |
| Output directory | `dist` |
| Node function | `api/elevation.ts` |
| Elevation timeout | 300 seconds |

Select Node.js 22 in the Vercel project settings. No deployment secrets are
required: each user supplies their own OpenTopography key. The web build
explicitly disables the development `VITE_OPENTOPOGRAPHY_API_KEY` fallback, and
`.vercelignore` excludes `.env` files, desktop output, fixtures, and local tests.

Do not deploy just the `dist` folder: the elevation API must be deployed alongside
the static app. Only the single root page is used, so no SPA catch-all rewrite is
needed.

## Processing and data

- GPX parsing and mesh generation stay on the user's device. A Web Worker keeps
  geometry processing off the interface thread and serializes generation jobs.
- `/api/elevation` accepts the map bounds, sampling settings, and user's API key.
  It calls the fixed OpenTopography endpoint, samples the downloaded GeoTIFF,
  and returns a compressed binary elevation grid. It does not receive GPX files
  or generated models. Responses are marked `private, no-store`.
- API keys are saved in the user's browser and forwarded through the endpoint
  to OpenTopography for elevation requests. They are never embedded in the build.
- ZIP creation and browser downloads happen locally. The most recent elevation
  grid is cached only in worker memory and is cleared when the page closes.
- Satellite imagery continues to come from the existing map providers.

The browser defaults to High mesh quality. Larger presets remain available but
depend on the device's memory. Imports are limited to 10 MB / 100,000 points.
Elevation downloads are limited to 32 MB, rasters to 16 million pixels, and the
sampling grid to 1536 per side. A custom grid whose compressed response exceeds
4.4 MB produces an actionable error to choose a lower quality. Large map areas
may require a smaller crop.

## Checks

```sh
npm run typecheck
npm run build
npm run build:web
npm run test:web
```

Browser tests use an installed Google Chrome in headless mode. Alternatively,
install Playwright Chromium with `npx playwright install chromium` and run
`PLAYWRIGHT_CHANNEL=chromium npm run test:web`. The test suite uses deterministic
elevation data for the full GPX → preview → ZIP workflow, checks binary STL
contents and repeat downloads, and tests invalid GPX and elevation API requests.
Live OpenTopography access requires a valid user key and provider availability.
