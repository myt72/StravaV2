const test = require("node:test");
const assert = require("node:assert");
const { encodePolyline } = require("../lib/polyline");
const rm = require("../lib/routeMatching");

const M_PER_DEG = 111320;

// Deterministic pseudo-random noise.
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
}

/** Straight-ish route with a bend: from base heading out ~lengthKm and returning along a different line (loop). */
function makeRoute(base, shape, { noiseM = 0, seed = 1, n = 80 } = {}) {
  const rand = rng(seed);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const [dx, dy] = shape(t);
    pts.push([
      base[0] + (dy + rand() * noiseM) / M_PER_DEG,
      base[1] + (dx + rand() * noiseM) / (M_PER_DEG * Math.cos((base[0] * Math.PI) / 180))
    ]);
  }
  return pts;
}

const BASE = [40.0, -105.0];
const lineA = t => [t * 10000, Math.sin(t * Math.PI * 2) * 800]; // ~10 km
const lineB = t => [t * 10000, -t * 6000]; // same start, diverges

function activity(id, pts, extra = {}) {
  return {
    id, name: "Ride " + id, sport_type: "Ride", distance: 10000, total_elevation_gain: 100,
    start_date: `2024-0${(id % 9) + 1}-10T08:00:00Z`,
    summary_polyline: encodePolyline(pts), start_latlng: pts[0], end_latlng: pts[pts.length - 1], ...extra
  };
}

test("projection/resample produce equidistant points", () => {
  const pts = makeRoute(BASE, lineA);
  const r = rm.resample(pts, 50);
  assert.strictEqual(r.length, 50);
  const steps = [];
  for (let i = 1; i < r.length; i++) steps.push(rm.haversine(r[i - 1], r[i]));
  assert.ok(Math.max(...steps) / Math.min(...steps) < 1.1);
});

test("hausdorff: identical = 0, offset line = offset", () => {
  const a = [[0, 0], [0, 10], [0, 20]];
  const b = [[5, 0], [5, 10], [5, 20]];
  assert.strictEqual(rm.hausdorff(a, a), 0);
  assert.strictEqual(rm.hausdorff(a, b), 5);
  // one outlier is tolerated by the percentile variant
  const noisy = Array.from({ length: 20 }, (_, i) => [0, i]).concat([[500, 5]]);
  const clean = Array.from({ length: 20 }, (_, i) => [0, i]);
  assert.ok(rm.hausdorff(noisy, clean, 1) >= 500);
  assert.ok(rm.hausdorff(noisy, clean, 0.9) < 5);
});

test("dtw: identical = 0, shifted sampling is tolerated, normalised by path length", () => {
  const a = Array.from({ length: 30 }, (_, i) => [i, 0]);
  assert.strictEqual(rm.dtw(a, a), 0);
  const b = a.map(([x, y]) => [x, y + 2]);
  assert.ok(Math.abs(rm.dtw(a, b) - 2) < 1e-9);
  const stretched = Array.from({ length: 30 }, (_, i) => [Math.min(29, i * 1.05), 0]);
  assert.ok(rm.dtw(a, stretched) < 1);
});

test("compareRoutes: same route with GPS noise matches, direction same", () => {
  const a = rm.prepareRide(activity(1, makeRoute(BASE, lineA, { seed: 1 })));
  const b = rm.prepareRide(activity(2, makeRoute(BASE, lineA, { noiseM: 40, seed: 2, n: 70 })));
  const r = rm.compareRoutes(a, b);
  assert.strictEqual(r.match, true);
  assert.strictEqual(r.direction, "same");
  assert.strictEqual(r.method, "geometry");
});

test("compareRoutes: reversed route is flagged and only matches when allowed", () => {
  const fwd = makeRoute(BASE, lineA);
  const a = rm.prepareRide(activity(1, fwd));
  const b = rm.prepareRide(activity(2, fwd.slice().reverse()));
  const strict = rm.compareRoutes(a, b);
  assert.strictEqual(strict.direction, "reverse");
  assert.strictEqual(strict.match, false);
  const lenient = rm.compareRoutes(a, b, { ALLOW_REVERSE: true });
  assert.strictEqual(lenient.match, true);
  assert.strictEqual(lenient.direction, "reverse");
});

