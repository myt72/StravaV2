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
 *     polyline is missing. Never used for non-ride sport groups (no segment data is fetched for them).
 *  6. Overlap match (enabled by default, OVERLAP_MIN_FRACTION = 0.8; 0 disables it): accepts a pair when
 *     at least that fraction of each route's resampled points lies within OVERLAP_DISTANCE_M of the other
 *     route's polyline. This tolerates small detours and GPS noise that Hausdorff/DTW/MIN_SCORE reject.
 * Rides are clustered per sport group (Ride; Walk+Hike) so groups never merge. Each group has its own
 * default thresholds (GROUP_DEFAULT_CONFIGS) that `routeMatching` settings can override. Walk/Hike use a
 * 25% DISTANCE_TOLERANCE (Ride keeps 10%).
 *
 * Why: calibration against Strava's "matched activities" counts (scripts/calibrateRouteMatching.js) showed
 * the old defaults undercounted. Direct matches incl. self, Strava expected / old default / overlap 0.8:
 * 20231666043 40/22/41, 16887868967 40/28/41, 17653619842 20/2/22. For the Walk/Hike seed 20547542160
 * (expected 102) the distance gate was the main loss: 67 at 10% tolerance, 90 at 25%; loosening the start/end
 * radius, Hausdorff and overlap distance only reached 91, so those stay unchanged.
 */
const DEFAULT_MATCH_CONFIG = Object.freeze({
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
  OVERLAP_DISTANCE_M: 40,
  OVERLAP_MIN_FRACTION: 0.8,
  ALLOW_REVERSE: false,
  SPORT_TYPES: Object.freeze(["Ride", "Walk", "Hike"])
});
const SPORT_GROUPS = Object.freeze({ Ride: Object.freeze(["Ride"]), WalkHike: Object.freeze(["Walk", "Hike"]) });
const GROUP_DEFAULT_CONFIGS = Object.freeze({
  Ride: Object.freeze({}),
  WalkHike: Object.freeze({
    DISTANCE_TOLERANCE: 0.25,
    START_END_RADIUS_M: 75,
    HAUSDORFF_THRESHOLD_M: 75,
    DTW_THRESHOLD_M: 35,
    OVERLAP_DISTANCE_M: 25
  })
});
const ROUTE_CLUSTER_VERSION = 3;

function sportGroupOf(sportType) {
  for (const [group, types] of Object.entries(SPORT_GROUPS)) if (types.includes(sportType)) return group;
  return null;
}
const DEFAULTS = DEFAULT_MATCH_CONFIG;
const MATCH_CONFIG_BOUNDS = Object.freeze({
  START_END_RADIUS_M: [10, 1000],
  DISTANCE_TOLERANCE: [0.01, 0.5],
  RESAMPLE_POINTS: [10, 500],
  HAUSDORFF_THRESHOLD_M: [5, 1000],
  HAUSDORFF_PERCENTILE: [0.5, 1],
  DTW_THRESHOLD_M: [5, 500],
  DTW_BAND_FRACTION: [0, 0.5],
  OVERLAP_DISTANCE_M: [5, 500],
  OVERLAP_MIN_FRACTION: [0, 1],
  MIN_SCORE: [0, 1],
  WEIGHT_HAUSDORFF: [0, 1],
  WEIGHT_DTW: [0, 1],
  WEIGHT_JACCARD: [0, 1],
  SEGMENT_FALLBACK_MIN_JACCARD: [0, 1],
  SEGMENT_FALLBACK_MIN_SEGMENTS: [1, 100]
});

