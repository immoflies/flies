# Static Vercel deployment compatibility

No deployment has been made. Importing/publishing to an account requires the owner's separate approval. No credentials, project linking or domain changes are needed for local verification.

## Exact import settings

Import the repository in Vercel **only when publishing is authorized**:

| Setting | Value |
| --- | --- |
| Root Directory | Repository root (`.`); if importing a monorepo, select `fruitflyweb` |
| Framework Preset | **Other** (`framework: null` in `vercel.json`) |
| Node.js Version | **22.x** (package requires Node >=22.18.0) |
| Install Command | `npm install --ignore-scripts --no-audit --no-fund` |
| Build Command | `npm run build:live` |
| Output Directory | `public` |
| Environment Variables | None |

The version-controlled `vercel.json` supplies the install/build/output settings. Do not select Next.js, add an API directory, set a backend URL, or point the project root directly at `public`.

## Build and runtime contract

The build runs `node scripts/build-live.mjs`. It reads the checked-in game, circuit graph, trained checkpoint and local overlays; writes `public/live.js` and `public/index.html`; and copies local vendor audio. It does **not** train, benchmark, download a connectome/atlas, run Python, or fetch model weights. There are no npm dependencies; lifecycle scripts are disabled during install.

`.vercelignore` controls upload exclusions, not the deployed output. Keep `scripts/`, `src/`, `vendor/`, `overlay/`, `games/`, `package.json` and the entire `public/` tree available to the remote build. Only the resulting `public/` directory is served. Documentation/test files, local environment files and VCS metadata are excluded from upload.

The browser uses relative `style.css`, `audio.js`, `live.js`, `panels.js` and `data/brain-atlas/*` URLs. Keep the atlas manifest and its binary payloads together. Preserve source/license notices and the visible footer attribution. External GitHub attribution links are navigation only, not runtime dependencies.

The runtime overlay disables inherited camera initialization and WebSocket connections. Hidden camera/control DOM hooks remain because the unmodified vendor game requires their IDs, not because the static site needs camera permissions. There is no backend, server function, WebSocket service, camera feed, API secret, database or training service to provision. Serve over HTTP(S), not `file://`, so local atlas fetches work.

## Local verification (no account)

After all concurrent source edits have been integrated:

```sh
npm run build:live
node --test tests/deployment.test.mjs
npm test
python3 -m http.server 8137 -d public
```

Open `http://localhost:8137`. Verify auto-play and score/time advancement, all three telemetry panels, brain drag/zoom, automatic restart, and no page overflow at desktop and 390px width. The deployment tests can also run **before** rebuilding: `renderHtml()` and `assembleLive()` produce the exact template/bundle in memory without rewriting the official generated files.

Check the browser network panel for local asset success and absence of WebSocket or camera permission requests. Vercel serves this same static directory; no account deployment is required to establish compatibility. Publishing is a separate, explicitly authorized step.

## Routes after the picker refactor
Current branch has two games:
- `/monitor.html` — the game picker (landing CTAs point here).
- `/runner.html` — the original Immortal Fruit Fly monitor.
- `/saber/index.html` — the experimental autonomous saber scene.
- `/` — project landing.

`build:live` copies `games/saber/` (self-contained snapshot) to `public/saber/`.