test("compareRoutes: different route with the same start does not match", () => {
  const a = rm.prepareRide(activity(1, makeRoute(BASE, lineA)));
  const b = rm.prepareRide(activity(2, makeRoute(BASE, lineB)));
  assert.strictEqual(rm.compareRoutes(a, b).match, false);
});

test("compareRoutes: very different distance is blocked; segment fallback without polyline", () => {
  const pts = makeRoute(BASE, lineA);
  const a = rm.prepareRide(activity(1, pts));
  const far = rm.prepareRide(activity(2, pts, { distance: 20000 }));
  assert.strictEqual(rm.compareRoutes(a, far).method, "none");

  const segs = ids => ids.map(segment_id => ({ segment_id }));
  const sd = { 5: segs([1, 2, 3, 4]), 6: segs([1, 2, 3, 4]), 7: segs([9, 8, 7]) };
  const mk = id => rm.prepareRide({ id, distance: 10000, summary_polyline: "" }, sd);
  assert.strictEqual(rm.compareRoutes(mk(5), mk(6)).match, true);
  assert.strictEqual(rm.compareRoutes(mk(5), mk(7)).match, false);
  assert.strictEqual(rm.compareRoutes(mk(5), mk(6)).method, "segments");
});

test("buildRouteClusters: groups, does not chain, is stable and incremental", () => {
  const acts = [
    activity(1, makeRoute(BASE, lineA, { seed: 1 })),
    activity(2, makeRoute(BASE, lineA, { noiseM: 30, seed: 2 })),
    activity(3, makeRoute(BASE, lineA, { noiseM: 30, seed: 3 })),
    activity(4, makeRoute(BASE, lineB, { seed: 4 })),
    activity(5, makeRoute(BASE, lineA, { seed: 5 }).reverse()),
    { id: 6, name: "Run", sport_type: "Run", distance: 10000, summary_polyline: encodePolyline(makeRoute(BASE, lineA)) },
    { id: 7, name: "Legacy", sport_type: "Ride", distance: 10000 }
  ];
  const res = rm.buildRouteClusters(acts, {});
  const sizes = res.clusters.map(c => c.activityIds.length).sort();
  assert.deepStrictEqual(sizes, [1, 1, 3]);
  assert.strictEqual(res.index["6"], undefined);
  assert.strictEqual(res.index["7"], undefined);
  assert.strictEqual(res.index["1"], res.index["2"]);
  const mainCluster = res.clusters.find(c => c.activityIds.length === 3);
  assert.strictEqual(res.index["1"], mainCluster.routeId);
  assert.strictEqual(mainCluster.routeId, rm.routeIdFor(mainCluster.representativeId));
  assert.strictEqual(res.version, rm.ROUTE_CLUSTER_VERSION);
  assert.notStrictEqual(res.index["1"], res.index["4"]);
  assert.notStrictEqual(res.index["1"], res.index["5"]);

  const more = acts.concat(activity(8, makeRoute(BASE, lineB, { noiseM: 20, seed: 8 })));
  const inc = rm.buildRouteClusters(more, {}, res);
  assert.strictEqual(inc.index["8"], res.index["4"]);
  assert.strictEqual(inc.index["1"], res.index["1"]);
  const full = rm.buildRouteClusters(more, {});
  assert.deepStrictEqual(full.index, inc.index);
  assert.strictEqual(inc.clusters.find(c => c.routeId === res.index["1"]).name.startsWith("Ride"), true);
});

