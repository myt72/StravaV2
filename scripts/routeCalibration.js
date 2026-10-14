"use strict";

const routeMatching = require("../lib/routeMatching");

function validateSeeds(input) {
  if (!Array.isArray(input)) return { valid: false, errors: ["seeds.json must contain an array"], seeds: [] };
  const errors = [];
  const seeds = input.map((seed, index) => {
    const prefix = `seed[${index}]`;
    if (!seed || typeof seed !== "object" || Array.isArray(seed)) {
      errors.push(`${prefix} must be an object`);
      return null;
    }
    const activityId = String(seed.activityId == null ? "" : seed.activityId);
    if (!/^\d+$/.test(activityId)) errors.push(`${prefix}.activityId must be a numeric activity ID`);
    if (!Number.isInteger(seed.expectedCount) || seed.expectedCount < 0) {
      errors.push(`${prefix}.expectedCount must be a non-negative integer`);
    }
    if (seed.includesSelf !== undefined && typeof seed.includesSelf !== "boolean") {
      errors.push(`${prefix}.includesSelf must be a boolean`);
    }
    for (const key of ["expectedMatchedIds", "notMatchedIds"]) {
      if (seed[key] !== undefined && (!Array.isArray(seed[key]) || !seed[key].every(isActivityIdOrDate))) {
        errors.push(`${prefix}.${key} must contain activity IDs or YYYY-MM-DD dates`);
      }
    }
    return {
      ...seed,
      activityId,
      includesSelf: seed.includesSelf === undefined ? true : seed.includesSelf,
      expectedMatchedIds: (seed.expectedMatchedIds || []).map(String),
      notMatchedIds: (seed.notMatchedIds || []).map(String)
    };
  }).filter(Boolean);
  return { valid: errors.length === 0, errors, seeds };
}

function isActivityIdOrDate(value) {
  if (/^\d+$/.test(String(value))) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function resolveActivityIds(values, activities) {
  const byId = new Set(activities.map(activity => String(activity.id)));
  const resolved = [];
  for (const value of values || []) {
    const key = String(value);
    if (byId.has(key) || !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      resolved.push(key);
      continue;
    }
    const dateMatches = activities
      .filter(activity => activity.start_date && String(activity.start_date).slice(0, 10) === key)
      .map(activity => String(activity.id));
    resolved.push(...(dateMatches.length ? dateMatches : [key]));
  }
  return [...new Set(resolved)];
}

function scoreMatchedIds(predictedIds, expectedIds) {
  const predicted = new Set((predictedIds || []).map(String));
  const expected = new Set((expectedIds || []).map(String));
  const truePositive = [...predicted].filter(id => expected.has(id));
  const missed = [...expected].filter(id => !predicted.has(id));
  const extra = [...predicted].filter(id => !expected.has(id));
  const precision = predicted.size ? truePositive.length / predicted.size : (expected.size ? 0 : 1);
  const recall = expected.size ? truePositive.length / expected.size : (predicted.size ? 0 : 1);
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, truePositive, missed, extra };
}

function countInterpretations(predictedIds, seed) {
  const ids = new Set((predictedIds || []).map(String));
  const hasSelf = ids.has(String(seed.activityId));
  const withSelf = ids.size;
  const withoutSelf = withSelf - (hasSelf ? 1 : 0);
  const expectedWithSelf = seed.expectedCount + (seed.includesSelf ? 0 : 1);
  const expectedWithoutSelf = Math.max(0, seed.expectedCount - (seed.includesSelf ? 1 : 0));
  return {
    withSelf: { actual: withSelf, expected: expectedWithSelf, delta: withSelf - expectedWithSelf },
    withoutSelf: { actual: withoutSelf, expected: expectedWithoutSelf, delta: withoutSelf - expectedWithoutSelf }
  };
}

