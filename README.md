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
The card follows the global filters.

New fields in `cache.json`:

- `activities[].summary_polyline` (Google-encoded, precision 5), `start_latlng`, `end_latlng` — `""` / `[]` when an activity has no GPS data.
- `routeClusters` — `{ version, config, clusters: [{ routeId, representativeId, name, distance, elevation, activityIds }], index: { activityId: routeId }, computedAt }`. A cluster's polyline is taken from its representative activity.
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

How rides are matched (`lib/routeMatching.js`, defaults in `DEFAULTS`):

1. Start and end within 150 m (`START_END_RADIUS_M`, a grid hash limits comparisons) and distance within ±10% (`DISTANCE_TOLERANCE`).
2. Both routes are resampled to 100 equidistant points (`RESAMPLE_POINTS`).
3. Symmetric discrete Hausdorff distance, 95th percentile (`HAUSDORFF_PERCENTILE`), must be ≤ 150 m (`HAUSDORFF_THRESHOLD_M`).
4. DTW with a Sakoe-Chiba band (`DTW_BAND_FRACTION`), normalised by path length (mean offset), must be ≤ 75 m (`DTW_THRESHOLD_M`). The reversed route is also tried; reversed rides are reported as `direction: "reverse"` and are a different route unless `ALLOW_REVERSE` is true.
5. Score = weighted mix of the above plus the Jaccard overlap of shared `segment_id`s (`WEIGHT_*`, `MIN_SCORE` 0.4). Rides without a polyline fall back to segment overlap alone (≥ 3 segments each, Jaccard ≥ 0.8).

Only `Ride` activities are clustered (`SPORT_TYPES`). The earliest ride of a cluster is its representative
and every member must match it directly, so routes cannot chain together through neighbours. Thresholds can be
changed in `DEFAULTS`; then run *Recompute routes* on the Data page (`POST /api/matched-rides/recompute`).

API: `GET /api/matched-rides?period=all|year|month&year=YYYY&month=M&limit=N[&type=routes|segments]`,
`POST /api/matched-rides/recompute`, `POST /api/geo-backfill/start|stop` and `GET /api/geo-backfill/status`
(the recompute and geo backfill endpoints require the admin password). Year/month filters on the server use UTC; the UI uses your local time zone.

Run the unit tests with `npm test`.

## Collapsible navigation

The left navigation has a toggle button at the top that switches between
icons + labels and a narrow icons-only rail (labels become tooltips). The choice
is saved in `localStorage` (`stravaV2:navCollapsed`). With no saved choice the nav
auto-collapses on viewports narrower than 1100px; a saved choice always wins.

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