test("leaderboards: all-time, year, month, month-in-year, ordering and limit", () => {
  const mk = (id, date, name = "Loop") => ({ id, name, start_date: date, distance: 1, summary_polyline: "x" });
  const acts = [
    mk(1, "2023-05-01T10:00:00Z"), mk(2, "2024-05-02T10:00:00Z"), mk(3, "2024-06-03T10:00:00Z"),
    mk(4, "2024-05-04T10:00:00Z", "Other"), mk(5, "2024-05-20T10:00:00Z", "Other"), mk(6, "2024-06-21T10:00:00Z", "Solo")
  ];
  const clusters = [
    { routeId: "a", representativeId: 1, name: "Loop", distance: 1, elevation: 2, activityIds: [1, 2, 3] },
    { routeId: "b", representativeId: 4, name: "Other", distance: 1, elevation: 2, activityIds: [4, 5] },
    { routeId: "c", representativeId: 6, name: "Solo", distance: 1, elevation: 2, activityIds: [6] }
  ];
  const all = rm.routeLeaderboard(clusters, acts);
  assert.deepStrictEqual(all.map(r => [r.routeId, r.count]), [["a", 3], ["b", 2], ["c", 1]]);
  assert.strictEqual(all[0].firstRidden, "2023-05-01T10:00:00Z");
  assert.strictEqual(all[0].lastRidden, "2024-06-03T10:00:00Z");

  const y24 = rm.routeLeaderboard(clusters, acts, { year: 2024 });
  assert.deepStrictEqual(y24.map(r => [r.routeId, r.count]), [["a", 2], ["b", 2], ["c", 1]]); // tie -> most recent first
  const may = rm.routeLeaderboard(clusters, acts, { month: 5 });
  assert.deepStrictEqual(may.map(r => [r.routeId, r.count]), [["b", 2], ["a", 2]]);
  const may24 = rm.routeLeaderboard(clusters, acts, { year: 2024, month: 5 });
  assert.deepStrictEqual(may24.map(r => [r.routeId, r.count]), [["b", 2], ["a", 1]]);
  assert.strictEqual(rm.routeLeaderboard(clusters, acts, { limit: 1 }).length, 1);
  assert.strictEqual(rm.routeLeaderboard(clusters, acts, { year: 1999 }).length, 0);
});

test("segmentLeaderboard: period filters and exclusions", () => {
  const e = (segment_id, start_date) => ({ segment_id, segment_name: "S" + segment_id, start_date });
  const sd = {
    1: [e(10, "2023-01-05T00:00:00Z"), e(11, "2023-01-05T00:00:00Z")],
    2: [e(10, "2024-02-05T00:00:00Z")],
    3: [e(10, "2024-02-06T00:00:00Z"), e(10, "2024-02-06T00:01:00Z")]
  };
  const all = rm.segmentLeaderboard(sd);
  assert.deepStrictEqual(all.map(r => [r.segmentId, r.count]), [["10", 3], ["11", 1]]);
  assert.strictEqual(all[0].firstRidden, "2023-01-05T00:00:00Z");
  assert.strictEqual(rm.segmentLeaderboard(sd, { year: 2024 })[0].count, 2);
  assert.strictEqual(rm.segmentLeaderboard(sd, { year: 2024, month: 2 }).length, 1);
  assert.strictEqual(rm.segmentLeaderboard(sd, { month: 1 }).length, 2);
  assert.deepStrictEqual(rm.segmentLeaderboard(sd, { excludedSegmentIds: ["10"] }).map(r => r.segmentId), ["11"]);
});

/* ---------- density clustering, per-activity matches, overlap, sport groups ---------- */

const offsetNorth = (pts, m) => pts.map(p => [p[0] + m / M_PER_DEG, p[1]]);

/** Same line, but the recorded start point differs (like riders who start a little before/after each other). */
function startOffsetActivity(id, startOffsetM, extra = {}) {
  const pts = makeRoute(BASE, lineA, { seed: id });
  return activity(id, pts, { start_latlng: offsetNorth([pts[0]], startOffsetM)[0], ...extra });
}

const SPLIT_OFFSETS = { 1: 0, 2: 100, 3: 110, 4: 225, 5: 230, 6: 235 };
const splitActivities = () => Object.entries(SPLIT_OFFSETS).map(([id, off]) => startOffsetActivity(Number(id), off));

function leaderClusters(acts, config) {
  const rides = acts.map(a => rm.prepareRide(a, {}, config));
  const leaders = [];
  for (const ride of rides) {
    const home = leaders.find(l => rm.compareRoutes(l.leader, ride, config).match);
    if (home) home.members.push(ride.id); else leaders.push({ leader: ride, members: [ride.id] });
  }
  return leaders.map(l => l.members);
}