function endpointDistances(a, b) {
  if (!a.start || !a.end || !b.start || !b.end) return null;
  return {
    same: Math.max(routeMatching.haversine(a.start, b.start), routeMatching.haversine(a.end, b.end)),
    reverse: Math.max(routeMatching.haversine(a.start, b.end), routeMatching.haversine(a.end, b.start))
  };
}

function distanceClose(a, b, tolerance) {
  const max = Math.max(a || 0, b || 0);
  return max === 0 || Math.abs((a || 0) - (b || 0)) / max <= tolerance;
}

function diagnosticMetrics(a, b, config) {
  const jac = routeMatching.jaccard(a.segIds, b.segIds);
  if (!a.points || !b.points) {
    const comparison = routeMatching.compareRoutes(a, b, config);
    return {
      direction: comparison.direction,
      hausdorff: null,
      dtw: null,
      segmentJaccard: jac,
      score: comparison.score,
      match: comparison.match,
      method: comparison.method
    };
  }
  const endpoints = endpointDistances(a, b);
  const compatible = endpoints && distanceClose(a.distance, b.distance, config.DISTANCE_TOLERANCE)
    ? [
        ...(endpoints.same <= config.START_END_RADIUS_M ? ["same"] : []),
        ...(endpoints.reverse <= config.START_END_RADIUS_M ? ["reverse"] : [])
      ]
    : [];
  const A = routeMatching.project(a.points, a.points[0]);
  const attempts = compatible.map(direction => {
    const points = direction === "reverse" ? b.points.slice().reverse() : b.points;
    const B = routeMatching.project(points, a.points[0]);
    const hausdorff = routeMatching.hausdorff(A, B, config.HAUSDORFF_PERCENTILE);
    const dtw = hausdorff <= config.HAUSDORFF_THRESHOLD_M
      ? routeMatching.dtw(A, B, config.DTW_BAND_FRACTION)
      : null;
    let score = 0;
    if (dtw !== null && dtw <= config.DTW_THRESHOLD_M) {
      const weights = [
        config.WEIGHT_HAUSDORFF,
        config.WEIGHT_DTW,
        jac === null ? 0 : config.WEIGHT_JACCARD
      ];
      const weightSum = weights.reduce((sum, value) => sum + value, 0);
      score = (weights[0] / weightSum) * (1 - hausdorff / config.HAUSDORFF_THRESHOLD_M) +
        (weights[1] / weightSum) * (1 - dtw / config.DTW_THRESHOLD_M) +
        (weights[2] / weightSum) * (jac || 0);
    }
    return { direction, hausdorff, dtw, score };
  });
  const best = attempts.slice().sort((x, y) => y.score - x.score)[0];
  const comparison = routeMatching.compareRoutes(a, b, config);
  return {
    direction: comparison.direction || (best && best.direction) || null,
    hausdorff: comparison.hausdorff ?? (best && best.hausdorff) ?? null,
    dtw: comparison.dtw ?? (best && best.dtw) ?? null,
    segmentJaccard: jac,
    score: comparison.score,
    match: comparison.match,
    method: comparison.method,
    hausdorffPassed: attempts.some(attempt => attempt.hausdorff <= config.HAUSDORFF_THRESHOLD_M),
    dtwPassed: attempts.some(attempt => attempt.dtw !== null && attempt.dtw <= config.DTW_THRESHOLD_M)
  };
}

function rideDetails(activity, diagnostic) {
  return {
    id: activity.id,
    date: activity.start_date || null,
    name: activity.name || null,
    distance: activity.distance || 0,
    direction: diagnostic.direction,
    score: diagnostic.score,
    hausdorff: diagnostic.hausdorff,
    dtw: diagnostic.dtw,
    segmentJaccard: diagnostic.segmentJaccard,
    method: diagnostic.method,
    match: diagnostic.match
  };
}

