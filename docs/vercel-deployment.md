# Browser app on Vercel

The browser edition supports GPX import, map framing, terrain and tray previews,
STL generation, and ZIP downloads using the existing Vue interface and geometry
pipeline. Electron commands still build and run the desktop edition.

## Run locally

Use Node.js 22 and npm:

```sh
npm ci
# Add the authentication settings from .env.example to .env.local (see below).
npm run dev:web
```

For the production build:

```sh
npm run build:web
npm run preview:web
```

Both web servers include the authentication and `/api/elevation` endpoints.
Use `AUTH_URL=http://localhost:5173` for development, or
`AUTH_URL=http://localhost:4173` for preview, and register the corresponding Google
redirect URI. Sign in with an approved Google account, then enter an OpenTopography
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
| Node functions | `api/auth.ts`, `api/elevation.ts` |
| Elevation timeout | 300 seconds |

Select Node.js 22 in the Vercel project settings. Configure the authentication
variables below before deploying. Each user supplies their own OpenTopography key. The web build
explicitly disables the development `VITE_OPENTOPOGRAPHY_API_KEY` fallback, and
`.vercelignore` excludes `.env` files, desktop output, fixtures, and local tests.

Do not deploy just the `dist` folder: both APIs must be deployed alongside the
static app. The authentication rewrite maps `/api/auth/*` to `api/auth.ts`.

## Google sign-in and approved emails

The browser edition requires Google sign-in. The desktop edition runs locally
without sign-in. No user database is required.

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) in
   your Google Cloud project and configure its branding and audience. Choose an
   external audience when allowing both Gmail and Google Workspace accounts. If
   the app is in testing, add the approved accounts as Google test users too.
2. Create an OAuth client with application type **Web application**. Register
   this authorized redirect URI for the current production domain:
   `https://trail-print-3-d.vercel.app/api/auth/callback/google`.
   For local development, also register
   `http://localhost:5173/api/auth/callback/google` (or port 4173 for preview).
3. Set these server environment variables in Vercel for the target environment:

   | Variable | Value |
   | --- | --- |
   | `AUTH_URL` | `https://trail-print-3-d.vercel.app` (origin only) |
   | `AUTH_GOOGLE_ID` | Google OAuth client ID |
   | `AUTH_GOOGLE_SECRET` | Google OAuth client secret |
   | `AUTH_SECRET` | A random secret from `openssl rand -base64 32` |
   | `ALLOWED_EMAILS` | Comma-separated exact email addresses |

4. Deploy after setting the variables. For a different domain or a preview
   deployment, configure its own `AUTH_URL` and matching Google redirect URI;
   OAuth callbacks must return to the same origin that started sign-in.

Email matching is case-insensitive and requires Google's `email_verified` claim.
An empty/missing allowlist denies all access; domains, wildcards, and implicit
Gmail aliases are not accepted. The allowlist stays on the server and is not
returned to the browser. To change access, edit `ALLOWED_EMAILS` in Vercel and
redeploy. Removed addresses are denied on their next session/API check against
the updated deployment, even if their old cookie has not expired.

Auth.js handles the authorization-code flow with state, PKCE, nonce and CSRF
checks. Sessions use encrypted HttpOnly cookies, Secure in HTTPS deployments,
with an eight-hour lifetime renewed on activity. `/api/elevation` requires an
approved session before parsing requests or contacting OpenTopography. Sign-out
clears the session cookie. The workspace also rechecks access on focus and once
per minute while visible. Missing authentication configuration fails closed.

Keep these variables server-only: do not prefix them with `VITE_`.
See [Auth.js Google provider](https://authjs.dev/reference/core/providers/google)
and [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
for provider setup details.

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
npm run test:api
npm run test:web
```

Browser tests use an installed Google Chrome in headless mode. Alternatively,
install Playwright Chromium with `npx playwright install chromium` and run
`PLAYWRIGHT_CHANNEL=chromium npm run test:web`. The test suite uses deterministic
elevation data for the full GPX → preview → ZIP workflow, checks binary STL
contents and repeat downloads, and tests invalid GPX and elevation API requests.
It also covers the sign-in screen, denied accounts, sign-out, and session expiry.
Tests run an isolated server with test-only credentials and signed session cookies;
the production app has no authentication bypass. API tests exercise a mocked
Google OAuth round trip, CSRF/state checks, allowlist enforcement, revoked and
expired sessions, and secure cookie attributes. They make no Google requests.
Live OpenTopography access requires a valid user key and provider availability.

The API uses Node ESM imports with explicit `.js` extensions, including imports
between shared TypeScript modules. Vite accepts extensionless imports locally,
but deployed Node functions do not. `tsconfig.api.json` checks Node's resolution
rules, and `test:api` compiles and starts the endpoint in plain Node to catch
deployment-only module-loading failures.

## City map provider

City uses the authenticated `/api/city` endpoint. The request contains crop bounds
and building/road layer switches; it does not contain GPX tracks, API keys or
meshes. The endpoint queries Overpass, caches successful map responses in bounded
server memory and returns compressed OSM JSON for local conversion and solid
model generation. Responses remain `private, no-store`.

Optionally configure the server-only `CITY_OVERPASS_URL` to an Overpass interpreter
endpoint operated for your deployment. The default is
`https://overpass-api.de/api/interpreter`. The local Vite API and Electron main
process also read this setting. Do not use a `VITE_` prefix or let clients choose
the provider URL. `/api/city` has a 120-second function budget in `vercel.json`.

City Flat mode needs no elevation key and does not request elevation. Real terrain
uses the existing `/api/elevation` endpoint and persisted user key. City generation
bounds downloads and solid operations, including a 512 × 512 DEM grid limit.
See [model export flows](model-export-flows.md) for defaults, limits and print notes.