function validateMatchConfig(input, { nested = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("routeMatching must be a JSON object");
  }
  const config = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "GROUP_OVERRIDES" && !nested) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("GROUP_OVERRIDES must be an object keyed by sport group");
      }
      config[key] = {};
      for (const [group, overrides] of Object.entries(value)) {
        if (!SPORT_GROUPS[group]) throw new TypeError(`Unknown sport group in GROUP_OVERRIDES: ${group}`);
        config[key][group] = validateMatchConfig(overrides, { nested: true });
      }
      continue;
    }
    if (nested && key === "SPORT_TYPES") throw new TypeError("SPORT_TYPES cannot be set per sport group");
    if (key === "ALLOW_REVERSE") {
      if (typeof value !== "boolean") throw new TypeError("ALLOW_REVERSE must be a boolean");
      config[key] = value;
      continue;
    }
    if (key === "SPORT_TYPES") {
      if (!Array.isArray(value) || value.length > 10 ||
          !value.every(type => typeof type === "string" && /^[A-Za-z][A-Za-z0-9 _-]{0,39}$/.test(type))) {
        throw new TypeError("SPORT_TYPES must be an array of up to 10 valid sport names");
      }
      config[key] = [...value];
      continue;
    }
    const bounds = MATCH_CONFIG_BOUNDS[key];
    if (!bounds) throw new TypeError(`Unknown route-matching setting: ${key}`);
    if (typeof value !== "number" || !Number.isFinite(value) || value < bounds[0] || value > bounds[1]) {
      throw new TypeError(`${key} must be a number between ${bounds[0]} and ${bounds[1]}`);
    }
    if ((key === "RESAMPLE_POINTS" || key === "SEGMENT_FALLBACK_MIN_SEGMENTS") && !Number.isInteger(value)) {
      throw new TypeError(`${key} must be an integer`);
    }
    config[key] = value;
  }
  if (config.WEIGHT_HAUSDORFF === 0 && config.WEIGHT_DTW === 0 && config.WEIGHT_JACCARD === 0) {
    throw new TypeError("At least one route-matching score weight must be greater than zero");
  }
  return config;
}

/**
 * Effective config for one sport group: defaults < group defaults < user settings < user per-group overrides.
 * `overrides` must be the user's overrides only (not a config already merged with DEFAULT_MATCH_CONFIG).
 */
function resolveGroupConfig(group, overrides = {}) {
  const { GROUP_OVERRIDES, ...top } = overrides || {};
  return { ...DEFAULTS, ...(GROUP_DEFAULT_CONFIGS[group] || {}), ...top, ...((GROUP_OVERRIDES && GROUP_OVERRIDES[group]) || {}) };
}

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

function pointToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Fraction of A's points within `tol` meters of the polyline B (point-to-segment, so sparse summary polylines are fine). */
function directedOverlap(A, B, tol) {
  if (!A.length || !B.length) return 0;
  let hits = 0;
  for (const a of A) {
    let best = Infinity;
    if (B.length === 1) best = dist2(a, B[0]);
    for (let j = 1; j < B.length && best > tol; j++) {
      const d = pointToSegment(a, B[j - 1], B[j]);
      if (d < best) best = d;
    }
    if (best <= tol) hits++;
  }
  return hits / A.length;
}

