const test = require("node:test");
const assert = require("node:assert");
const { defaultElapsedBackfill, hasElapsedTime, mergeElapsedTime } = require("../lib/elapsedBackfill");
const { findChangedActivities } = require("../lib/activitySync");

test("mergeElapsedTime fills missing elapsed_time matched by id", () => {
  const cached = [{ id: 1, name: "a" }, { id: 2, name: "b", elapsed_time: NaN }, { id: 3, name: "c" }];
  const filled = mergeElapsedTime(cached, [{ id: "1", elapsed_time: 100 }, { id: 2, elapsed_time: 0 }, { id: 99, elapsed_time: 5 }]);
  assert.strictEqual(filled, 2);
  assert.strictEqual(cached[0].elapsed_time, 100);
  assert.strictEqual(cached[1].elapsed_time, 0);
  assert.strictEqual(cached[2].elapsed_time, undefined);
});

test("mergeElapsedTime keeps existing values and other fields", () => {
  const cached = [{ id: 1, name: "keep", moving_time: 50, elapsed_time: 70 }, { id: 2, name: "keep2" }];
  mergeElapsedTime(cached, [{ id: 1, name: "new", moving_time: 1, elapsed_time: 999 }, { id: 2, name: "new", moving_time: 9, elapsed_time: 20 }]);
  assert.deepStrictEqual(cached[0], { id: 1, name: "keep", moving_time: 50, elapsed_time: 70 });
  assert.deepStrictEqual(cached[1], { id: 2, name: "keep2", elapsed_time: 20 });
});

test("mergeElapsedTime ignores page items without a finite elapsed_time", () => {
  const cached = [{ id: 1 }];
  assert.strictEqual(mergeElapsedTime(cached, [{ id: 1 }, { id: 1, elapsed_time: "5" }]), 0);
  assert.strictEqual(hasElapsedTime(cached[0]), false);
});

test("elapsedBackfill shape default", () => {
  assert.deepStrictEqual(defaultElapsedBackfill(), { nextPage: 1, completed: false, lastRunAt: null, pagesDone: 0, secondPass: false, lastError: null });
});

test("cached activities without elapsed_time are not treated as changed", () => {
  const base = { id: 1, name: "a", sport_type: "Ride", distance: 1, moving_time: 2, total_elevation_gain: 3, start_date: "2024-01-01", gear_id: "g" };
  const { changed, added } = findChangedActivities([{ ...base, elapsed_time: 10 }], [{ ...base }]);
  assert.strictEqual(changed.length, 0);
  assert.strictEqual(added.length, 0);
});

test("real changes and elapsed_time changes are still detected", () => {
  const base = { id: 1, name: "a", sport_type: "Ride", distance: 1, moving_time: 2, total_elevation_gain: 3, start_date: "2024-01-01", gear_id: "g" };
  assert.strictEqual(findChangedActivities([{ ...base, name: "b", elapsed_time: 10 }], [{ ...base }]).changed.length, 1);
  assert.strictEqual(findChangedActivities([{ ...base, elapsed_time: 11 }], [{ ...base, elapsed_time: 10 }]).changed.length, 1);
});
