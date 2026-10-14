"use strict";

const crypto = require("crypto");
const { decodePolyline } = require("./polyline");

/**
 * Route matching. Staged pipeline, cheapest first:
 *  1. Blocking: start/end within START_END_RADIUS_M (or loop rides with starts close) and distance within
 *     DISTANCE_TOLERANCE. A grid hash over cluster representatives limits which pairs are compared.
 *  2. Resample both routes to RESAMPLE_POINTS equidistant points (local equirectangular projection, meters).
 *  3. Discrete symmetric Hausdorff distance (HAUSDORFF_PERCENTILE tolerates GPS noise).
 *  4. DTW (Sakoe-Chiba band) normalised by warping-path length = mean point offset in meters.
 *     Both the forward and the reversed route are tried; the best one is reported as `direction`.
 *  5. Jaccard overlap of segment_id sets as a corroborating signal, and the only signal when a
 *     polyline is missing.
 */
const DEFAULTS = Object.freeze({
  START_END_RADIUS_M: 150,
  DISTANCE_TOLERANCE: 0.10,
  RESAMPLE_POINTS: 100,
  HAUSDORFF_THRESHOLD_M: 150,
  HAUSDORFF_PERCENTILE: 0.95,
  DTW_THRESHOLD_M: 75,
  DTW_BAND_FRACTION: 0.1,
  MIN_SCORE: 0.4,
  WEIGHT_HAUSDORFF: 0.4,
  WEIGHT_DTW: 0.4,
  WEIGHT_JACCARD: 0.2,
  SEGMENT_FALLBACK_MIN_JACCARD: 0.8,
  SEGMENT_FALLBACK_MIN_SEGMENTS: 3,
  ALLOW_REVERSE: false,
  SPORT_TYPES: Object.freeze(["Ride"])
});

const EARTH_RADIUS_M = 6371000;
const toRad = d => (d * Math.PI) / 180;

function haversine(a, b) {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversine(points[i - 1], points[i]);
  return total;
}

/** Resample [[lat,lng]...] to n points equally spaced along the path. */
function resample(points, n = DEFAULTS.RESAMPLE_POINTS) {
  if (!points || points.length === 0 || n < 1) return [];
  if (points.length === 1 || n === 1) return Array.from({ length: n }, () => points[0].slice());
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversine(points[i - 1], points[i]));
  const total = cum[cum.length - 1];
  if (total === 0) return Array.from({ length: n }, () => points[0].slice());
  const out = [];
  let seg = 1;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (seg < cum.length - 1 && cum[seg] < target) seg++;
    const span = cum[seg] - cum[seg - 1];
    const t = span === 0 ? 0 : Math.min(1, Math.max(0, (target - cum[seg - 1]) / span));
    out.push([
      points[seg - 1][0] + (points[seg][0] - points[seg - 1][0]) * t,
      points[seg - 1][1] + (points[seg][1] - points[seg - 1][1]) * t
    ]);
  }
  return out;
}

/** Local equirectangular projection to meters around `origin` ([lat, lng]). */
function project(points, origin) {
  const cosLat = Math.cos(toRad(origin[0]));
  return points.map(p => [
    toRad(p[1] - origin[1]) * EARTH_RADIUS_M * cosLat,
    toRad(p[0] - origin[0]) * EARTH_RADIUS_M
  ]);
}

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function directedHausdorff(A, B, percentile) {
  const mins = A.map(a => {
    let best = Infinity;
    for (const b of B) {
      const d = dist2(a, b);
      if (d < best) best = d;
    }
    return best;
  });
  if (percentile >= 1) return Math.max(...mins);
  mins.sort((x, y) => x - y);
  return mins[Math.min(mins.length - 1, Math.ceil(percentile * mins.length) - 1)];
}

/** Discrete symmetric Hausdorff distance between projected point lists (meters). percentile=1 is the classic max. */
function hausdorff(A, B, percentile = 1) {
  if (!A.length || !B.length) return Infinity;
  return Math.max(directedHausdorff(A, B, percentile), directedHausdorff(B, A, percentile));
}