test("density clustering does not split a route whose rides differ slightly at the start; leader clustering does", () => {
  const acts = splitActivities();
  const leader = leaderClusters(acts, {});
  assert.deepStrictEqual(leader.map(m => m.length), [3, 3]);

  const res = rm.buildRouteClusters(acts, {});
  assert.strictEqual(res.clusters.length, 1);
  assert.strictEqual(res.clusters[0].activityIds.length, 6);
  // Representative is the medoid (most direct matches), not the earliest ride.
  assert.notStrictEqual(String(res.clusters[0].representativeId), "1");
  const rep = rm.prepareRide(acts.find(a => a.id === res.clusters[0].representativeId));
  for (const a of acts) {
    if (a.id !== rep.id) assert.strictEqual(rm.compareRoutes(rep, rm.prepareRide(a)).match, true);
  }
});

test("cluster membership is independent of input order", () => {
  const acts = splitActivities().concat([
    activity(20, makeRoute(BASE, lineB, { seed: 20 })),
    activity(21, makeRoute(BASE, lineB, { noiseM: 20, seed: 21 })),
    activity(22, makeRoute(BASE, lineA, { seed: 22 }).reverse())
  ]);
  const signature = res => res.clusters
    .map(c => `${c.representativeId}:${c.activityIds.map(String).sort().join(",")}`).sort().join("|");
  const expected = signature(rm.buildRouteClusters(acts, {}));
  const rand = rng(7);
  for (let k = 0; k < 5; k++) {
    const shuffled = acts.slice().sort(() => rand());
    assert.strictEqual(signature(rm.buildRouteClusters(shuffled, {})), expected);
  }
});

test("matchesFor: per-activity direct matches may overlap; clusters are exclusive", () => {
  const acts = splitActivities();
  const ids = id => rm.matchesFor(id, acts, {}).map(m => Number(m.id)).sort();
  assert.deepStrictEqual(ids(1), [2, 3]);
  assert.deepStrictEqual(ids(2), [1, 3, 4, 5, 6]);
  assert.deepStrictEqual(ids(6), [2, 3, 4, 5]);
  assert.deepStrictEqual(rm.matchesFor(999, acts, {}), []);
});

test("buildRouteClusters: version mismatch rebuilds; matching version keeps assignments", () => {
  const acts = splitActivities();
  const stale = { version: 1, clusters: [{ routeId: "rOld", representativeId: 1, name: "x", activityIds: [1, 2, 3] }], index: { 1: "rOld", 2: "rOld", 3: "rOld" } };
  const rebuilt = rm.buildRouteClusters(acts, {}, stale);
  assert.strictEqual(rebuilt.version, rm.ROUTE_CLUSTER_VERSION);
  assert.ok(!rebuilt.clusters.some(c => c.routeId === "rOld"));
  assert.strictEqual(rebuilt.clusters.length, 1);
  const again = rm.buildRouteClusters(acts, {}, rebuilt);
  assert.deepStrictEqual(again.index, rebuilt.index);
});

test("overlap match tolerates a small detour that Hausdorff/DTW reject", () => {
  const detour = t => [t * 10000, t > 0.45 && t < 0.55 ? 400 : 0];
  const a = rm.prepareRide(activity(1, makeRoute(BASE, t => [t * 10000, 0], { n: 120 })));
  const b = rm.prepareRide(activity(2, makeRoute(BASE, detour, { n: 120 })));
  assert.strictEqual(rm.compareRoutes(a, b).match, false);
  const r = rm.compareRoutes(a, b, { OVERLAP_MIN_FRACTION: 0.8, OVERLAP_DISTANCE_M: 40 });
  assert.strictEqual(r.match, true);
  assert.ok(r.overlap >= 0.8 && r.overlap < 1);
  assert.strictEqual(rm.compareRoutes(a, b, { OVERLAP_MIN_FRACTION: 0.98, OVERLAP_DISTANCE_M: 40 }).match, false);
});

