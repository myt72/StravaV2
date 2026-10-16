# StravaV2

## Setup

Install the dependencies, create a local config file from the example, and add
your Strava client ID and client secret:

```sh
npm install
cp config.local.example.js config.local.js
# Fill in client_id and client_secret in config.local.js.
npm run build
node server.js
```

Node 18 or newer is required. `npm start` builds the client and then starts the
server. On Windows, `Start Server.bat` installs dependencies only if
`node_modules` is missing, builds the client, and starts the server.

Open `http://localhost:5001/dashboard`. On first use, log in with Strava via
`http://localhost:5001/auth` once; the token is kept in the server's memory, so
log in again after restarting the server.

## Admin password (Data tab)

The Data & Admin tab and the endpoints behind it (`/api/analytics`, `/api/pr-backfill/*`, `/api/geo-backfill/*`)
are protected by one shared password checked on the server. Set `ADMIN_PASSWORD`
as an environment variable or in `config.local.js` (gitignored); the environment
variable wins. If it is not set, those endpoints always return `401`. The browser
asks for the password once and keeps it in `localStorage` (`adminPw`); a wrong
password clears it so you are asked again. After 10 failed attempts from one IP
in 15 minutes the server answers `429`. Use HTTPS if the server is reachable
over the internet, since the password is sent in a request header.

## Excluded segments

Segments excluded in the Records view (Segment summary / By distance / By elevation) are stored globally on the server in `settings.json` (gitignored), so they persist across browsers and sessions.

## Matched rides (Patterns page)

Strava's own "Matched Activities" is not in the public API, so StravaV2 matches routes itself. The
**Matched rides** card on the Patterns page lists the top 10/20/50 routes by number of matched rides
(all time, per year or per month; each row shows first/last ridden, distance, elevation and a route
thumbnail), or the same leaderboard grouped by segment (from `segmentData`, honouring excluded segments).
The card follows the global filters, including the top-of-page **activity type** filter (see *Sport groups*).

New fields in `cache.json`:

- `activities[].summary_polyline` (Google-encoded, precision 5), `start_latlng`, `end_latlng` — `""` / `[]` when an activity has no GPS data.
- `routeClusters` — `{ version, config, clusters: [{ routeId, sportGroup, representativeId, name, distance, elevation, activityIds }], index: { activityId: routeId }, computedAt }`. `version` is currently 2; a different version is discarded and rebuilt automatically. A cluster's polyline is taken from its representative activity.
- `geoBackfill` — progress of the geo backfill (`nextPage`, `completed`, `lastRunAt`, `pagesDone`).

Missing keys are defaulted, so existing `cache.json` files keep working.

**One-time geo backfill.** Existing caches lack the GPS fields. On the **Data** page use *Geo backfill* →
*Start geo backfill*. It re-pages `/athlete/activities?per_page=200` once, so it costs about
`ceil(activities / 200)` API calls (not one per activity) and merges the fields into cached activities by id.
It is resumable (progress is saved per page), stops while the remaining rate limit is under a reserve
(default 25; `?reserve=` on start), waits on `429` until the next 15-minute/daily window, and cannot run
at the same time as the PR backfill. When it finishes, routes are recomputed. New activities fetched by
Refresh / Resume / Updated include the fields automatically and are added to routes incrementally.
Until the backfill is done the Patterns card shows a notice with a link to the Data page.
The optional per-activity `/streams` refinement is not implemented; summary polylines are the only source.

How rides are matched (`lib/routeMatching.js`, defaults in `DEFAULT_MATCH_CONFIG`):