/**
 * DTW with a Sakoe-Chiba band, normalised by warping-path length (mean matched-point distance, meters).
 * bandFraction is the band half-width as a fraction of the sequence length.
 */
function dtw(A, B, bandFraction = DEFAULTS.DTW_BAND_FRACTION) {
  const n = A.length;
  const m = B.length;
  if (!n || !m) return Infinity;
  const band = Math.max(Math.abs(n - m), Math.ceil(bandFraction * Math.max(n, m)));
  const cost = [new Float64Array(m + 1).fill(Infinity)];
  const steps = [new Int32Array(m + 1)];
  cost[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    const row = new Float64Array(m + 1).fill(Infinity);
    const stepRow = new Int32Array(m + 1);
    const prev = cost[i - 1];
    const prevSteps = steps[i - 1];
    const lo = Math.max(1, i - band);
    const hi = Math.min(m, i + band);
    for (let j = lo; j <= hi; j++) {
      let best = prev[j - 1];
      let bestSteps = prevSteps[j - 1];
      if (prev[j] < best) { best = prev[j]; bestSteps = prevSteps[j]; }
      if (row[j - 1] < best) { best = row[j - 1]; bestSteps = stepRow[j - 1]; }
      if (best === Infinity) continue;
      row[j] = best + dist2(A[i - 1], B[j - 1]);
      stepRow[j] = bestSteps + 1;
    }
    cost.push(row);
    steps.push(stepRow);
  }
  return cost[n][m] === Infinity ? Infinity : cost[n][m] / steps[n][m];
}

