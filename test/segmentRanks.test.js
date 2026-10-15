const test = require("node:test");
const assert = require("node:assert");
const sr = require("../lib/segmentRanks");

const eff = (segment_id, start_date, elapsed_time, pr_rank = null, segment_name = `Seg ${segment_id}`) =>
  ({ segment_id, segment_name, start_date, elapsed_time, pr_rank });
const rides = ids => ids.map(id => ({ id, sport_type: "Ride", start_date: "2024-01-01T00:00:00Z" }));

const segmentData = {
  1: [eff(10, "2024-01-01T10:00:00Z", 100, 1), eff(11, "2024-01-01T10:05:00Z", 50, 2)],
  2: [eff(10, "2024-02-01T10:00:00Z", 95, 1)],
  3: [eff(12, "2024-03-01T10:00:00Z", 60, 1)], // activity 3 is a Run: ignored
  4: [eff(13, "2024-04-01T10:00:00Z", 70, 1), eff(13, "2024-05-01T10:00:00Z", 70, null)]
};
const activities = [...rides([1, 2, 4]), { id: 3, sport_type: "Run" }];

test("candidates: rides only, with a PR effort, best efforts incl. ties", () => {
  const c = sr.buildRankCandidates(segmentData, activities);
  assert.deepStrictEqual(c.map(x => x.id), ["10", "13"]);
  assert.deepStrictEqual([...c[0].activityIds].sort(), ["1", "2"]);
  assert.strictEqual(c[0].bestEfforts.length, 1);
  assert.strictEqual(c[0].bestEfforts[0].elapsed, 95);
  assert.strictEqual(c[1].bestEfforts.length, 2);
});

const cand = sr.buildRankCandidates(segmentData, activities)[0];
const entry = (rank, start_date, elapsed_time, extra = {}) => ({ rank, start_date, elapsed_time, athlete_name: "Someone E.", ...extra });

test("matches own entry by start_date + elapsed_time of the best effort", () => {
  const entries = [entry(1, "2023-01-01T00:00:00Z", 90), entry(2, "2024-02-01T10:00:00Z", 95), entry(3, "2022-01-01T00:00:00Z", 99)];
  assert.strictEqual(sr.matchLeaderboardEntry(entries, cand), 2);
});

test("a slower non-best effort of the athlete does not match", () => {
  assert.strictEqual(sr.matchLeaderboardEntry([entry(1, "2024-01-01T10:00:00Z", 100)], cand), null);
});

test("prefers activity_id when the response includes it", () => {
  const entries = [entry(1, "2000-01-01T00:00:00Z", 1, { activity_id: 2 }), entry(2, "2024-02-01T10:00:00Z", 95, { activity_id: 999 })];
  assert.strictEqual(sr.matchLeaderboardEntry(entries, cand), 1);
});

test("no match in the top 3 gives null", () => {
  assert.strictEqual(sr.matchLeaderboardEntry([entry(1, "2023-01-01T00:00:00Z", 90)], cand), null);
  assert.strictEqual(sr.matchLeaderboardEntry([], cand), null);
  assert.strictEqual(sr.matchLeaderboardEntry(undefined, cand), null);
});

test("rank beyond 3 is not recorded; missing rank falls back to position", () => {
  assert.strictEqual(sr.matchLeaderboardEntry([entry(4, "2024-02-01T10:00:00Z", 95)], cand), null);
  assert.strictEqual(sr.matchLeaderboardEntry([{ start_date: "2024-02-01T10:00:00Z", elapsed_time: 95 }], cand), 1);
});

test("ties: identical time entries are separated by athlete name, else best rank wins", () => {
  const entries = [
    entry(1, "2024-02-01T10:00:00Z", 95, { athlete_name: "Other P." }),
    entry(2, "2024-02-01T10:00:00Z", 95, { athlete_name: "Jane D." })
  ];
  assert.strictEqual(sr.matchLeaderboardEntry(entries, cand, { firstname: "Jane", lastname: "Doe" }), 2);
  assert.strictEqual(sr.matchLeaderboardEntry(entries, cand, null), 1);
  assert.strictEqual(sr.matchLeaderboardEntry(entries, cand, { firstname: "Zed", lastname: "Q" }), 1);
});

test("ties between the athlete's own efforts on a segment both match", () => {
  const c13 = sr.buildRankCandidates(segmentData, activities)[1];
  assert.strictEqual(sr.matchLeaderboardEntry([entry(1, "2024-05-01T10:00:00Z", 70)], c13), 1);
  assert.strictEqual(sr.matchLeaderboardEntry([entry(1, "2024-04-01T10:00:00Z", 70)], c13), 1);
});

test("nameMatches handles abbreviated names and unknowns", () => {
  const me = { firstname: "Jane", lastname: "Doe" };
  assert.ok(sr.nameMatches("Jane D.", me));
  assert.ok(sr.nameMatches("Jane Doe", me));
  assert.ok(!sr.nameMatches("Jane S.", me));
  assert.ok(sr.nameMatches(undefined, me));
  assert.ok(sr.nameMatches("Anyone", null));
});