function prepareRides(cache, config) {
  const activities = Array.isArray(cache.activities) ? cache.activities : [];
  const eligible = activities.filter(activity =>
    activity && activity.id != null &&
    (!config.SPORT_TYPES.length || config.SPORT_TYPES.includes(activity.sport_type)) &&
    (activity.summary_polyline !== undefined || activity.start_latlng !== undefined)
  );
  return new Map(eligible.map(activity => [
    String(activity.id),
    routeMatching.prepareRide(activity, cache.segmentData || {}, config)
  ]));
}

function analyzeSeed(seed, cache, config = {}, preparedRides = null) {
  const cfg = { ...routeMatching.DEFAULT_MATCH_CONFIG, ...config };
  const activities = Array.isArray(cache.activities) ? cache.activities : [];
  const seedActivity = activities.find(activity => String(activity.id) === String(seed.activityId));
  if (!seedActivity) return { activityId: String(seed.activityId), skipped: "Seed activity is missing from cache.json" };
  if (!seedActivity.summary_polyline || !Array.isArray(seedActivity.start_latlng) || !Array.isArray(seedActivity.end_latlng)) {
    return {
      activityId: String(seed.activityId),
      skipped: "GPS fields are missing; run the geo backfill from the Data page before calibrating."
    };
  }

  const prepared = preparedRides || prepareRides(cache, cfg);
  const seedRide = prepared.get(String(seedActivity.id)) || routeMatching.prepareRide(seedActivity, cache.segmentData || {}, cfg);
  const eligible = activities.filter(activity =>
    activity && activity.id != null &&
    (!cfg.SPORT_TYPES.length || cfg.SPORT_TYPES.includes(activity.sport_type)) &&
    (activity.summary_polyline !== undefined || activity.start_latlng !== undefined)
  );
  const funnel = {
    eligible: eligible.length,
    startFinish: 0,
    distance: 0,
    hausdorff: 0,
    dtw: 0,
    segmentOverlap: 0
  };
  const rows = [];
  for (const activity of eligible) {
    const ride = prepared.get(String(activity.id)) || routeMatching.prepareRide(activity, cache.segmentData || {}, cfg);
    const endpoints = endpointDistances(seedRide, ride);
    const hasGeometry = !!(seedRide.points && ride.points && endpoints);
    const isSegmentFallback = !seedRide.points || !ride.points;
    const endpointCandidate = hasGeometry && (
      endpoints.same <= cfg.START_END_RADIUS_M || endpoints.reverse <= cfg.START_END_RADIUS_M
    );
    if (String(activity.id) === String(seed.activityId) || endpointCandidate || isSegmentFallback) {
      funnel.startFinish++;
    } else {
      continue;
    }
    if (!distanceClose(seedRide.distance, ride.distance, cfg.DISTANCE_TOLERANCE)) continue;
    funnel.distance++;
    const diagnostic = diagnosticMetrics(seedRide, ride, cfg);
    if (diagnostic.hausdorffPassed || diagnostic.method === "segments") funnel.hausdorff++;
    if (diagnostic.dtwPassed || diagnostic.method === "segments") funnel.dtw++;
    if (diagnostic.match) funnel.segmentOverlap++;
    rows.push(rideDetails(activity, diagnostic));
  }

  const matched = rows.filter(row => row.match);
  const matchedIds = matched.map(row => String(row.id));
  const counts = countInterpretations(matchedIds, seed);
  const hasExpectedList = seed.expectedMatchedIds && seed.expectedMatchedIds.length > 0;
  let listScore = null;
  if (hasExpectedList) {
    const expectedIds = resolveActivityIds(seed.expectedMatchedIds, activities);
    const knownNotMatchedIds = new Set(resolveActivityIds(seed.notMatchedIds, activities));
    listScore = scoreMatchedIds(matchedIds, expectedIds);
    listScore.knownNotMatched = matched.filter(row => knownNotMatchedIds.has(String(row.id)));
    listScore.missedRides = listScore.missed.map(id => {
      const activity = activities.find(a => String(a.id) === id);
      if (!activity) return { id, date: null, name: null, distance: 0, hausdorff: null, dtw: null, segmentJaccard: null };
      const detail = rows.find(row => String(row.id) === id);
      if (detail) return detail;
      const ride = routeMatching.prepareRide(activity, cache.segmentData || {}, cfg);
      return rideDetails(activity, diagnosticMetrics(seedRide, ride, cfg));
    });
    listScore.extraRides = listScore.extra.map(id => rows.find(row => String(row.id) === id)).filter(Boolean);
  }
  const nearBoundary = hasExpectedList ? null : {
    accepted: matched.slice().sort((a, b) =>
      Math.abs(a.score - cfg.MIN_SCORE) - Math.abs(b.score - cfg.MIN_SCORE)).slice(0, 15),
    rejected: rows.filter(row => !row.match).sort((a, b) =>
      (b.score || 0) - (a.score || 0) ||
      ((a.hausdorff || Infinity) / cfg.HAUSDORFF_THRESHOLD_M) - ((b.hausdorff || Infinity) / cfg.HAUSDORFF_THRESHOLD_M) ||
      ((a.dtw || Infinity) / cfg.DTW_THRESHOLD_M) - ((b.dtw || Infinity) / cfg.DTW_THRESHOLD_M)).slice(0, 15)
  };
  return {
    activityId: String(seed.activityId),
    expectedCount: seed.expectedCount,
    includesSelf: seed.includesSelf,
    counts,
    funnel,
    sameDirection: rows.filter(row => row.direction === "same"),
    reverseDirection: rows.filter(row => row.direction === "reverse"),
    matchedIds,
    listScore,
    nearBoundary
  };
}