function jaccard(a, b) {
  if (!a || !b || !a.size || !b.size) return null;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const isLatLng = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/**
 * Build the per-ride structure used for comparisons.
 * segmentData: cache.segmentData (activityId -> efforts).
 */
function prepareRide(activity, segmentData = {}, config = {}) {
  const n = config.RESAMPLE_POINTS || DEFAULTS.RESAMPLE_POINTS;
  const decoded = decodePolyline(activity.summary_polyline).filter(isLatLng);
  const hasGeo = decoded.length >= 2;
  const start = isLatLng(activity.start_latlng) ? activity.start_latlng : (hasGeo ? decoded[0] : null);
  const end = isLatLng(activity.end_latlng) ? activity.end_latlng : (hasGeo ? decoded[decoded.length - 1] : null);
  const efforts = segmentData && segmentData[activity.id];
  const segIds = new Set((efforts || []).map(e => e && e.segment_id).filter(Boolean).map(String));
  return {
    id: activity.id,
    distance: activity.distance || 0,
    points: hasGeo ? resample(decoded, n) : null,
    start,
    end,
    segIds
  };
}

function distanceClose(a, b, tol) {
  const max = Math.max(a, b);
  return max === 0 ? true : Math.abs(a - b) / max <= tol;
}

/** Stage 1: cheap start/finish + distance test. Returns "same", "reverse" or null (no candidate). */
function endpointsCompatible(a, b, cfg) {
  if (!a.start || !a.end || !b.start || !b.end) return null;
  if (!distanceClose(a.distance, b.distance, cfg.DISTANCE_TOLERANCE)) return null;
  const r = cfg.START_END_RADIUS_M;
  const same = haversine(a.start, b.start) <= r && haversine(a.end, b.end) <= r;
  const rev = haversine(a.start, b.end) <= r && haversine(a.end, b.start) <= r;
  if (same) return rev ? "both" : "same";
  return rev ? "reverse" : null;
}

/**
 * Compare two prepared rides. Returns
 * { match, score, direction: "same"|"reverse"|null, hausdorff, dtw, jaccard, method: "geometry"|"segments"|"none" }
 */
function compareRoutes(a, b, config = {}) {
  const cfg = { ...DEFAULTS, ...config };
  const jac = jaccard(a.segIds, b.segIds);
  const none = { match: false, score: 0, direction: null, hausdorff: null, dtw: null, jaccard: jac, method: "none" };

  if (!a.points || !b.points) {
    // Segment-only fallback when a polyline is missing.
    if (jac === null || a.segIds.size < cfg.SEGMENT_FALLBACK_MIN_SEGMENTS || b.segIds.size < cfg.SEGMENT_FALLBACK_MIN_SEGMENTS) return none;
    if (!distanceClose(a.distance, b.distance, cfg.DISTANCE_TOLERANCE)) return none;
    const ok = jac >= cfg.SEGMENT_FALLBACK_MIN_JACCARD;
    return { ...none, match: ok, score: jac, direction: ok ? "same" : null, method: "segments" };
  }

  const compat = endpointsCompatible(a, b, cfg);
  if (!compat) return none;

  const origin = a.points[0];
  const A = project(a.points, origin);
  const B = project(b.points, origin);
  const candidates = [];
  if (compat === "same" || compat === "both") candidates.push({ direction: "same", pts: B });
  if (compat === "reverse" || compat === "both") candidates.push({ direction: "reverse", pts: B.slice().reverse() });

  let best = null;
  for (const c of candidates) {
    const h = hausdorff(A, c.pts, cfg.HAUSDORFF_PERCENTILE);
    if (h > cfg.HAUSDORFF_THRESHOLD_M) continue;
    const d = dtw(A, c.pts, cfg.DTW_BAND_FRACTION);
    if (d > cfg.DTW_THRESHOLD_M) continue;
    let wH = cfg.WEIGHT_HAUSDORFF;
    let wD = cfg.WEIGHT_DTW;
    let wJ = jac === null ? 0 : cfg.WEIGHT_JACCARD;
    const wSum = wH + wD + wJ;
    wH /= wSum; wD /= wSum; wJ /= wSum;
    const score = wH * (1 - h / cfg.HAUSDORFF_THRESHOLD_M) + wD * (1 - d / cfg.DTW_THRESHOLD_M) + wJ * (jac || 0);
    if (!best || score > best.score) best = { direction: c.direction, h, d, score };
  }
  if (!best) return none;
  const reverseBlocked = best.direction === "reverse" && !cfg.ALLOW_REVERSE;
  return {
    match: !reverseBlocked && best.score >= cfg.MIN_SCORE,
    score: best.score,
    direction: best.direction,
    hausdorff: best.h,
    dtw: best.d,
    jaccard: jac,
    method: "geometry"
  };
}

/* ---------- grid hash over representative endpoints ---------- */

class EndpointGrid {
  constructor(radiusM) {
    this.cellDeg = Math.max(radiusM, 1) / 111320; // ~1 cell == radius in latitude
    this.cells = new Map();
  }
  _cell(p) {
    const lngScale = Math.max(Math.cos(toRad(p[0])), 0.01);
    return [Math.floor(p[0] / this.cellDeg), Math.floor((p[1] * lngScale) / this.cellDeg)];
  }
  add(p, value) {
    const [x, y] = this._cell(p);
    const key = `${x},${y}`;
    if (!this.cells.has(key)) this.cells.set(key, new Set());
    this.cells.get(key).add(value);
  }
  /** Values stored in the 3x3 cells around p. Longitude scaling varies slightly with latitude, so widen to +-2 in y. */
  near(p) {
    const [x, y] = this._cell(p);
    const out = new Set();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const set = this.cells.get(`${x + dx},${y + dy}`);
        if (set) for (const v of set) out.add(v);
      }
    }
    return out;
  }
}

/* ---------- clustering ---------- */

function routeIdFor(representativeId) {
  return "r" + crypto.createHash("sha1").update(String(representativeId)).digest("hex").slice(0, 10);
}

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount || (c === bestCount && v < best)) { best = v; bestCount = c; }
  }
  return best;
}

function isEligible(activity, cfg) {
  if (!activity || activity.id == null) return false;
  if (cfg.SPORT_TYPES && cfg.SPORT_TYPES.length && !cfg.SPORT_TYPES.includes(activity.sport_type)) return false;
  // Legacy cache entries (before geo backfill) have no summary_polyline field at all: wait for the backfill.
  return activity.summary_polyline !== undefined || activity.start_latlng !== undefined;
}

function sortOldestFirst(a, b) {
  const ta = new Date(a.start_date).getTime() || 0;
  const tb = new Date(b.start_date).getTime() || 0;
  return ta - tb || String(a.id).localeCompare(String(b.id));
}

