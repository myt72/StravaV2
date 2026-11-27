const test = require("node:test");
const assert = require("node:assert/strict");
const se = require("../lib/segmentEfforts");

const activities = [{ id: "1", sport_type: "Ride" }, { id: "2", sport_type: "Ride" }, { id: "3", sport_type: "Run" }];
const norm = e => ({ segment_id: e.segment.id, start_date: e.start_date, elapsed_time: e.elapsed_time });

test("candidates: watched first, then most ridden, unwatched need minTries", () => {
  const segmentData = {
    "1": [{ segment_id: 7 }, { segment_id: 3 }, { segment_id: 5 }],
    "2": [{ segment_id: 7 }, { segment_id: 3 }],
    "3": [{ segment_id: 9 }, { segment_id: 9 }]
  };
  assert.deepEqual(se.buildEffortCandidates(segmentData, activities).map(c => c.id), ["3", "7"]);
  assert.deepEqual(se.buildEffortCandidates(segmentData, activities, { watched: ["5"] }).map(c => c.id), ["5", "3", "7"]);
  const synced = { "3": { checkedAt: "x" } };
  assert.deepEqual(se.selectEffortsToCheck([{ id: "3" }, { id: "7" }], synced).map(c => c.id), ["7"]);
  assert.equal(se.selectEffortsToCheck([{ id: "3" }, { id: "7" }], synced, { refresh: true }).length, 2);
});

test("batch merges only missing efforts into already-fetched activities, paginates, and stops on errors", async () => {
  const segmentData = { "1": [{ segment_id: 7, start_date: "d1" }], "2": [] };
  const effort = (activity, start) => ({ activity: { id: activity }, segment: { id: 7 }, start_date: start, elapsed_time: 60 });
  const page1 = Array.from({ length: se.PER_PAGE }, (_, i) => effort(i === 0 ? 1 : 99, i === 0 ? "d1" : `x${i}`));
  const pages = {
    "7:1": { status: 200, ok: true, json: page1 },
    "7:2": { status: 200, ok: true, json: [effort(2, "d2")] },
    "8:1": { status: 429, ok: false }
  };
  const synced = {};
  const result = await se.runEffortBatch({
    queue: [{ id: "7" }, { id: "8" }], segmentData, synced, normalize: norm,
    fetchPage: (id, page) => pages[`${id}:${page}`], now: () => new Date("2026-01-01T00:00:00Z")
  });
  assert.deepEqual(result, { checked: 1, added: 1, stopped: "rate_limited", error: null });
  assert.deepEqual(segmentData["2"], [{ segment_id: 7, start_date: "d2", elapsed_time: 60 }]);
  assert.equal(segmentData["1"].length, 1);
  assert.equal(segmentData["99"], undefined);
  assert.deepEqual(synced["7"], { checkedAt: "2026-01-01T00:00:00.000Z", fetched: se.PER_PAGE + 1, added: 1, skipped: se.PER_PAGE - 1 });
  assert.equal(synced["8"], undefined);

  const forbidden = await se.runEffortBatch({ queue: [{ id: "9" }], segmentData, synced, normalize: norm, fetchPage: () => ({ status: 402, ok: false }) });
  assert.equal(forbidden.stopped, "forbidden");
  assert.equal(synced["9"], undefined);
});