1. Start and end within 150 m (`START_END_RADIUS_M`, a grid hash limits comparisons) and distance within ±10% (`DISTANCE_TOLERANCE`).
2. Both routes are resampled to 100 equidistant points (`RESAMPLE_POINTS`).
3. Symmetric discrete Hausdorff distance, 95th percentile (`HAUSDORFF_PERCENTILE`), must be ≤ 150 m (`HAUSDORFF_THRESHOLD_M`).
4. DTW with a Sakoe-Chiba band (`DTW_BAND_FRACTION`), normalised by path length (mean offset), must be ≤ 75 m (`DTW_THRESHOLD_M`). The reversed route is also tried; reversed rides are reported as `direction: "reverse"` and are a different route unless `ALLOW_REVERSE` is true.
5. Score = weighted mix of the above plus the Jaccard overlap of shared `segment_id`s (`WEIGHT_*`, `MIN_SCORE` 0.4). Rides without a polyline fall back to segment overlap alone (≥ 3 segments each, Jaccard ≥ 0.8).

6. Optional **overlap match** (`OVERLAP_MIN_FRACTION`, default `0.8`; `0` turns it off; and `OVERLAP_DISTANCE_M`, default 40): a pair also matches when at least that fraction of *each* route's resampled points lies within `OVERLAP_DISTANCE_M` of the other route's polyline (point-to-segment, so Strava's low-resolution `summary_polyline` is handled). This tolerates small detours and slightly different starts/ends that Hausdorff/DTW reject; combine it with a larger `START_END_RADIUS_M`. It is on by default because calibration against Strava's matched-activity counts showed the Hausdorff/DTW gates undercounted rides that are clearly the same route.

**Sport groups.** Matching is done per group and groups never merge: **Ride** (`Ride`) and **Walk/Hike** (`Walk` + `Hike` together). Runs are not matched. Walk/Hike use tighter defaults (`GROUP_DEFAULT_CONFIGS.WalkHike`: distance tolerance 25% (Ride: 10%), start/finish 75 m, Hausdorff 75 m, DTW 35 m, overlap distance 25 m). No segment efforts are fetched for walks/hikes and segment overlap is never used in their scoring (the Jaccard weight is dropped when there is no segment data). The geo fields (`summary_polyline`, `start_latlng`, `end_latlng`) are captured for every activity type by the same `/athlete/activities` paging, so the existing geo backfill covers Walk/Hike; an existing cache just needs that one re-page.

**Matched rides card and the global filter.** The card has no selector of its own: it counts only activities that pass the global filter bar. Filter to Rides to see ride routes, to Walk or Hike to see those (a Walk and a Hike on the same trail are one route), or leave it on All to see routes from every group, each route belonging to one group. The Routes/Segments toggle is hidden when the filter contains no Rides, because segments only exist for rides.

**Clustering.** Leader clustering (earliest ride is the representative) fragmented routes: a ride slightly off the earliest ride's line became its own cluster although it matched most other rides. Clusters are now built from density/degree: pairwise direct matches are computed with the blocking pre-filter (grid hash on start/end plus the distance tolerance), then the ride with the most direct matches is picked as the route's **medoid** (ties: best mean score to its matches, then lowest id), it and its direct matches form one cluster, they are removed, and this repeats. Members must still match the representative directly (no transitive chaining) and each ride is in exactly one cluster, so results do not depend on input order. Incremental updates keep existing clusters; a new ride joins the best-scoring route it matches, otherwise new rides are density-clustered among themselves. Changing the cluster `version` or the settings triggers a full rebuild.

`matchesFor(activityId, activities, segmentData, config)` (exported from `lib/routeMatching.js`) returns every ride that matches an activity *directly* (overlapping sets are allowed). That per-activity count, not the cluster size, is comparable to Strava's "Matched Activities" number.

Thresholds can be overridden by `settings.json`'s `routeMatching` key or `PUT /api/settings/route-matching`, then run *Recompute routes* on the Data page (`POST /api/matched-rides/recompute`). Top-level keys apply to every group; `GROUP_OVERRIDES` sets per-group values, e.g. `{ "OVERLAP_MIN_FRACTION": 0.9, "GROUP_OVERRIDES": { "WalkHike": { "START_END_RADIUS_M": 100 } } }`. Precedence: defaults < group defaults < top-level settings < `GROUP_OVERRIDES`. `SPORT_TYPES` (default `Ride`, `Walk`, `Hike`) limits which types are matched. The settings endpoint rejects values outside the supported bounds; unlisted values keep their defaults.

## Segment rankings (Records > Segment summary)

**Currently disabled.** Strava returns HTTP 403 for the segment leaderboard endpoint for this app, so the panels are hidden.
Setting `SEGMENT_RANKINGS_ENABLED = true` in `client/src/lib/features.js` brings them back (the backfill would then stop on the same 403 until Strava allows it).
The description below is of the dormant feature.

The Segment summary tab lists the segments where you currently hold the KOM, 2nd or 3rd place (tiers are exclusive).
Strava only reports your own PR rank per effort, so current leaderboard ranks need a backfill:

1. Open **Data & Admin** and press **Start segment ranks** in the "Segment rankings" card. It resumes where it left off if stopped or rate limited.
2. It makes **one request per candidate segment** (`GET /segments/{id}/leaderboard?per_page=3`), plus one `/athlete` request per run.
   Candidates are ride segments where you have at least one cached PR (`pr_rank` 1), typically a few hundred, against Strava's default limits of 100 requests / 15 min and 1,000 / day (the job keeps a reserve and waits on 429s, same as the other backfills).
3. Your own entry is identified by `activity_id` when the response has it, otherwise by the `start_date` and `elapsed_time` of your fastest cached effort on that segment. If you are not in the top 3 the segment is recorded as unranked.
4. Use **Refresh ranks** later to re-check segments checked more than 7 days ago or with a newer PR. Pulling new activities does not trigger leaderboard requests automatically.

If Strava refuses leaderboard requests (HTTP 401/402/403), the job stops and shows the error on both pages instead of retrying.
Excluded segments are not applied to this section; efforts and last ridden follow the global filters.

## Calibrating route matching

The fixtures in `calibration/seeds.json` record four seed activities and the counts shown in Strava's
**Matched Activities** panel. Those counts were read from the Strava website: the public API does not expose
matched activity lists. Counts currently assume the seed is included (`includesSelf: true`); the report always
shows predictions with and without the seed so this can be changed per fixture.

1. Finish the geo backfill from the Data page first. It populates the local `cache.json` with each activity's
   summary polyline and start/end coordinates. The calibration tool makes no network requests and will clearly
   skip seeds whose GPS fields are absent.
2. Run the tests with `npm test`, then run `node scripts/calibrateRouteMatching.js`. Use
   `--seed 20547542160` to inspect one seed, `--json` for machine-readable output, or combine them.
3. Each seed reports **both** its per-activity direct match count (`matchesFor`, overlapping allowed; compare it
   with Strava's number) and its **cluster size**. **Split detection** then lists, for each seed, the other
   clusters that contain rides directly matching the seed, with counts: a large count means the route is
   fragmented across clusters. Read the funnel from start/finish candidates through distance, Hausdorff, DTW, and the final segment-overlap
   weighted match decision. The report compares match counts to the expected count in both self-inclusion
   interpretations. Without an ID list it prints the 15 closest accepted and rejected rides for manual review.
4. To add ground truth, open the seed's Strava Matched Activities panel and copy the activity IDs into
   `expectedMatchedIds`; put known non-matches in `notMatchedIds`. Dates in `YYYY-MM-DD` format are also accepted
   and mapped to cache activity IDs using `start_date` (all rides on that date are included). Empty arrays mean
   the list has not been collected yet. Once populated, the report includes precision, recall, F1, missed rides,
   extra rides, and known non-matches.
5. Run `node scripts/calibrateRouteMatching.js --sweep` to test a threshold grid (start/finish radius, distance
   tolerance, Hausdorff and DTW cutoffs, percentile, segment weight, `OVERLAP_MIN_FRACTION`, `OVERLAP_DISTANCE_M`
   and `ALLOW_REVERSE`). The readable ranking uses the total absolute error of the per-activity counts across all
   seeds, then F1 when matched lists are available. It writes the best candidate to
   `calibration/recommended-thresholds.json` and the full run to the gitignored
   `calibration/report.latest.json`. Review the recommendation against the Strava panel before changing
   `DEFAULT_MATCH_CONFIG`; the sweep does not silently change defaults. Supply a JSON config file with
   `--thresholds path/to/overrides.json` to test a starting override.

The committed synthetic fixtures cover noisy repeats, reverse direction, routes sharing a start, and a loop
versus an out-and-back. They are for deterministic, CI-safe tests and contain no personal GPS data.

API: `GET /api/matched-rides?period=all|year|month&year=YYYY&month=M&limit=N[&type=routes|segments]`,
`POST /api/matched-rides/recompute`, `POST /api/geo-backfill/start|stop` and `GET /api/geo-backfill/status`
(the recompute and geo backfill endpoints require the admin password). Year/month filters on the server use UTC; the UI uses your local time zone.

### Refreshing route matches after a matching change

Clusters are stored in `cache.json` under `routeClusters` (with a `version` and the `config` used). `saveCache` calls
`buildRouteClusters`, which keeps existing assignments only when the stored `version` equals `ROUTE_CLUSTER_VERSION`
(now `3`); otherwise it rebuilds from scratch. Changing a threshold alone does not re-cluster rides that are already
assigned, so after upgrading (the version bump) or editing the defaults:

1. Restart the app. The next cache save (any sync) rebuilds clusters automatically if the stored version is older.
2. To force a full rebuild without waiting, call `POST /api/matched-rides/recompute` (admin password required; the
   client exposes it as `recomputeMatchedRides`). It clears `routeClusters` and rebuilds every cluster, and returns 409
   while a geo backfill is running.
3. Saving route-matching settings via `PUT /api/settings/route-matching` also resets and rebuilds the clusters.

To get precision/recall/F1 and the exact missed rides from `scripts/calibrateRouteMatching.js`, add `expectedMatchedIds`
and `notMatchedIds` to the seeds in `calibration/seeds.json`.

Run the unit tests with `npm test`.

## Collapsible navigation

The left navigation has a toggle button at the top that switches between
icons + labels and a narrow icons-only rail (labels become tooltips). The choice
is saved in `localStorage` (`stravaV2:navCollapsed`). With no saved choice the nav
auto-collapses on viewports narrower than 1100px; a saved choice always wins.

## Macrodata Refinement page

With the **Severance (Lumon)** theme selected, the nav shows "Macrodata Refinement"
(`#/mdr`), a full-height `<iframe>` of the static app in `client/public/mdr/`
(a copy of https://github.com/RJoshi141/lumon). Vite serves that folder as-is at
`<base>/mdr/`, so its CSS/JS never touch the dashboard bundles. The Filters bar is
hidden on this page and the "Severance: animated/static" button moves to the top right.
On any other theme the nav entry is absent and `#/mdr` redirects to Overview.

**Attribution:** see `client/public/mdr/NOTICE.md`. The upstream repo has no licence, so
get the author's permission or replace the code before publishing.

**Remove it:** delete `client/public/mdr/`, `client/src/views/Mdr.jsx`, the `mdr` entries in
`client/src/App.jsx`, `NAV` (`Shell.jsx`) and `ui.jsx`, and the `.mdr-frame` / `data-view="mdr"` CSS rules.

## Themes

Pick a theme in the sidebar. Besides Default, Matrix and Retro OS there are two more themes:
**Glitch / Datamosh**: a near-black theme with cyan/magenta/yellow-green accents,
a low-resolution animated background (horizontal/vertical tears, pixel-sort
streaks, macroblock smears, duplicated regions, channel splits, scan rolls),
chromatic-split headings and a glitch-accented sidebar. Panels are
semi-transparent with a light blur so the effect shows through; dialogs, drawers,
tooltips and selects stay opaque. The fixed "Glitch: animated/static" button
toggles the animation (saved in `localStorage` as `strava:glitchFx`). It is
animated by default, even when the OS prefers reduced motion; an explicit
toggle choice always wins. Tunable constants are at the top of
`client/src/lib/glitchFx.js` and in the glitch token block of `theme.css`.

**TRON (1982 Grid)**: a black-void theme with electric cyan outlines, laser-red
accents and cut-corner panels. The background canvas draws a perspective grid
floor, light-cycle trails that turn at right angles and derez, data pulses and a
rare drifting identity disc. Headings use an Orbitron-style stack (no web font is
loaded), the sidebar avatar gets a rotating identity-disc ring, and view changes
use a stepped horizontal wipe. The fixed "Tron: animated/static" button toggles
all motion (saved in `localStorage` as `strava:tronFx`). It is animated by
default, even when the OS prefers reduced motion; an explicit toggle choice always
wins. Tunable constants (canvas opacity, trail count, spawn gap, grid speed) are
at the top of `client/src/lib/tronGrid.js`; panel alpha is in the tron token block
of `theme.css`.

**Severance (Lumon)**: a pale, sterile theme with Orbitron headings and navigation,
Chivo Regular uppercase grid listings, muted accents and flat matte semi-transparent
panels. The self-hosted WOFF2 files are in `client/public/fonts/`; both fonts are
licensed under the SIL Open Font License 1.1 (license texts are in that directory).
Sign panels use the reference image's sampled blue-grey fill (`#BCCFD9`) and thin
dark blue-grey border (`#1E3138`, approximately 1 px in the source image). Titled
cards and KPI tiles place their uppercase title inline at the bottom-left, flush with the
panel edge; the left border stops a gap above the title with a square cut and the bottom
border continues to its right. The fill extends past the inset border line by
`--severance-panel-bleed` (5px, about 11px of the 500px reference). Tune
`--severance-panel-fill`, `--severance-panel-border`,
`--severance-panel-border-width`, `--severance-panel-bleed`, `--severance-title-size`,
`--severance-title-gap` and the percentage panel alpha tokens in the
Severance block of `client/src/styles/theme.css`; `--font-heading` and `--font-grid`
select the two typefaces there. Translucent panels keep the canvas visible, while
dialogs, drawers, tooltips and selects use the same fill opaquely. The background
canvas draws a sparse
"Macrodata Refinement" field of faint drifting digits that occasionally swell in a
cluster, are "refined" into an outlined box every 10 to 20 s (measured from the end of the
previous 6 s event, so events never overlap), plus a very faint scan line that sweeps every 10 s.
Lower `DIGIT_ALPHA` / `OPACITY` in `severanceFx.js` to make the digits quieter. The
fixed "Severance: animated/static" button toggles all motion (saved in
`localStorage` as `strava:severanceFx`). It is animated by default, even when the OS
prefers reduced motion; an explicit toggle choice always wins. Tunable constants (canvas opacity, digit
spacing/size, cluster and refinement gap ranges, sweep period) are at the top of
`client/src/lib/severanceFx.js`.

## Frontend (Vite + React)

The UI lives in `client/` and is built into `client/dist/` (gitignored), which
the server serves at `/dashboard`.

- Run `npm install` only when dependencies change (or `node_modules` is missing).
- Run `npm run build` after pulling UI changes.
- For UI development, use two terminals: `node server.js` (API on port 5001) and
  `npm run dev` (Vite with hot reload on `http://localhost:5173`, proxying
  `/api`, `/auth` and `/exchange_token` to port 5001). Log in via the 5001 server
  first.

The server creates or updates `cache.json` as it saves data fetched from Strava.
It can be regenerated by fetching the data again.