function emptyRouteClusters(config = {}) {
  return { version: 1, config: { ...DEFAULTS, ...config }, clusters: [], index: {}, computedAt: null };
}

function refreshClusterMeta(cluster, byId) {
  const members = cluster.activityIds.map(id => byId.get(String(id))).filter(Boolean);
  const rep = byId.get(String(cluster.representativeId)) || members[0];
  cluster.name = mostCommon(members.map(m => m.name)) || (rep && rep.name) || "Route";
  cluster.distance = rep ? rep.distance || 0 : 0;
  cluster.elevation = rep ? rep.total_elevation_gain || 0 : 0;
  return cluster;
}

/**
 * Assign every eligible ride to a cluster. Leader clustering: the earliest ride in a cluster is its
 * representative and a ride joins a cluster only if it matches that representative directly (no
 * transitive chaining). With `previous`, existing assignments are kept and only new rides are placed.
 * Returns { version, config, clusters, index, computedAt } where
 * clusters[i] = { routeId, representativeId, name, distance, elevation, activityIds }.
 * (The representative's polyline is looked up from its activity to keep cache.json compact.)
 */
function buildRouteClusters(activities, segmentData = {}, previous = null, config = {}) {
  const cfg = { ...DEFAULTS, ...config };
  const eligible = (activities || []).filter(a => isEligible(a, cfg));
  const byId = new Map((activities || []).map(a => [String(a.id), a]));
  const eligibleIds = new Set(eligible.map(a => String(a.id)));

  const clusters = [];
  const index = {};
  if (previous && Array.isArray(previous.clusters)) {
    for (const c of previous.clusters) {
      const ids = (c.activityIds || []).filter(id => eligibleIds.has(String(id)));
      if (!ids.length) continue;
      // Representative removed from the data: drop the cluster and re-place its rides.
      if (!ids.some(id => String(id) === String(c.representativeId))) continue;
      const copy = { ...c, activityIds: ids };
      clusters.push(copy);
      for (const id of ids) index[String(id)] = copy.routeId;
    }
  }

  const prepared = new Map();
  const prep = a => {
    const key = String(a.id);
    if (!prepared.has(key)) prepared.set(key, prepareRide(a, segmentData, cfg));
    return prepared.get(key);
  };

  const grid = new EndpointGrid(cfg.START_END_RADIUS_M);
  const repsWithoutGeo = new Set();
  const clusterByRoute = new Map();
  const addRep = cluster => {
    clusterByRoute.set(cluster.routeId, cluster);
    const rep = prep(byId.get(String(cluster.representativeId)));
    if (rep.points && rep.start && rep.end) {
      grid.add(rep.start, cluster.routeId);
      grid.add(rep.end, cluster.routeId);
    } else {
      repsWithoutGeo.add(cluster.routeId);
    }
  };
  clusters.forEach(addRep);

  const touched = new Set();
  const pending = eligible.filter(a => !(String(a.id) in index)).sort(sortOldestFirst);
  for (const a of pending) {
    const ride = prep(a);
    let candidateIds;
    if (ride.points && ride.start) {
      candidateIds = new Set([...grid.near(ride.start), ...repsWithoutGeo]);
    } else {
      candidateIds = new Set(clusterByRoute.keys()); // segment fallback: no spatial blocking possible
    }
    let best = null;
    for (const routeId of candidateIds) {
      const cluster = clusterByRoute.get(routeId);
      const result = compareRoutes(prep(byId.get(String(cluster.representativeId))), ride, cfg);
      if (result.match && (!best || result.score > best.score)) best = { cluster, score: result.score };
    }
    if (best) {
      best.cluster.activityIds.push(a.id);
      index[String(a.id)] = best.cluster.routeId;
      touched.add(best.cluster.routeId);
    } else {
      const cluster = { routeId: routeIdFor(a.id), representativeId: a.id, name: a.name, distance: 0, elevation: 0, activityIds: [a.id] };
      clusters.push(cluster);
      index[String(a.id)] = cluster.routeId;
      addRep(cluster);
      touched.add(cluster.routeId);
    }
  }

  for (const c of clusters) if (touched.has(c.routeId) || c.name === undefined) refreshClusterMeta(c, byId);
  return { version: 1, config: { ...cfg }, clusters, index, computedAt: new Date().toISOString() };
}