test("sport groups: Walk+Hike cluster together, never with Rides; Runs are ignored", () => {
  const pts = makeRoute(BASE, lineA, { seed: 1 });
  const acts = [
    activity(1, pts, { sport_type: "Walk" }),
    activity(2, pts, { sport_type: "Hike" }),
    activity(3, pts, { sport_type: "Ride" }),
    activity(4, pts, { sport_type: "Ride" }),
    activity(5, pts, { sport_type: "Run" })
  ];
  const res = rm.buildRouteClusters(acts, {});
  assert.strictEqual(res.index["1"], res.index["2"]);
  assert.strictEqual(res.index["3"], res.index["4"]);
  assert.notStrictEqual(res.index["1"], res.index["3"]);
  assert.strictEqual(res.index["5"], undefined);
  assert.deepStrictEqual(res.clusters.map(c => c.sportGroup).sort(), ["Ride", "WalkHike"]);
  assert.strictEqual(rm.matchesFor(1, acts, {}).length, 1);
});

test("Walk/Hike use tighter defaults and settings can override them per group", () => {
  const wide = (id, type) => startOffsetActivity(id, id === 1 ? 0 : 120, { sport_type: type });
  const walks = [wide(1, "Walk"), wide(2, "Hike")];
  const rides = [wide(3, "Ride"), wide(4, "Ride")];
  assert.strictEqual(rm.resolveGroupConfig("WalkHike").START_END_RADIUS_M, 75);
  assert.strictEqual(rm.resolveGroupConfig("Ride").START_END_RADIUS_M, 150);
  // Ride 120 m start offsets (the base ride is offset 0 vs 120) match with the ride defaults only.
  assert.strictEqual(rm.matchesFor(3, rides, {}).length, 1);
  assert.strictEqual(rm.matchesFor(1, walks, {}).length, 0);
  const cfg = rm.validateMatchConfig({ GROUP_OVERRIDES: { WalkHike: { START_END_RADIUS_M: 150 } } });
  assert.strictEqual(rm.resolveGroupConfig("WalkHike", cfg).START_END_RADIUS_M, 150);
  assert.strictEqual(rm.matchesFor(1, walks, {}, cfg).length, 1);
  assert.strictEqual(rm.resolveGroupConfig("Ride", cfg).START_END_RADIUS_M, 150);
});

test("validateMatchConfig: GROUP_OVERRIDES and overlap settings are validated and bounded", () => {
  assert.throws(() => rm.validateMatchConfig({ GROUP_OVERRIDES: { Run: {} } }), /Unknown sport group/);
  assert.throws(() => rm.validateMatchConfig({ GROUP_OVERRIDES: { WalkHike: { DTW_THRESHOLD_M: 9999 } } }), /between 5 and 500/);
  assert.throws(() => rm.validateMatchConfig({ GROUP_OVERRIDES: { WalkHike: { SPORT_TYPES: ["Walk"] } } }), /per sport group/);
  assert.throws(() => rm.validateMatchConfig({ GROUP_OVERRIDES: { WalkHike: { GROUP_OVERRIDES: {} } } }), /Unknown route-matching setting/);
  assert.throws(() => rm.validateMatchConfig({ OVERLAP_MIN_FRACTION: 2 }), /between 0 and 1/);
  assert.deepStrictEqual(rm.validateMatchConfig({ OVERLAP_MIN_FRACTION: 0.9, OVERLAP_DISTANCE_M: 30 }), { OVERLAP_MIN_FRACTION: 0.9, OVERLAP_DISTANCE_M: 30 });
});

test("segment overlap is never used for Walk/Hike scoring", () => {
  const segs = [{ segment_id: 1 }, { segment_id: 2 }, { segment_id: 3 }];
  const sd = { 1: segs, 2: segs };
  const pts = makeRoute(BASE, lineA);
  const walk = rm.prepareRide(activity(1, pts, { sport_type: "Walk" }), sd);
  const ride = rm.prepareRide(activity(2, pts, { sport_type: "Ride" }), sd);
  assert.strictEqual(walk.segIds.size, 0);
  assert.strictEqual(ride.segIds.size, 3);
  const other = rm.prepareRide(activity(3, pts, { sport_type: "Walk" }), sd);
  assert.strictEqual(rm.compareRoutes(walk, other).jaccard, null);
  assert.strictEqual(rm.compareRoutes(walk, other).match, true);
});