/** Symmetric overlap: the smaller of the two directed overlap fractions (0..1). */
function overlap(A, B, tol) {
  return Math.min(directedOverlap(A, B, tol), directedOverlap(B, A, tol));
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
  // Segment data is only meaningful for rides; walks/hikes never have it fetched and must not use it.
  const group = sportGroupOf(activity.sport_type);
  const efforts = group === "Ride" || group === null ? segmentData && segmentData[activity.id] : null;
  const segIds = new Set((efforts || []).map(e => e && e.segment_id).filter(Boolean).map(String));
  return {
    id: activity.id,
    group,
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
    let d = null;
    let score = null;
    if (h <= cfg.HAUSDORFF_THRESHOLD_M) {
      d = dtw(A, c.pts, cfg.DTW_BAND_FRACTION);
      if (d <= cfg.DTW_THRESHOLD_M) {
        let wH = cfg.WEIGHT_HAUSDORFF;
        let wD = cfg.WEIGHT_DTW;
        let wJ = jac === null ? 0 : cfg.WEIGHT_JACCARD;
        const wSum = wH + wD + wJ;
        wH /= wSum; wD /= wSum; wJ /= wSum;
        score = wH * (1 - h / cfg.HAUSDORFF_THRESHOLD_M) + wD * (1 - d / cfg.DTW_THRESHOLD_M) + wJ * (jac || 0);
      }
    }
    let ov = null;
    if (cfg.OVERLAP_MIN_FRACTION > 0) {
      ov = overlap(A, c.pts, cfg.OVERLAP_DISTANCE_M);
      if (ov >= cfg.OVERLAP_MIN_FRACTION) score = Math.max(score === null ? 0 : score, ov);
    }
    if (score === null) continue;
    if (!best || score > best.score) best = { direction: c.direction, h, d, score, ov };
  }
  if (!best) return none;
  const reverseBlocked = best.direction === "reverse" && !cfg.ALLOW_REVERSE;
  return {
    match: !reverseBlocked && best.score >= cfg.MIN_SCORE,
    score: best.score,
    direction: best.direction,
    hausdorff: best.h,
    dtw: best.d,
    overlap: best.ov,
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
  if (!sportGroupOf(activity.sport_type)) return false;
  if (cfg.SPORT_TYPES && cfg.SPORT_TYPES.length && !cfg.SPORT_TYPES.includes(activity.sport_type)) return false;
  // Legacy cache entries (before geo backfill) have no summary_polyline field at all: wait for the backfill.
  return activity.summary_polyline !== undefined || activity.start_latlng !== undefined;
}

function sortOldestFirst(a, b) {
  const ta = new Date(a.start_date).getTime() || 0;
  const tb = new Date(b.start_date).getTime() || 0;
  return ta - tb || compareIds(a.id, b.id);
}

function compareIds(a, b) {
  const x = String(a);
  const y = String(b);
  return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0);
}

