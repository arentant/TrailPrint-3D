**TrailPrint 3D security review — 20 September 2026**

Reviewed commit: `f8909baed1152d01b20eb76bc666ff20f457b38d`.

No obvious malware indicators were found in the application source and build scripts reviewed. Security weaknesses were found, including an outdated Electron runtime, an insufficiently protected renderer/main-process boundary, export path traversal, and a GPX parsing denial of service. This review does not establish that a distributed binary or every dependency is malware-free.

**Scope and verification**

- Searched 160 application, shared-code, asset, and script files; manually traced Electron startup, preload/IPC, GPX import, external requests, local storage, export, and file writes. Also inspected package/build configuration and scanned bundled `.claude` helper code for suspicious execution patterns.
- Queried npm's live advisory database against the lockfile, both with and without development dependencies. No dependencies were installed and no package lifecycle scripts or application build commands were run.
- Compared the recorded integrity values for all direct dependencies plus every package marked `hasInstallScript` with official npm metadata: **23 of 23 matched**. This checks those lock entries, not the contents of downloaded packages or the entire transitive graph.
- Ran bounded, isolated tests using the actual GPX parser, filename function, and STL writer after removing TypeScript types/import plumbing. Test files stayed inside a disposable `/tmp` directory and were removed. The full Electron app/export pipeline was not launched.
- No `node_modules`, `out`, `dist`, or `release` directory was present. Installed binaries, code signatures, runtime network traffic, the operating system, and git history were not scanned. No application code was changed.

**Dependency results**

| Audit scope | Critical | High | Moderate | Low | Total flagged package entries |
| --- | ---: | ---: | ---: | ---: | ---: |
| Entire lockfile | 1 | 24 | 1 | 1 | 27 |
| `--omit=dev` | 0 | 4 | 0 | 0 | 4 |

These totals include parent packages flagged because of a vulnerable dependency; they are not counts of independently exploitable application bugs. Electron is recorded as a development dependency, but its runtime ships in the desktop application, so the production-only audit understates desktop runtime exposure.

The most relevant dependency findings are:

