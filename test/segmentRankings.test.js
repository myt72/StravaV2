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
