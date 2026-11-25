const test = require("node:test");
const assert = require("node:assert/strict");

let bestSegmentAttemptsByYear, buildSegmentAttempts, filterSegmentAttempts, applyGlobalFilters;
test.before(async () => {
  ({ bestSegmentAttemptsByYear, buildSegmentAttempts, filterSegmentAttempts, applyGlobalFilters } = await import("../client/src/lib/analytics.js"));
});

test("segment detail starts with all cached attempts and combines independent filters", () => {
  const activities = [
    { id: "1", sport_type: "Ride", gear_id: "b1", start_date: "2024-01-01T10:00:00" },
    { id: "2", sport_type: "Ride", gear_id: "b2", start_date: "2023-01-02T10:00:00" },
    { id: "3", sport_type: "Ride", start_date: "2024-01-02T10:00:00" }
  ];
  const segmentData = {
    "1": [{ segment_id: 1, elapsed_time: 60 }, { segment_id: 2 }],
    "2": [{ segment_id: 1, elapsed_time: 70 }],
    "3": [{ segment_id: 1, elapsed_time: 80 }]
  };
  const filtered = applyGlobalFilters({ activities, segmentData }, { dateRange: "all", activityType: "all", bike: "b1" });
  assert.equal(buildSegmentAttempts(segmentData, filtered.activities)[0].attempts.length, 1);
  const rows = buildSegmentAttempts(segmentData, activities, null, { segmentId: "1" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].attempts.length, 3);
  assert.equal(filterSegmentAttempts(rows[0].attempts).length, 3);
  assert.deepEqual(filterSegmentAttempts(rows[0].attempts, { bike: "b2", year: "2023", weekday: "0" }).map(a => a.activity.id), ["2"]);
  assert.equal(filterSegmentAttempts(rows[0].attempts, { bike: "b2", year: "2024" }).length, 0);
  assert.deepEqual(filterSegmentAttempts(rows[0].attempts, { bike: "none", weekday: "1" }).map(a => a.activity.id), ["3"]);
  assert.deepEqual(buildSegmentAttempts(segmentData, activities, null, { segmentId: "404" }), []);
});

test("segment attempts count every effort, join filtered bikes, and respect exclusions", () => {
  const activities = [
    { id: "9007199254740993", sport_type: "Ride", gear_id: "b1", start_date: "2024-01-01T10:00:00" },
    { id: "2", sport_type: "Ride", gear_id: "b2", start_date: "2023-12-31T10:00:00" }
  ];
  const segmentData = {
    "9007199254740993": [
      { segment_id: 1, segment_name: "Hill", start_date: "2024-01-01T10:10:00", elapsed_time: 80 },
      { segment_id: 1, segment_name: "Hill", start_date: "2024-01-01T10:20:00", elapsed_time: 65 },
      { segment_id: 2, segment_name: "Excluded", elapsed_time: 20 }
    ],
    "2": [{ segment_id: 1, segment_name: "Hill", elapsed_time: 50 }],
    "orphan": [{ segment_id: 3, segment_name: "Orphan" }]
  };
  const rows = buildSegmentAttempts(segmentData, activities, new Set(["2"]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].attempts.length, 3);
  assert.equal(rows[0].bestTime, 50);
  assert.equal(rows[0].lastDate, "2024-01-01T10:20:00");
  assert.equal(new Set(rows[0].attempts.map(a => a.key)).size, 3);

  const filtered = applyGlobalFilters({ activities, segmentData }, { dateRange: "all", activityType: "all", bike: "b1" });
  const bikeRows = buildSegmentAttempts(segmentData, filtered.activities, new Set(["2"]));
  assert.equal(bikeRows[0].attempts.length, 2);
  assert.equal(bikeRows[0].bestTime, 65);
});

test("year and weekday apply to effort date, including missing and invalid dates", () => {
  const activities = [
    { id: "1", start_date: "2023-12-31T10:00:00" },
    { id: "2", start_date: "2024-01-02T10:00:00" },
    { id: "3", start_date: null }
  ];
  const data = {
    "1": [{ segment_id: 1, start_date: "2024-01-01T10:00:00", elapsed_time: 0 }],
    "2": [{ segment_id: 1, elapsed_time: 20 }],
    "3": [{ segment_id: 1, start_date: "invalid", elapsed_time: 30 }]
  };
  assert.equal(buildSegmentAttempts(data, activities)[0].attempts.length, 3);
  const monday = buildSegmentAttempts(data, activities, null, { year: "2024", weekday: "0" });
  assert.equal(monday[0].attempts.length, 1);
  assert.equal(monday[0].attempts[0].activity.id, "1");
  assert.equal(monday[0].bestTime, null);
  assert.equal(buildSegmentAttempts(data, activities, null, { year: "2023" }).length, 0);
});

test("yearly bests choose the fastest matching attempt and preserve its bike and activity", () => {
  const activities = [
    { id: "1", gear_id: "b1", start_date: "2026-03-01T10:00:00" },
    { id: "2", gear_id: "b2", start_date: "2026-04-01T10:00:00" },
    { id: "3", gear_id: "b1", start_date: "2025-03-01T10:00:00" },
    { id: "4", start_date: null }
  ];
  const data = {
    "1": [{ segment_id: 1, elapsed_time: 80 }, { segment_id: 1, elapsed_time: 70 }],
    "2": [{ segment_id: 1, elapsed_time: 60 }],
    "3": [{ segment_id: 1, elapsed_time: 90 }],
    "4": [{ segment_id: 1, elapsed_time: 10 }, { segment_id: 1, start_date: "invalid", elapsed_time: 5 }, { segment_id: 1, start_date: "2024-01-01T10:00:00", elapsed_time: 0 }]
  };
  const attempts = buildSegmentAttempts(data, activities)[0].attempts;
  const bests = bestSegmentAttemptsByYear(attempts);
  assert.deepEqual(bests.map(({ year, attempt }) => [year, attempt.elapsed, attempt.activity.id, attempt.activity.gear_id]), [
    [2026, 60, "2", "b2"], [2025, 90, "3", "b1"]
  ]);
  const bikeBests = bestSegmentAttemptsByYear(filterSegmentAttempts(attempts, { bike: "b1" }));
  assert.deepEqual(bikeBests.map(({ year, attempt }) => [year, attempt.elapsed]), [[2026, 70], [2025, 90]]);
  assert.deepEqual(bestSegmentAttemptsByYear(filterSegmentAttempts(attempts, { year: "2024" })), []);
});
