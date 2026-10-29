const test = require("node:test");
const assert = require("node:assert");

test("buildSegmentRankings groups exclusive tiers with efforts and last ridden", async () => {
  const { buildSegmentRankings, buildSegmentLeaderboard } = await import("../client/src/lib/analytics.js");
  const e = (id, name, pr = null) => ({ segment_id: id, segment_name: name, start_date: "2024-01-01T00:00:00Z", pr_rank: pr });
  const data = {
    activities: [
      { id: 1, start_date: "2024-01-01T00:00:00Z" }, { id: 2, start_date: "2024-03-01T00:00:00Z" }, { id: 3, start_date: "2024-02-01T00:00:00Z" }
    ],
    segmentData: { 1: [e(10, "Alpha"), e(11, "Beta"), e(13, "Delta")], 2: [e(10, "Alpha"), e(12, "Gamma")], 3: [e(11, "Beta"), e(99, "Gone")], 7: [e(10, "Alpha")] }
  };
  const ranks = { 10: { rank: 1 }, 11: { rank: 2 }, 12: { rank: 3 }, 13: { rank: null }, 14: { rank: 1 } };
  const r = buildSegmentRankings(data, ranks);
  assert.deepStrictEqual(r.kom, [{ segmentId: "10", segmentName: "Alpha", attempts: 2, lastRidden: "2024-03-01T00:00:00Z" }]);
  assert.deepStrictEqual(r.second.map(x => [x.segmentId, x.attempts, x.lastRidden]), [["11", 2, "2024-02-01T00:00:00Z"]]);
  assert.deepStrictEqual(r.third.map(x => x.segmentId), ["12"]);
  assert.deepStrictEqual(buildSegmentRankings(data, undefined), { kom: [], second: [], third: [] });
  assert.deepStrictEqual(buildSegmentRankings(null, ranks), { kom: [], second: [], third: [] });

  const rows = buildSegmentLeaderboard(data.segmentData, data.activities, new Set());
  assert.ok(rows.length && rows.every(row => row.segmentId === row.key));
});

test("buildSegmentConsistency ranks multi-year segments", async () => {
  const { buildSegmentConsistency } = await import("../client/src/lib/analytics.js");
  const e = (id, d) => ({ segment_id: id, segment_name: `S${id}`, start_date: d });
  const acts = [1, 2, 3, 4, 5].map(id => ({ id }));
  const data = {
    1: [e(1, "2022-05-01T00:00:00Z"), e(2, "2022-05-01T00:00:00Z"), e(3, "2022-05-01T00:00:00Z")],
    2: [e(1, "2023-05-01T00:00:00Z"), e(2, "2023-05-01T00:00:00Z")],
    3: [e(1, "2024-05-01T00:00:00Z"), e(2, "2024-05-01T00:00:00Z")],
    4: [e(2, "2024-06-01T00:00:00Z")],
    5: [e(1, "2024-06-01T00:00:00Z")],
    9: [e(1, "2024-06-01T00:00:00Z")]
  };
  const rows = buildSegmentConsistency(data, acts, new Set(["3"]));
  assert.deepStrictEqual(rows.map(r => r.segmentId), ["1", "2"]);
  assert.deepStrictEqual(rows[0].counts, { 2022: 1, 2023: 1, 2024: 2 });
  assert.strictEqual(rows[0].yearsActive, 3);
  assert.strictEqual(rows[0].total, 4);
  assert.strictEqual(buildSegmentConsistency(data, acts, new Set(), { limit: 1 }).length, 1);
});

test("bike comparison and same-course speed", async () => {
  const a = await import("../client/src/lib/analytics.js");
  const acts = [
    { id: 1, gear_id: "b1", distance: 16093.4, moving_time: 3600 },
    { id: 2, gear_id: "b1", distance: 1609.34, moving_time: 360 },
    { id: 3, gear_id: "b2", distance: 16093.4, moving_time: 2400 },
    { id: 4, gear_id: "b2", distance: 16093.4, moving_time: 2400 },
    { id: 5 }
  ];
  const e = (id, t, d = 1000) => ({ segment_id: id, segment_name: `S${id}`, start_date: "2024-01-01T00:00:00Z", elapsed_time: t, distance: d });
  const seg = { 1: [e(1, 100), e(2, 50)], 2: [e(1, 90)], 3: [e(1, 80), e(3, 10)], 4: [e(1, 85)], 5: [e(1, 1)] };
  const r = a.buildSegmentBikeComparison(seg, acts, new Set(["2"]));
  assert.deepStrictEqual(r.rows.map(x => x.segmentId), ["1"]);
  assert.strictEqual(r.rows[0].bikes.b1.best, 90);
  assert.strictEqual(r.rows[0].bikes.b2.best, 80);
  assert.strictEqual(r.rows[0].bestBike, "b2");
  assert.strictEqual(r.rows[0].gapSeconds, 10);
  assert.deepStrictEqual(r.wins, { b2: 1 });

  const clusters = { clusters: [{ routeId: "r", name: "R", activityIds: [1, 2, 3, 4, 5] }] };
  const rs = a.buildRouteBikeSpeed(clusters, acts);
  const row = rs.rows[0];
  // weighted: 17702.74 m / 3960 s, not mean of 16 mph and 10 mph
  assert.ok(Math.abs(row.bikes.b1.avgMph - (17702.74 / 1609.34) / (3960 / 3600)) < 1e-6);
  assert.strictEqual(row.fastestBike, "b2");
  assert.ok(Math.abs(row.bikes.b2.avgMph - 15) < 1e-3);
  assert.strictEqual(rs.index[0].gid, "b2");
  assert.ok(Math.abs(rs.index[0].index + rs.index[1].index) < 1e-9);
  assert.strictEqual(a.buildRouteBikeSpeed(clusters, acts, { minRides: 3 }).rows.length, 0);

  const ss = a.buildSegmentBikeSpeed(seg, acts, new Set(), { minRides: 1 });
  assert.ok(ss.rows.some(x => x.segmentId === "1"));
  assert.ok(!ss.rows.some(x => x.segmentId === "3"));
});
