const test = require("node:test");
const assert = require("node:assert");

let analytics;
test.before(async () => {
  analytics = await import("../client/src/lib/analytics.js");
});

const activity = (start_date, extra = {}) => ({
  start_date,
  sport_type: "Ride",
  distance: 0,
  moving_time: 0,
  total_elevation_gain: 0,
  ...extra
});

test("bike type comparison aggregates Ride activities", () => {
  const rides = [
    activity("2024-01-10T08:00:00", { bike_type: "road", bike_name: "Road bike", distance: 1609.34, moving_time: 3600 }),
    activity("2024-01-20T08:00:00", { bike_type: "road", bike_name: "Road bike", distance: 3218.68, moving_time: 7200 }),
    activity("2024-02-02T08:00:00", { bike_type: "mountain", bike_name: "Trail bike", distance: 1609.34, moving_time: 1800 }),
    activity("2024-02-03T08:00:00", { sport_type: "Run", bike_type: "road", bike_name: "Road bike", distance: 10000 })
  ];

  const types = analytics.buildBikeTypeStats(rides);
  assert.deepStrictEqual(types.map(row => [row.type, row.count]), [["road", 2], ["mountain", 1]]);
  assert.ok(Math.abs(types[0].distance - 4828.02) < 0.001);
  assert.ok(Math.abs(types[1].distance - 1609.34) < 0.001);
  assert.deepStrictEqual(types[0].names, ["Road bike"]);
});

test("consistency and weekly ramp summarize ride streaks and flagged increases", () => {
  const rides = [
    ...["2024-01-01", "2024-01-02", "2024-01-03"].map(date => activity(`${date}T08:00:00`, { distance: 10000 })),
    ...["2024-01-08", "2024-01-09", "2024-01-10"].map(date => activity(`${date}T08:00:00`, { distance: 13000 }))
  ];

  const consistency = analytics.buildConsistencyStats(rides);
  assert.strictEqual(consistency.longestDayStreak, 3);
  assert.strictEqual(consistency.longestWeekStreak, 2);
  assert.strictEqual(consistency.years[0].weeksMeetingThreshold, 2);

  const ramp = analytics.buildWeeklyRamp(rides, "distance", new Date("2024-01-08T12:00:00"));
  assert.strictEqual(ramp.length, 2);
  assert.strictEqual(ramp[0].warning, false);
  assert.strictEqual(ramp[1].warning, true);
});

test("Everest and milestone summaries convert climbing and lifetime mileage", () => {
  const rides = [
    activity("2024-01-01T08:00:00", { distance: 1609340, total_elevation_gain: 1000 }),
    activity("2024-01-02T08:00:00", { distance: 1610, total_elevation_gain: 500 })
  ];

  const everest = analytics.buildEverestStats(rides);
  assert.ok(Math.abs(everest.years[0].elevation - 4921.26) < 0.01);
  assert.ok(Math.abs(everest.lifetime - 4921.26 / 29031.7) < 0.0001);

  const milestones = analytics.buildMileageMilestones(rides, new Date("2025-01-01T00:00:00"));
  assert.strictEqual(milestones.achieved.length, 1);
  assert.strictEqual(milestones.achieved[0].target, 1000);
});

test("month/year patterns and ride-timing summaries aggregate by local date", () => {
  const rides = [
    activity("2023-01-02T07:00:00", { distance: 1609.34 }),
    activity("2024-01-02T07:00:00", { distance: 3218.68 }),
    activity("2024-02-03T18:00:00", { distance: 1609.34 })
  ];

  const matrix = analytics.buildMonthYearMatrix(rides, "distance");
  assert.deepStrictEqual(matrix.years, [2023, 2024]);
  assert.strictEqual(matrix.rows[0][2023], 1);
  assert.strictEqual(matrix.rows[0][2024], 2);

  const monthHighlights = analytics.buildMonthHighlights(rides, "distance");
  assert.strictEqual(monthHighlights.highlights.find(row => row.year === 2024).best.month, 1);
  assert.strictEqual(monthHighlights.rolling.length, 14);

  const hourly = analytics.buildHourlyWeekdayMatrix(rides);
  assert.strictEqual(hourly[0].values[7], 1);
  assert.strictEqual(hourly[1].values[7], 1);
  assert.strictEqual(hourly[5].values[18], 1);
  assert.strictEqual(analytics.buildSeasonalityIndex(rides, "count").length, 12);
});

test("unmapped bikes are listed with gear ids and names", () => {
  const rides = [
    activity("2024-01-01T08:00:00", { gear_id: "b1", bike_type: "road", bike_name: "Road" }),
    activity("2024-01-02T08:00:00", { gear_id: "b2", bike_type: "unknown", bike_name: "Gravel" }),
    activity("2024-01-03T08:00:00", { gear_id: "b2", bike_type: "unknown", bike_name: "Gravel" })
  ];
  assert.deepStrictEqual(analytics.buildUnmappedBikes(rides), [{ gear_id: "b2", name: "Gravel" }]);
});

test("formatHms pads minutes/seconds and does not cap hours", async () => {
  const { formatHms } = await import("../client/src/lib/format.js");
  assert.strictEqual(formatHms(123 * 3600 + 5 * 60 + 9), "123:05:09");
  assert.strictEqual(formatHms(3600), "1:00:00");
  assert.strictEqual(formatHms(0), "0:00:00");
});

test("buildBikeSummaryRows aggregates per bike with totals", () => {
  const { rows, total } = analytics.buildBikeSummaryRows(
    {
      b1: { distance: 1609.34 * 20, elevation: 1000, count: 2, moving_time: 7200, pr_count: 3 },
      b2: { distance: 1609.34 * 10, elevation: 500, count: 1, moving_time: 3600, pr_count: 1 }
    },
    { b1: { name: "Road" } },
    gid => gid === "b2"
  );
  assert.strictEqual(rows[0].name, "Road");
  assert.strictEqual(rows[1].name, "b2");
  assert.strictEqual(rows[1].retired, true);
  assert.ok(Math.abs(rows[0].avgDistance - 10) < 1e-9);
  assert.ok(Math.abs(rows[0].avgSpeed - 10) < 1e-9);
  assert.strictEqual(total.count, 3);
  assert.strictEqual(total.prs, 4);
  assert.ok(Math.abs(total.distance - 30) < 1e-9);
  assert.strictEqual(total.time, 10800);
  assert.strictEqual(total.avgTime, 3600);
});

test("milestones list upcoming targets and drop absurd projections", () => {
  const now = new Date("2025-01-01T00:00:00");
  const slow = [activity("2024-12-31T08:00:00", { distance: 1609.34 * 1100 })];
  const m = analytics.buildMileageMilestones(slow, now);
  assert.deepStrictEqual(m.achieved.map(x => x.target), [1000]);
  assert.strictEqual(m.upcomingList[0].target, 2500);
  assert.strictEqual(m.upcomingList[m.upcomingList.length - 1].target, 45000);
  const none = analytics.buildMileageMilestones(
    [activity("2020-01-01T08:00:00", { distance: 1609.34 * 1100 })], now);
  assert.ok(none.upcomingList.every(x => x.date === null));
  assert.strictEqual(none.upcoming, null);
});
