const test = require("node:test");
const assert = require("node:assert");
const pb = require("../lib/photoBackfill");
const eb = require("../lib/engagementBackfill");
const { activitySignature, findChangedActivities } = require("../lib/activitySync");

test("photoCountFromDetail prefers total_photo_count, then photos.count, then photo_count", () => {
  assert.strictEqual(pb.photoCountFromDetail({ photo_count: 0, total_photo_count: 7, photos: { count: 7 } }), 7);
  assert.strictEqual(pb.photoCountFromDetail({ photo_count: 0, photos: { count: 3 } }), 3);
  assert.strictEqual(pb.photoCountFromDetail({ photo_count: 2 }), 2);
  assert.strictEqual(pb.photoCountFromDetail({ total_photo_count: 0, photos: { count: 5 } }), 0);
});

test("photoCountFromDetail returns undefined when nothing valid is present", () => {
  assert.strictEqual(pb.photoCountFromDetail({}), undefined);
  assert.strictEqual(pb.photoCountFromDetail(null), undefined);
  assert.strictEqual(pb.photoCountFromDetail({ total_photo_count: null, photos: {} }), undefined);
});

test("pickNextBatch returns unverified activities newest first and skips verified", () => {
  const acts = [
    { id: 1, start_date: "2020-01-01T00:00:00Z" },
    { id: 2, start_date: "2022-01-01T00:00:00Z", photo_checked: true },
    { id: 3, start_date: "2021-01-01T00:00:00Z" },
    { id: 4, start_date: "2023-01-01T00:00:00Z" }
  ];
  assert.deepStrictEqual(pb.pickNextBatch(acts, 10).map(a => a.id), [4, 3, 1]);
  assert.deepStrictEqual(pb.pickNextBatch(acts, 2).map(a => a.id), [4, 3]);
  assert.deepStrictEqual(pb.pickRecent(acts, 3, { includeVerified: true }).map(a => a.id), [4, 2, 3]);
  assert.deepStrictEqual(pb.pickRecent(acts, 3).map(a => a.id), [4, 3]);
});

test("applyPhotoCount sets photo_count and marks verified; undefined leaves it unverified", () => {
  const a = { id: 1, photo_count: 0 };
  assert.strictEqual(pb.applyPhotoCount(a, 7), true);
  assert.strictEqual(a.photo_count, 7);
  assert.strictEqual(pb.needsPhotoCheck(a), false);
  const b = { id: 2 };
  assert.strictEqual(pb.applyPhotoCount(b, undefined), false);
  assert.deepStrictEqual(b, { id: 2 });
  assert.strictEqual(pb.needsPhotoCheck(b), true);
});

test("photoBackfillProgress counts verified activities", () => {
  assert.deepStrictEqual(pb.photoBackfillProgress([{ photo_checked: true }, {}, {}]), { checked: 1, total: 3, remaining: 2 });
});

test("verified counts survive a fresh list item and an engagement refresh", () => {
  const existing = { id: 1, photo_count: 7, photo_checked: true };
  const fresh = pb.carryPhotoCheck({ id: 1, photo_count: 0 }, existing);
  assert.deepStrictEqual(fresh, { id: 1, photo_count: 7, photo_checked: true });
  eb.mergeEngagement([existing], [{ id: 1, total_photo_count: 0 }], { overwrite: true });
  assert.strictEqual(existing.photo_count, 7);
});

test("photo fields do not affect activitySignature or findChangedActivities", () => {
  const base = { id: 1, name: "x", distance: 1, start_date: "2020-01-01T00:00:00Z", summary_polyline: "", elapsed_time: 5 };
  const verified = { ...base, photo_count: 4, photo_checked: true };
  assert.strictEqual(activitySignature(base), activitySignature(verified));
  assert.deepStrictEqual(findChangedActivities([base], [verified]).changed, []);
});