function buildSweepGrid(baseConfig = {}) {
  const base = { ...routeMatching.DEFAULT_MATCH_CONFIG, ...baseConfig };
  const variants = {
    START_END_RADIUS_M: [100, base.START_END_RADIUS_M],
    DISTANCE_TOLERANCE: [0.05, base.DISTANCE_TOLERANCE],
    HAUSDORFF_THRESHOLD_M: [100, base.HAUSDORFF_THRESHOLD_M],
    HAUSDORFF_PERCENTILE: [0.95, 1],
    DTW_THRESHOLD_M: [50, base.DTW_THRESHOLD_M],
    WEIGHT_JACCARD: [0.1, base.WEIGHT_JACCARD],
    ALLOW_REVERSE: [false, true]
  };
  return Object.entries(variants).reduce((configs, [key, values]) =>
    configs.flatMap(config => values.map(value => ({ ...config, [key]: value }))), [{ ...base }]);
}

function rankSweep(results) {
  return results.slice().sort((a, b) =>
    a.totalAbsoluteError - b.totalAbsoluteError ||
    (b.meanF1 ?? -1) - (a.meanF1 ?? -1) ||
    JSON.stringify(a.config).localeCompare(JSON.stringify(b.config))
  );
}

function makeSweepResult(seeds, cache, config, preparedRides = null) {
  let totalAbsoluteError = 0;
  const f1Scores = [];
  for (const seed of seeds) {
    const result = analyzeSeed(seed, cache, config, preparedRides);
    if (result.skipped) continue;
    totalAbsoluteError += Math.abs(result.counts.withSelf.delta);
    if (result.listScore) f1Scores.push(result.listScore.f1);
  }
  return {
    config,
    totalAbsoluteError,
    meanF1: f1Scores.length ? f1Scores.reduce((sum, score) => sum + score, 0) / f1Scores.length : null
  };
}

function sweep(seeds, cache, baseConfig = {}) {
  const preparedRides = prepareRides(cache, { ...routeMatching.DEFAULT_MATCH_CONFIG, ...baseConfig });
  return rankSweep(buildSweepGrid(baseConfig).map(config => makeSweepResult(seeds, cache, config, preparedRides)));
}

module.exports = {
  validateSeeds,
  resolveActivityIds,
  scoreMatchedIds,
  countInterpretations,
  analyzeSeed,
  prepareRides,
  buildSweepGrid,
  rankSweep,
  makeSweepResult,
  sweep
};
