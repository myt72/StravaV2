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
