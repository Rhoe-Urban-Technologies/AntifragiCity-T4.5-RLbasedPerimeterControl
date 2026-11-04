# ATC UI: perimeter definition and training jobs

A sample dashboard for the SUMA Antifragile Traffic Control (ATC) module. You choose Region A on an OpenStreetMap
base map, review the boundary traffic lights and how their phases split between B→A and A→B, adjust them, and
start training jobs and follow them as they run. It was built from the rhoe-ui `app-dashboard` template and wears
the AntifragiCity brand from [antifragicity-ui](https://github.com/Rhoe-Urban-Technologies/antifragicity-ui)
(`@antifragicity/theme`), like the SUMA UI: `@rhoe/ui`, `@rhoe/data`, React Router, English and Greek, light and
dark.

The back end is the FastAPI app in [`../atc_api`](../atc_api). See the repository README for how the parts fit.

## Run it

You need:

- the one-time GitHub Packages token for the private `@rhoe/*` packages: a classic token with `read:packages` in
  your user `~/.npmrc` (see the rhoe-ui README). This folder's `.npmrc` says where the scope lives and sets
  `omit=peer`, as antifragicity-ui does (its README explains why);
- **antifragicity-ui checked out next to this repository** (`../antifragicity-ui`, so
  `~/code-repos/antifragicity-ui` beside `~/code-repos/ac-t4.5`). `@antifragicity/theme` isn't published yet, so
  `package.json` links it with `file:../../antifragicity-ui/packages/theme`. Pull that repository to get theme
  updates.

```bash
# terminal 1, repository root: the API (the Python venv from the main README, plus the API requirements)
python -m pip install -r requirements.txt -r requirements-api.txt
uvicorn atc_api.main:app --port 8000

# terminal 2, this folder
npx npm@11 install     # the first time (as in antifragicity-ui); later: npm ci
npm run dev            # http://localhost:5180 (proxies /api to :8000; ATC_API=… to change)
```

The API runs training jobs as local background processes, so it needs `sumo` on PATH and `SUMO_HOME` set, like
the trainer. Start it from the environment you train from.

```bash
npm run typecheck      # tsc --noEmit
npm test               # Vitest (jsdom, stubbed fetch)
npm run build          # dist/ (deploy as a single-page app; serve /api from the ATC API)
```

## Pages

| Route | Page | What it does |
|---|---|---|
| `/` | Perimeter | The LuST road network on the map, with Region A in teal. Set Region A by drawing a polygon (click points, double-click or Enter to close), by using the current map view, or with the reference region. Every change calls `POST /api/perimeter/analyze`, which returns the boundary lights (shape and colour by status), the crossings they control, the shared action range and any problems. Select a light, on the map or in the list view, to leave it out or change the role of a green phase. **Set up training** opens the job settings (defaults are the reference experiment's) and submits `POST /api/training-jobs`. `?from=<job id>` loads a job's selection |
| `/jobs` | Training jobs | All jobs with status and progress, polled while any is active. The sidebar badge counts running and queued jobs |
| `/jobs/:id` | Training job | `RunPanel` (queued → running → completed / failed / cancelled, with cancel), the trainer's log, KPIs, completed trips and learner losses per round (each with a table and CSV), and the perimeter. **Use as a starting point** reopens the selection on the map |

## Structure

```
src/api/            client (createApiClient on /api), types (atc_api shapes), queries (keys, fetchers, polling hooks)
src/app/            providers, Root (RhoeProvider), Shell (sidebar, top bar, focus), routes (lazy pages), page titles
src/routes/perimeter/
  PerimeterPage.tsx the map page: region sources, layers, analysis, list view
  DrawLayer.tsx     polygon drawing on RhoeMap via useMap() (RhoeMap keeps its own click handling)
  LightPanel.tsx    one light: include it, and the role of each green phase
  TrainingDrawer.tsx the job's settings and submission
src/routes/jobs/    JobsList, JobDetail
src/i18n/           en.ts, el.ts (the app's strings; @rhoe/ui translates its own)
```

## Differences from the template

- **No sign-in.** SUMA Security will sit in front of the API. To add sign-in, bring back the template's `AuthProvider`,
  `src/auth` and the auth routes.
- **No fake API.** The app always calls the real one: `VITE_API_URL`, default `/api`.
- **Published packages.** The app depends on `@rhoe/*@^1.1.0` from GitHub Packages, not `file:` links, so Renovate
  can keep it up to date. The one exception is the theme (below).
- **AntifragiCity brand.** `main.tsx` loads `@antifragicity/theme/fonts.css` and `theme.css` after the kit's CSS, so
  every component takes the AntifragiCity tokens (French Plum actions, Archivo and Source Sans 3). The favicon is the
  AntifragiCity symbol, the error pages don't draw the Rhoé logo, and the sidebar foot has the EU funding line.
- **Sidebar logo workaround.** rhoe-ui's `Sidebar` draws the Rhoé logo itself. Until it has a project logo slot
  (antifragicity-ui `UPSTREAM.md`), `app.css` hides it and shows the AntifragiCity logo (the symbol when the sidebar is
  collapsed). Remove the rule when the slot is released.
- **Map colours.** `mapPalette()` has the kit's own colours, not the project theme's. Region A takes the theme's
  teal (`--rh-series-4`) from the page tokens (`regionColor` in `src/routes/perimeter/status.ts`). The light statuses
  keep the kit's success / warning / danger colours.

## When the theme is published

antifragicity-ui's theme README says how: publish it to GitHub Packages, then in `package.json` replace the `file:`
link with `"@antifragicity/theme": "npm:@rhoe-urban-technologies/antifragicity-theme@^x.y.z"`, and remove the `THEME`
lines (`server.fs.allow`, `resolve.dedupe`) and the two `@fontsource` dependencies, which the package brings itself.

## Notes

- **Base map:** OpenFreeMap vector tiles built from OpenStreetMap data, the rhoe-ui default. For production, self-host
  the tiles and set `VITE_MAP_TILES`. `?tiles=off` draws only the data layers, and automated browsers get no tiles
  unless the URL has `?tiles=on`.
- **Keyboard users:** drawing a polygon needs a pointer. Keyboard and screen-reader users can use the reference
  region, the map view and the list view of the lights.
- **API messages:** perimeter problems and light notes come from the API in English.
