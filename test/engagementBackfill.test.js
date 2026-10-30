const test = require("node:test");
const assert = require("node:assert");
const eb = require("../lib/engagementBackfill");
const { activitySignature, findChangedActivities } = require("../lib/activitySync");

test("mapEngagementFields coerces to non-negative integers and omits missing", () => {
  assert.deepStrictEqual(eb.mapEngagementFields({ kudos_count: 5, comment_count: 2, photo_count: 1 }), { kudos_count: 5, comment_count: 2, photo_count: 1 });
  assert.deepStrictEqual(eb.mapEngagementFields({ kudos_count: "7", comment_count: -3, photo_count: 2.9 }), { kudos_count: 7, comment_count: 0, photo_count: 2 });
  assert.deepStrictEqual(eb.mapEngagementFields({ name: "x" }), {});
  assert.deepStrictEqual(eb.mapEngagementFields({ kudos_count: null, comment_count: "abc", photo_count: undefined }), {});
  assert.deepStrictEqual(eb.mapEngagementFields({ kudos_count: 0 }), { kudos_count: 0 });
});

test("photo_count is preferred; total_photo_count is only a fallback", () => {
  assert.strictEqual(eb.mapEngagementFields({ photo_count: 0, total_photo_count: 4 }).photo_count, 0);
  assert.strictEqual(eb.mapEngagementFields({ photo_count: 2, total_photo_count: 4 }).photo_count, 2);
  assert.strictEqual(eb.mapEngagementFields({ total_photo_count: 4 }).photo_count, 4);
});

test("default shape", () => {
  assert.deepStrictEqual(eb.defaultEngagementBackfill(), { nextPage: 1, completed: false, lastRunAt: null, pagesDone: 0, secondPass: false, lastError: null });
});

test("hasEngagement distinguishes 0 from missing", () => {
  assert.strictEqual(eb.hasEngagement({ kudos_count: 0 }), true);
  assert.strictEqual(eb.hasEngagement({}), false);
  assert.strictEqual(eb.hasEngagement(null), false);
});

test("mergeEngagement fills by id without touching other fields", () => {
  const cached = [{ id: 1, name: "A", distance: 10 }, { id: 2, name: "B", kudos_count: 3 }];
  const n = eb.mergeEngagement(cached, [
    { id: 1, name: "changed", distance: 99, kudos_count: 4, comment_count: 1, photo_count: 0 },
    { id: 2, kudos_count: 9 },
    { id: 3, kudos_count: 1 }
  ]);
  assert.strictEqual(n, 1);
  assert.deepStrictEqual(cached[0], { id: 1, name: "A", distance: 10, kudos_count: 4, comment_count: 1, photo_count: 0 });
  assert.strictEqual(cached[1].kudos_count, 3);
});

test("mergeEngagement leaves fields undefined when absent", () => {
  const cached = [{ id: 1 }];
  assert.strictEqual(eb.mergeEngagement(cached, [{ id: 1, name: "x" }]), 0);
  assert.ok(!("kudos_count" in cached[0]));
});

test("mergeEngagement overwrite prefers fresh values", () => {
  const cached = [{ id: 1, kudos_count: 3, comment_count: 1 }];
  assert.strictEqual(eb.mergeEngagement(cached, [{ id: 1, kudos_count: 8 }], { overwrite: true }), 1);
  assert.deepStrictEqual(cached[0], { id: 1, kudos_count: 8, comment_count: 1 });
  assert.strictEqual(eb.mergeEngagement(cached, [{ id: 1, kudos_count: 8 }], { overwrite: true }), 0);
});

test("carryEngagement keeps cached counts only when fresh lacks them", () => {
  assert.deepStrictEqual(eb.carryEngagement({ id: 1 }, { id: 1, kudos_count: 5 }), { id: 1, kudos_count: 5 });
  assert.strictEqual(eb.carryEngagement({ id: 1, kudos_count: 9 }, { id: 1, kudos_count: 5 }).kudos_count, 9);
});

test("engagement fields never change the activity signature or flag activities as changed", () => {
  const base = { id: 1, name: "A", sport_type: "Ride", distance: 1, moving_time: 2, start_date: "2024-01-01", gear_id: "b1" };
  const withCounts = { ...base, kudos_count: 12, comment_count: 3, photo_count: 1 };
  assert.strictEqual(activitySignature(withCounts), activitySignature(base));
  assert.deepStrictEqual(findChangedActivities([withCounts], [base]), { changed: [], added: [] });
  assert.deepStrictEqual(findChangedActivities([{ ...withCounts, kudos_count: 50 }], [withCounts]), { changed: [], added: [] });
});

test("athlete snapshots: only when numeric fields present, max one per day, capped", () => {
  const now = new Date("2026-03-01T10:00:00Z");
  assert.strictEqual(eb.athleteSnapshotFrom({ firstname: "x" }, now), null);
  assert.strictEqual(eb.athleteSnapshotFrom({ follower_count: 5 }, now), null);
  const snap = eb.athleteSnapshotFrom({ follower_count: 5, friend_count: 7 }, now);
  assert.deepStrictEqual(snap, { date: "2026-03-01", followers: 5, following: 7 });
  let list = eb.appendAthleteSnapshot([], snap);
  list = eb.appendAthleteSnapshot(list, { date: "2026-03-01", followers: 6, following: 7 });
  assert.deepStrictEqual(list, [{ date: "2026-03-01", followers: 6, following: 7 }]);
  list = eb.appendAthleteSnapshot(list, { date: "2026-03-02", followers: 6, following: 8 });
  assert.strictEqual(list.length, 2);
  assert.strictEqual(eb.appendAthleteSnapshot(list, { date: "2026-03-03", followers: 1, following: 1 }, 2).length, 2);
  assert.deepStrictEqual(eb.appendAthleteSnapshot(list, null), list);
});
