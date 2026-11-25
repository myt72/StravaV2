const test = require("node:test");
const assert = require("node:assert/strict");
const sd = require("../lib/segmentDetails");

const activities = [{ id: "1", sport_type: "Ride" }, { id: "2", sport_type: "Run" }];
const segmentData = {
  "1": [{ segment_id: 7, segment_name: "Hill" }, { segment_id: 7 }, { segment_id: 3 }],
  "2": [{ segment_id: 9 }],
  "orphan": [{ segment_id: 4 }]
};

test("candidates are distinct ride segments; only unfetched ones are queued unless refreshing", () => {
  const candidates = sd.buildDetailCandidates(segmentData, activities);
  assert.deepEqual(candidates.map(c => c.id), ["3", "7"]);
  const details = { "3": { checkedAt: "2026-01-01T00:00:00Z" } };
  assert.deepEqual(sd.selectDetailsToFetch(candidates, details).map(c => c.id), ["7"]);
  assert.deepEqual(sd.selectDetailsToFetch(candidates, details, { refresh: true }).map(c => c.id), ["3", "7"]);
});

test("batch stores normalized details, records 404s and stops without recording on 429, 403 and errors", async () => {
  const queue = [{ id: "1" }, { id: "2" }, { id: "3" }];
  const details = {};
  const responses = {
    "1": { status: 200, ok: true, json: { distance: 500, average_grade: 4.2, maximum_grade: 9, elevation_high: 120, elevation_low: 100, map: { polyline: "abc" } } },
    "2": { status: 404, ok: false },
    "3": { status: 429, ok: false }
  };
  const result = await sd.runDetailBatch({ queue, details, fetchDetail: id => responses[id], now: () => new Date("2026-01-01T00:00:00Z") });
  assert.deepEqual(result, { checked: 2, stopped: "rate_limited", error: null });
  assert.deepEqual(details["1"], { checkedAt: "2026-01-01T00:00:00.000Z", distance: 500, average_grade: 4.2, maximum_grade: 9, elevation_high: 120, elevation_low: 100, polyline: "abc" });
  assert.deepEqual(details["2"], { checkedAt: "2026-01-01T00:00:00.000Z", missing: true });
  assert.equal(details["3"], undefined);

  assert.equal((await sd.runDetailBatch({ queue: [{ id: "5" }], details, fetchDetail: () => ({ status: 403, ok: false }) })).stopped, "forbidden");
  assert.equal((await sd.runDetailBatch({ queue: [{ id: "6" }], details, fetchDetail: () => ({ status: 500, ok: false }) })).stopped, "error");
  assert.equal(details["5"], undefined);
  assert.equal(details["6"], undefined);
});