function emptyRouteClusters(config = {}) {
  return { version: ROUTE_CLUSTER_VERSION, config: { ...DEFAULTS, ...config }, clusters: [], index: {}, computedAt: null };
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
 * Pairwise direct matches for a set of prepared rides (same sport group, same config).
 * A grid hash on start/end points limits comparisons to rides that can pass the endpoint test.
 * Returns Map(id -> Map(otherId -> score)); symmetric, self excluded. Deterministic: each pair is
 * compared once with the lower id as the first argument.
 */
function pairwiseMatches(rides, cfg) {
  const neighbours = new Map(rides.map(r => [String(r.id), new Map()]));
  const grid = new EndpointGrid(cfg.START_END_RADIUS_M);
  const geoRides = rides.filter(r => r.points && r.start && r.end);
  const noGeo = rides.filter(r => !(r.points && r.start && r.end));
  for (const r of geoRides) { grid.add(r.start, r); grid.add(r.end, r); }
  const consider = (a, b) => {
    if (compareIds(a.id, b.id) >= 0) return;
    const result = compareRoutes(a, b, cfg);
    if (!result.match) return;
    neighbours.get(String(a.id)).set(String(b.id), result.score);
    neighbours.get(String(b.id)).set(String(a.id), result.score);
  };
  for (const a of geoRides) {
    const candidates = new Set([...grid.near(a.start), ...grid.near(a.end), ...noGeo]); // polyline-less rides can't be blocked spatially
    for (const b of candidates) consider(a, b);
  }
  for (let i = 0; i < noGeo.length; i++) for (let j = i + 1; j < noGeo.length; j++) consider(noGeo[i], noGeo[j]);
  return neighbours;
}

/**
 * Density/degree clustering of prepared rides: repeatedly pick the ride with the most direct matches among
 * the remaining rides (ties: higher mean score to those neighbours, then lowest id) as the route's medoid,
 * and cluster it with its direct matches. Every member matches the representative (no transitive chaining).
 * Returns [{ representativeId, memberIds }].
 */
function densityClusters(rides, cfg) {
  const neighbours = pairwiseMatches(rides, cfg);
  const remaining = new Set(neighbours.keys());
  const degree = new Map();
  for (const [id, nb] of neighbours) degree.set(id, nb.size);
  const out = [];
  while (remaining.size) {
    let pick = null;
    let pickMean = 0;
    for (const id of remaining) {
      const d = degree.get(id);
      let mean = 0;
      if (d > 0) {
        for (const [other, score] of neighbours.get(id)) if (remaining.has(other)) mean += score;
        mean /= d;
      }
      if (pick === null || d > degree.get(pick) ||
          (d === degree.get(pick) && (mean > pickMean + 1e-12 || (Math.abs(mean - pickMean) <= 1e-12 && compareIds(id, pick) < 0)))) {
        pick = id;
        pickMean = mean;
      }
    }
    const members = [pick, ...[...neighbours.get(pick).keys()].filter(id => remaining.has(id))];
    for (const id of members) remaining.delete(id);
    for (const id of members) for (const other of neighbours.get(id).keys()) if (remaining.has(other)) degree.set(other, degree.get(other) - 1);
    out.push({ representativeId: pick, memberIds: members });
  }
  return out;
}

/**
 * Assign every eligible ride to a cluster, per sport group (Ride; Walk+Hike; groups never mix).
 * Density clustering: the ride with the most direct matches becomes a route's medoid/representative, every
 * member must match it directly (no transitive chaining), and each ride belongs to one cluster.
 * With `previous` (same version), existing assignments are kept; new rides join the best-scoring existing
 * route they match, otherwise they are density-clustered among themselves. A version mismatch rebuilds.
 * `config` holds user overrides only (see resolveGroupConfig).
 * Returns { version, config, clusters, index, computedAt } where
 * clusters[i] = { routeId, sportGroup, representativeId, name, distance, elevation, activityIds }.
 * (The representative's polyline is looked up from its activity to keep cache.json compact.)
 */
function buildRouteClusters(activities, segmentData = {}, previous = null, config = {}) {
  const baseCfg = { ...DEFAULTS, ...config };
  const eligible = (activities || []).filter(a => isEligible(a, baseCfg));
  const byId = new Map((activities || []).map(a => [String(a.id), a]));
  const groupOf = new Map(eligible.map(a => [String(a.id), sportGroupOf(a.sport_type)]));
  const eligibleIds = new Set(groupOf.keys());

  const clusters = [];
  const index = {};
  if (previous && previous.version === ROUTE_CLUSTER_VERSION && Array.isArray(previous.clusters)) {
    for (const c of previous.clusters) {
      const ids = (c.activityIds || []).filter(id => eligibleIds.has(String(id)) && groupOf.get(String(id)) === c.sportGroup);
      if (!ids.length) continue;
      // Representative removed from the data: drop the cluster and re-place its rides.
      if (!ids.some(id => String(id) === String(c.representativeId))) continue;
      const copy = { ...c, activityIds: ids };
      clusters.push(copy);
      for (const id of ids) index[String(id)] = copy.routeId;
    }
  }

  const touched = new Set();
  const pendingAll = eligible.filter(a => !(String(a.id) in index)).sort(sortOldestFirst);

  for (const group of Object.keys(SPORT_GROUPS)) {
    const pending = pendingAll.filter(a => groupOf.get(String(a.id)) === group);
    if (!pending.length) continue;
    const cfg = resolveGroupConfig(group, config);
    const prepared = new Map();
    const prep = a => {
      const key = String(a.id);
      if (!prepared.has(key)) prepared.set(key, prepareRide(a, segmentData, cfg));
      return prepared.get(key);
    };

    // 1. Join an existing route of this group when a new ride matches its representative.
    const groupClusters = clusters.filter(c => c.sportGroup === group);
    const grid = new EndpointGrid(cfg.START_END_RADIUS_M);
    const repsWithoutGeo = new Set();
    const clusterByRoute = new Map();
    for (const c of groupClusters) {
      clusterByRoute.set(c.routeId, c);
      const rep = prep(byId.get(String(c.representativeId)));
      if (rep.points && rep.start && rep.end) { grid.add(rep.start, c.routeId); grid.add(rep.end, c.routeId); }
      else repsWithoutGeo.add(c.routeId);
    }
    const unplaced = [];
    for (const a of pending) {
      const ride = prep(a);
      const candidateIds = ride.points && ride.start
        ? new Set([...grid.near(ride.start), ...repsWithoutGeo])
        : new Set(clusterByRoute.keys());
      let best = null;
      for (const routeId of [...candidateIds].sort()) {
        const cluster = clusterByRoute.get(routeId);
        const result = compareRoutes(prep(byId.get(String(cluster.representativeId))), ride, cfg);
        if (result.match && (!best || result.score > best.score)) best = { cluster, score: result.score };
      }
      if (best) {
        best.cluster.activityIds.push(a.id);
        index[String(a.id)] = best.cluster.routeId;
        touched.add(best.cluster.routeId);
      } else {
        unplaced.push(a);
      }
    }

    // 2. Density clustering of everything else.
    for (const { representativeId, memberIds } of densityClusters(unplaced.map(prep), cfg)) {
      const members = memberIds.map(id => byId.get(String(id))).sort(sortOldestFirst);
      const cluster = {
        routeId: routeIdFor(representativeId),
        sportGroup: group,
        representativeId: byId.get(String(representativeId)).id,
        name: byId.get(String(representativeId)).name,
        distance: 0,
        elevation: 0,
        activityIds: members.map(m => m.id)
      };
      clusters.push(cluster);
      for (const m of members) index[String(m.id)] = cluster.routeId;
      touched.add(cluster.routeId);
    }
  }

  for (const c of clusters) if (touched.has(c.routeId) || c.name === undefined) refreshClusterMeta(c, byId);
  return { version: ROUTE_CLUSTER_VERSION, config: { ...baseCfg }, clusters, index, computedAt: new Date().toISOString() };
}

/**
 * Per-activity direct matches (overlapping allowed): every other ride of the same sport group that matches
 * `activityId` directly. This is the figure comparable to Strava's "Matched Activities" count (add 1 if the
 * Strava figure includes the activity itself). Returns [{ id, score, direction }] best score first.
 * `options.prepared` may be a Map(id -> prepared ride) to reuse across calls.
 */
function matchesFor(activityId, activities, segmentData = {}, config = {}, options = {}) {
  const seed = (activities || []).find(a => String(a.id) === String(activityId));
  if (!seed) return [];
  const group = sportGroupOf(seed.sport_type);
  if (!group) return [];
  const baseCfg = { ...DEFAULTS, ...config };
  if (!isEligible(seed, baseCfg)) return [];
  const cfg = resolveGroupConfig(group, config);
  const prepared = options.prepared || new Map();
  const prep = a => {
    const key = String(a.id);
    if (!prepared.has(key)) prepared.set(key, prepareRide(a, segmentData, cfg));
    return prepared.get(key);
  };
  const seedRide = prep(seed);
  const out = [];
  for (const a of activities) {
    if (String(a.id) === String(seed.id) || sportGroupOf(a.sport_type) !== group || !isEligible(a, baseCfg)) continue;
    const result = compareRoutes(seedRide, prep(a), cfg);
    if (result.match) out.push({ id: a.id, score: result.score, direction: result.direction });
  }
  return out.sort((x, y) => y.score - x.score || compareIds(x.id, y.id));
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
  DEFAULT_MATCH_CONFIG,
  DEFAULTS,
  validateMatchConfig,
  haversine,
  pathLength,
  resample,
  project,
  overlap,
  SPORT_GROUPS,
  GROUP_DEFAULT_CONFIGS,
  ROUTE_CLUSTER_VERSION,
  sportGroupOf,
  resolveGroupConfig,
  matchesFor,
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