- **Electron 35.1.5:** known security advisories, including the context-isolation bypass discussed below. Electron 35 reached end of life on 2 September 2025. Upgrade to a current patched, supported stable line and retest the desktop app. npm's suggested 35.7.5 update does **not** resolve newer advisories affecting versions below 39.8.9. [Release schedule](https://releases.electronjs.org/schedule), [upstream isolation advisory](https://github.com/electron/electron/security/advisories/GHSA-h7rp-cf8h-j98x).
- **tar 6.2.1 — critical advisory:** decompression/parse resource exhaustion in the build dependency tree. This is not evidence that importing a GPX file can exploit tar; application code does not extract tar archives. The audit proposes updating `electron-builder` from 26.0.12 to 26.15.3 to address this dependency chain. [Upstream advisory](https://github.com/isaacs/node-tar/security/advisories/GHSA-23hp-3jrh-7fpw).
- **Vite 6.3.2 — high advisories:** development-server file disclosure. The WebSocket advisory requires a network-exposed dev server; no explicit `--host` or `server.host` setting was found in this repository. The audit proposes 6.4.3, which should be treated as an upgrade candidate requiring compatibility checks. [Upstream advisory](https://github.com/vitejs/vite/security/advisories/GHSA-p9ff-h696-f583).
- The production-only audit flags **brace-expansion, glob, nanoid, and postcss**. No direct use of the affected glob CLI, unsafe nanoid size APIs, or untrusted PostCSS transformation was found in application code. These still need dependency updates, but their advisory severity alone does not establish a reachable attack here.

**Finding 1 — High: vulnerable Electron isolation with the renderer sandbox disabled**

Evidence: [package.json](/Users/arentant/Documents/TrailPrint-3D/package.json:33), [window settings](/Users/arentant/Documents/TrailPrint-3D/electron/main/index.ts:40), [Promise-returning preload bridge](/Users/arentant/Documents/TrailPrint-3D/electron/preload/index.ts:56).

The app pins Electron 35.1.5, sets `sandbox: false`, and exposes Promise-returning functions wrapping `ipcRenderer.invoke`. Those are relevant prerequisites for GHSA-h7rp-cf8h-j98x: hostile web content can cross context isolation, with possible Node.js access in an unsandboxed renderer. The maintainer explicitly excludes applications that never load untrusted content; the navigation gap in Finding 2 therefore matters. This review did not demonstrate an end-to-end exploit or identify an application XSS injection. [Upstream advisory](https://github.com/electron/electron/security/advisories/GHSA-h7rp-cf8h-j98x).

Fix: upgrade Electron to a supported patched release and enable the renderer sandbox. The current preload is built as ESM, so enabling the sandbox also requires bundling a compatible CommonJS preload; changing only the flag would break preload loading. [Electron preload guidance](https://www.electronjs.org/docs/latest/tutorial/esm#sandboxed-preload-scripts-cant-use-esm-imports).

**Finding 2 — High: navigation and IPC lack a trusted-page boundary**

Evidence: [window creation](/Users/arentant/Documents/TrailPrint-3D/electron/main/index.ts:31), [IPC wrapper](/Users/arentant/Documents/TrailPrint-3D/electron/main/ipc/handlers.ts:41), [GPX file access](/Users/arentant/Documents/TrailPrint-3D/electron/main/gpx/parse-gpx.ts:154), [map attribution link](/Users/arentant/Documents/TrailPrint-3D/src/utils/basemap-tiles.ts:29).

There is no navigation allowlist or `will-navigate` guard. `setWindowOpenHandler` only handles new-window requests. The Gaode attribution includes a normal external anchor without `target="_blank"`, providing a source-level route for replacing the app document with a remote page. Preload exposes the bridge unconditionally, and IPC handlers never check `event.senderFrame`, the page URL, or whether the caller is the expected main frame. A remote document loaded in this window can therefore inherit capabilities intended for the app.

One exposed capability accepts any `filePath` and reads it without a main-process file picker or an authorization token. The isolated parser test successfully returned a private test track from a `.txt` path supplied by the caller. This demonstrates unapproved GPX-content disclosure, **not unrestricted disclosure of arbitrary text files**: the parser only returns recognized GPX fields. Existence/error information and main-process resource consumption are additional consequences.

Prerequisite: hostile JavaScript must run in the privileged window, such as after an untrusted navigation or renderer compromise. The full browser navigation chain was assessed from source, not exercised in a running Electron instance.

Fix: restrict main-window navigation to the packaged app, deny unexpected redirects, validate the exact sender/frame in every IPC handler, and validate request data at runtime. Authorize file access through a main-process picker and opaque handles, or accept only content obtained from a user-selected file. Electron documents navigation restrictions and sender validation as required safeguards. [Security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

**Finding 3 — Medium: a renderer-supplied color index escapes the export folder**

Evidence: [unvalidated export plan](/Users/arentant/Documents/TrailPrint-3D/electron/main/export/export-service.ts:267), [filename construction](/Users/arentant/Documents/TrailPrint-3D/electron/main/spray-paint/mask-generate-service.ts:18), [file write](/Users/arentant/Documents/TrailPrint-3D/electron/main/export/export-service.ts:326).

`sprayPaintPlan.colors[i].index` is declared as a number, but IPC does not enforce that type. `maskFileName` converts it with `String()`, and the resulting filename is joined to the temporary export directory without a containment check. For example, the string `x/../../outside-export` produces `Mask_Color_x/../../outside-export.stl`, which normalizes to a location outside the export directory.

The actual filename function and STL writer were tested together: they wrote a 134-byte STL outside the test export directory while remaining inside the disposable test root. The application performs this write before displaying its save dialog, so cancellation cannot protect against it. Writes remain constrained to STL-formatted content and a `.stl` suffix; arbitrary code execution was not established.

Prerequisite: a caller able to invoke the preload API with a crafted plan, plus otherwise valid export/terrain data. Ordinary numeric UI input does not trigger this issue. This is a confirmed file-writing primitive at the function level with the full IPC/export path traced statically.

Fix: validate color indices as bounded positive integers, preferably generate names from a trusted loop counter, and verify that the resolved output path remains inside the work directory before every write.

**Finding 4 — Medium: malformed GPX causes quadratic main-process parsing**

Evidence: [track-point expressions](/Users/arentant/Documents/TrailPrint-3D/electron/main/gpx/parse-gpx.ts:7), [synchronous parsing](/Users/arentant/Documents/TrailPrint-3D/electron/main/gpx/parse-gpx.ts:123), [unbounded input loading](/Users/arentant/Documents/TrailPrint-3D/electron/main/gpx/parse-gpx.ts:158).

Repeated opening `<trkpt>` tags without matching closing tags cause repeated rescanning. Imports have no byte or point limit, and parsing occurs synchronously in the Electron main process. A user opening an attacker-supplied `.gpx` can therefore freeze the app; renderer compromise is not required.

Measured using the actual parser in Node 22.14.0, with a 1.5-second timeout on each probe:

| Opening tags | Input bytes | Parse time |
| ---: | ---: | ---: |
| 1,000 | 25,011 | 6.3 ms |
| 2,000 | 50,011 | 23.6 ms |
| 4,000 | 100,011 | 92.1 ms |
| 8,000 | 200,011 | 383.7 ms |

Doubling input increases time approximately fourfold. Larger inputs were not run to exhaustion. Fix with bounded input size and point counts, a streaming parser configured to reject DTD/external entities, and parsing in a worker with a cancellation/time budget. Extension checks alone do not address this.

**Finding 5 — Medium: unrestricted external URL schemes reach the OS**

Evidence: [new-window handler](/Users/arentant/Documents/TrailPrint-3D/electron/main/index.ts:52).

Every requested new-window URL is passed directly to `shell.openExternal`. There is no protocol or destination allowlist. A compromised renderer or remote page in the app window can ask the OS to dispatch custom protocols; consequences depend on installed handlers and platform behavior. This review did not invoke any dangerous protocol or establish OS command execution.

Fix: parse URLs and allow only necessary HTTPS destinations before calling `openExternal`; reject credentials, unexpected ports, local-file URLs, and other schemes. [Electron guidance](https://www.electronjs.org/docs/latest/tutorial/security#15-do-not-use-shellopenexternal-with-untrusted-content).

**Finding 6 — Low: API key stored in renderer-readable plaintext**

Evidence: [key loading and build-time fallback](/Users/arentant/Documents/TrailPrint-3D/src/stores/config.ts:18), [key persistence](/Users/arentant/Documents/TrailPrint-3D/src/stores/config.ts:229).

The OpenTopography key is persisted in `localStorage` and included in renderer configuration. Code running in the app origin can read it; access to the profile's storage also exposes it. In addition, setting `VITE_OPENTOPOGRAPHY_API_KEY` during a build can embed a shared key in shipped renderer assets. No actual committed key was found, and the current checkout contains no release bundle to inspect.

Fix: keep persistent credentials in the main process using OS-backed storage, expose only operations that use the key, and remove the client-side build-time secret fallback from release builds.

**Additional hardening**

- [DEM downloads](/Users/arentant/Documents/TrailPrint-3D/electron/main/terrain/opentopography-provider.ts:134) and [satellite downloads](/Users/arentant/Documents/TrailPrint-3D/electron/main/spray-paint/satellite-crop.ts:26) buffer the full response without a byte cap. [GeoTIFF decoding](/Users/arentant/Documents/TrailPrint-3D/electron/main/terrain/geotiff-sampler.ts:24) has no maximum raster dimensions. Add download/decode budgets; exploiting remote responses currently requires control over a trusted provider or equivalent access.
- [The CSP](/Users/arentant/Documents/TrailPrint-3D/index.html:7) permits connections to any `ws:` and `wss:` destination. Restrict development WebSocket permissions to development builds. This is defense in depth, not an injection vulnerability on its own.
- The main process has no explicit permission request/check policy. Deny permissions the app does not need, especially if navigation can load remote content. [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

**Malware and supply-chain observations**

No application-source indicators of credential harvesting, cryptocurrency mining, hidden shell commands, persistence installation, or dynamically evaluated/obfuscated payloads were found. Expected file access consists of GPX reads, DEM caching, and model/export writes. Identified runtime destinations are OpenTopography, Esri/ArcGIS imagery, Gaode/AMap imagery and links, and Google Fonts. Requests disclose map-area/tile coordinates to mapping providers as part of the app's functionality; that is not evidence of malware.

The lockfile has 607 dependency entries: 606 resolved through `registry.npmmirror.com` and one pinned `electron/node-gyp` GitHub commit. All entries have integrity fields. The mirror is an additional supply-chain dependency, not evidence of infection. The 23 checked entries match official npm integrity metadata. Five entries advertise install scripts: Electron, electron-winstaller, esbuild, fsevents, and vue-demi. Their registry metadata identifies conventional install/build hooks; their package contents were not downloaded or audited.

Positive controls include `contextIsolation: true`, `nodeIntegration: false`, a restrictive script CSP, named preload methods rather than a generic renderer-accessible IPC invoker, escaped Vue text interpolation, HTTPS provider endpoints, randomized temporary export directories, and a native save dialog for the final ZIP. These controls do not eliminate the findings above.

**Remediation order**

1. Update Electron and restore sandboxing; restrict navigation and authenticate IPC senders.
2. Validate all IPC payloads, fix export filename containment, and restrict GPX filesystem access.
3. Replace/bound GPX parsing and impose download/decode resource limits.
4. Update electron-builder, Vite, and transitive dependencies; rerun both audits and verify remaining advisories individually.
5. Restrict external URL handling and move API-key persistence into the main process.

**Saved evidence**

- [Full npm audit JSON](/tmp/trailprint-security-audit.json)
- [Production-only npm audit JSON](/tmp/trailprint-security-audit-production.json)
- [Official registry integrity comparisons](/tmp/trailprint-security-integrity.json)
- [Bounded probe harness](/tmp/trailprint-security-probes.cjs)
- [Probe results](/tmp/trailprint-security-probes-results.jsonl)

Temporary evidence files can be removed by normal system cleanup. Run the probe harness from the repository root. The scan commands were `npm audit --package-lock-only --ignore-scripts --json` and the same command with `--omit=dev`; audit results reflect the advisory database at review time.