/* ---------- leaderboards ---------- */

function periodMatcher({ year, month } = {}) {
  const y = year == null || year === "" ? null : Number(year);
  const m = month == null || month === "" ? null : Number(month);
  return dateStr => {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return false;
    if (y !== null && d.getUTCFullYear() !== y) return false;
    if (m !== null && d.getUTCMonth() + 1 !== m) return false;
    return true;
  };
}

function compareRows(a, b) {
  return b.count - a.count || new Date(b.lastRidden).getTime() - new Date(a.lastRidden).getTime() || String(a.name).localeCompare(String(b.name));
}

/**
 * Top routes by number of matched rides. Dates use activity start_date (UTC for year/month filters).
 * Returns [{ routeId, name, count, firstRidden, lastRidden, distance, elevation, polyline, activityIds }].
 */
function routeLeaderboard(clusters, activities, { year, month, limit = 20 } = {}) {
  const list = Array.isArray(clusters) ? clusters : (clusters && clusters.clusters) || [];
  const byId = new Map((activities || []).map(a => [String(a.id), a]));
  const inPeriod = periodMatcher({ year, month });
  const rows = [];
  for (const c of list) {
    const rides = c.activityIds.map(id => byId.get(String(id))).filter(a => a && a.start_date && inPeriod(a.start_date));
    if (!rides.length) continue;
    let first = rides[0].start_date;
    let last = rides[0].start_date;
    for (const r of rides) {
      if (new Date(r.start_date) < new Date(first)) first = r.start_date;
      if (new Date(r.start_date) > new Date(last)) last = r.start_date;
    }
    const rep = byId.get(String(c.representativeId));
    rows.push({
      routeId: c.routeId,
      name: c.name,
      count: rides.length,
      firstRidden: first,
      lastRidden: last,
      distance: c.distance,
      elevation: c.elevation,
      polyline: (rep && rep.summary_polyline) || "",
      activityIds: rides.map(r => r.id)
    });
  }
  rows.sort(compareRows);
  return limit == null ? rows : rows.slice(0, limit);
}

/** Same shape, grouped by segment_id from segmentData (distinct rides per segment). */
function segmentLeaderboard(segmentData, { year, month, limit = 20, excludedSegmentIds = [], activityIds = null } = {}) {
  const excluded = new Set([...excludedSegmentIds].map(String));
  const allowed = activityIds ? new Set([...activityIds].map(String)) : null;
  const inPeriod = periodMatcher({ year, month });
  const map = new Map();
  for (const [activityId, efforts] of Object.entries(segmentData || {})) {
    if (allowed && !allowed.has(String(activityId))) continue;
    const seenHere = new Set();
    for (const e of efforts || []) {
      if (!e || !e.segment_id || !e.start_date) continue;
      const sid = String(e.segment_id);
      if (excluded.has(sid) || seenHere.has(sid) || !inPeriod(e.start_date)) continue;
      seenHere.add(sid);
      let row = map.get(sid);
      if (!row) {
        row = { segmentId: sid, name: e.segment_name, count: 0, firstRidden: e.start_date, lastRidden: e.start_date, activityIds: [] };
        map.set(sid, row);
      }
      row.count++;
      row.activityIds.push(activityId);
      if (new Date(e.start_date) < new Date(row.firstRidden)) row.firstRidden = e.start_date;
      if (new Date(e.start_date) > new Date(row.lastRidden)) row.lastRidden = e.start_date;
    }
  }
  const rows = [...map.values()].sort(compareRows);
  return limit == null ? rows : rows.slice(0, limit);
}

module.exports = {
  DEFAULTS,
  haversine,
  pathLength,
  resample,
  project,
  hausdorff,
  dtw,
  jaccard,
  prepareRide,
  compareRoutes,
  routeIdFor,
  emptyRouteClusters,
  buildRouteClusters,
  routeLeaderboard,
  segmentLeaderboard
};