test("selectSegmentsToCheck: unchecked, then refresh by age and newer PR", () => {
  const cands = sr.buildRankCandidates(segmentData, activities); // 10 (last PR 2024-02-01), 13 (2024-04-01)
  const now = Date.parse("2024-06-10T00:00:00Z");
  const ranks = { 10: { rank: 1, checkedAt: "2024-06-09T00:00:00Z" } };
  assert.deepStrictEqual(sr.selectSegmentsToCheck(cands, ranks, { now }).map(c => c.id), ["13"]);
  assert.deepStrictEqual(sr.selectSegmentsToCheck(cands, ranks, { refresh: true, now }).map(c => c.id), ["13"]);
  ranks[13] = { rank: null, checkedAt: "2024-06-09T00:00:00Z" };
  assert.deepStrictEqual(sr.selectSegmentsToCheck(cands, ranks, { refresh: true, now }), []);
  ranks[10].checkedAt = "2024-05-01T00:00:00Z"; // older than 7 days
  assert.deepStrictEqual(sr.selectSegmentsToCheck(cands, ranks, { refresh: true, now }).map(c => c.id), ["10"]);
  ranks[10].checkedAt = "2024-01-15T00:00:00Z"; ranks[13].checkedAt = "2024-06-09T00:00:00Z";
  assert.deepStrictEqual(sr.selectSegmentsToCheck(cands, ranks, { refresh: true, maxAgeDays: 1000, now }).map(c => c.id), ["10"]); // PR newer than checkedAt
});

const NOW = () => new Date("2024-06-10T00:00:00Z");
const ok = entries => ({ status: 200, ok: true, json: { entries } });

test("runRankBatch records ranks, null for no match, and skips 404 segments", async () => {
  const cands = sr.buildRankCandidates(segmentData, activities);
  const ranks = {};
  const responses = { 10: ok([entry(3, "2024-02-01T10:00:00Z", 95)]), 13: { status: 404, ok: false } };
  const res = await sr.runRankBatch({ queue: cands, ranks, now: NOW, fetchLeaderboard: async id => responses[id] });
  assert.deepStrictEqual(res, { checked: 2, stopped: null, error: null });
  assert.strictEqual(ranks[10].rank, 3);
  assert.strictEqual(ranks[10].entries, 1);
  assert.strictEqual(ranks[13].rank, null);
  assert.strictEqual(ranks[10].checkedAt, "2024-06-10T00:00:00.000Z");
});

test("runRankBatch stops on 429 and keeps earlier progress (resumable)", async () => {
  const cands = sr.buildRankCandidates(segmentData, activities);
  const ranks = {};
  const calls = [];
  const res = await sr.runRankBatch({
    queue: cands, ranks, now: NOW,
    fetchLeaderboard: async id => { calls.push(id); return id === "10" ? ok([]) : { status: 429, ok: false }; }
  });
  assert.strictEqual(res.stopped, "rate_limited");
  assert.deepStrictEqual(Object.keys(ranks), ["10"]);
  const rest = sr.selectSegmentsToCheck(cands, ranks);
  assert.deepStrictEqual(rest.map(c => c.id), ["13"]);
});

for (const status of [401, 402, 403]) {
  test(`runRankBatch stops with a clear error on ${status} and makes no further requests`, async () => {
    const cands = sr.buildRankCandidates(segmentData, activities);
    const ranks = {};
    let calls = 0;
    const res = await sr.runRankBatch({ queue: cands, ranks, now: NOW, fetchLeaderboard: async () => { calls++; return { status, ok: false }; } });
    assert.strictEqual(res.stopped, "forbidden");
    assert.match(res.error, new RegExp(`HTTP ${status}`));
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(ranks, {});
  });
}

test("runRankBatch stops on other errors and when canContinue turns false", async () => {
  const cands = sr.buildRankCandidates(segmentData, activities);
  let res = await sr.runRankBatch({ queue: cands, ranks: {}, now: NOW, fetchLeaderboard: async () => ({ status: 500, ok: false }) });
  assert.strictEqual(res.stopped, "error");
  assert.match(res.error, /HTTP 500/);
  let n = 0;
  const ranks = {};
  res = await sr.runRankBatch({ queue: cands, ranks, now: NOW, canContinue: () => n++ < 1, fetchLeaderboard: async () => ok([]) });
  assert.strictEqual(res.stopped, "cancelled");
  assert.strictEqual(Object.keys(ranks).length, 1);
});

test("summarizeRanks counts tiers", () => {
  assert.deepStrictEqual(sr.summarizeRanks({ a: { rank: 1 }, b: { rank: 1 }, c: { rank: 2 }, d: { rank: 3 }, e: { rank: null } }), { kom: 2, second: 1, third: 1 });
});
