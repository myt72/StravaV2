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
  assert.deepStrictEqual(matrix.years, [2024, 2023]);
  assert.strictEqual(matrix.rows[0][2023], 1);
  assert.strictEqual(matrix.rows[0][2024], 2);

  const monthHighlights = analytics.buildMonthHighlights(rides, "distance");
  assert.strictEqual(monthHighlights.highlights.find(row => row.year === 2024).best.month, 1);
  assert.strictEqual(monthHighlights.rolling.length, 14);
  assert.strictEqual(monthHighlights.rolling[0].label, "Feb 2024");
  assert.strictEqual(monthHighlights.rolling[13].label, "Jan 2023");
  assert.deepStrictEqual(monthHighlights.highlights.map(row => row.year), [2024, 2023]);
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

test("bike type stats include hours and average speed", () => {
  const rows = analytics.buildBikeTypeStats([
    activity("2024-01-01T08:00:00", { bike_type: "road", distance: 1609.34 * 20, moving_time: 7200, total_elevation_gain: 100 }),
    activity("2024-01-02T08:00:00", { bike_type: "road", distance: 1609.34 * 10, moving_time: 3600, total_elevation_gain: 50 })
  ]);
  assert.strictEqual(rows[0].count, 2);
  assert.ok(Math.abs(rows[0].hours - 3) < 1e-9);
  assert.ok(Math.abs(rows[0].avgSpeed - 10) < 1e-9);
});

test("buildBikePrSegments lists distinct PR segments for one bike and honours exclusions", () => {
  const acts = [
    activity("2024-01-01T08:00:00", { id: 1, gear_id: "b1" }),
    activity("2024-02-01T08:00:00", { id: 2, gear_id: "b1" }),
    activity("2024-02-02T08:00:00", { id: 3, gear_id: "b2" })
  ];
  const eff = (id, name, rank, time, date) => ({ segment_id: id, segment_name: name, pr_rank: rank, elapsed_time: time, start_date: date });
  const segmentData = {
    1: [eff(10, "Hill", 1, 300, "2024-01-01T08:10:00"), eff(11, "Flat", 2, 100, "2024-01-01T08:20:00"), eff(12, "Skip", 1, 90, "2024-01-01T08:30:00")],
    2: [eff(10, "Hill", 1, 280, "2024-02-01T08:10:00")],
    3: [eff(13, "Other bike", 1, 50, "2024-02-02T08:10:00")]
  };
  const rows = analytics.buildBikePrSegments(segmentData, acts, "b1", new Set(["12"]));
  assert.deepStrictEqual(rows.map(r => r.segmentId), ["10"]);
  assert.strictEqual(rows[0].count, 2);
  assert.strictEqual(rows[0].bestTime, 280);
  assert.strictEqual(rows[0].latestActivity.id, 2);
});

test("buildEverestStats reports yearly elevation in feet", () => {
  const stats = analytics.buildEverestStats([activity("2024-01-01T08:00:00", { total_elevation_gain: 1000 })]);
  assert.ok(Math.abs(stats.years[0].elevation - 3280.84) < 0.01);
  assert.ok(Math.abs(stats.years[0].everests - 3280.84 / 29031.7) < 1e-9);
});

const weekRides = dates => dates.map(d => activity(`${d}T08:00:00`, { distance: 1609.34 }));
const keys = dates => dates;

test("current week streak counts consecutive Monday-start weeks across a year boundary", () => {
  const r = analytics.computeCurrentWeekStreak(keys(["2024-12-26", "2025-01-02", "2025-01-08"]), new Date(2025, 0, 9));
  assert.deepStrictEqual(r, { length: 3, start: "2024-12-26", end: "2025-01-08" });
});

test("current week streak is broken by a gap", () => {
  const r = analytics.computeCurrentWeekStreak(keys(["2025-01-01", "2025-01-16", "2025-01-22"]), new Date(2025, 0, 23));
  assert.deepStrictEqual(r, { length: 2, start: "2025-01-16", end: "2025-01-22" });
});

test("current week streak survives an empty current week but not two", () => {
  const dates = keys(["2025-01-08", "2025-01-15"]);
  assert.strictEqual(analytics.computeCurrentWeekStreak(dates, new Date(2025, 0, 20)).length, 2);
  assert.strictEqual(analytics.computeCurrentWeekStreak(dates, new Date(2025, 0, 27)).length, 0);
  assert.strictEqual(analytics.computeCurrentWeekStreak([], new Date(2025, 0, 20)).length, 0);
});

test("current week streak handles a long streak (619 weeks)", () => {
  const dates = [];
  const start = new Date(2014, 11, 17);
  for (let i = 0; i < 619; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i * 7 - (i === 618 ? 2 : 0));
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  dates[618] = "2026-10-19";
  const r = analytics.computeCurrentWeekStreak(dates, new Date(2026, 9, 20));
  assert.strictEqual(r.length, 619);
  assert.strictEqual(r.start, "2014-12-17");
  assert.strictEqual(r.end, "2026-10-19");
});

test("weekly distance average uses 52/53 weeks for past years and elapsed weeks for the current year", () => {
  const rows = analytics.buildWeeklyDistanceAverages(
    weekRides(["2020-03-01", "2021-03-01", "2021-04-01", "2026-01-10"]),
    new Date(2026, 0, 15)
  );
  assert.deepStrictEqual(rows.map(r => r.year), [2026, 2021, 2020]);
  assert.strictEqual(rows[2].weeks, 53);
  assert.strictEqual(rows[1].weeks, 52);
  assert.ok(Math.abs(rows[1].average - 2 / 52) < 1e-9);
  assert.strictEqual(rows[0].weeks, 3);
  assert.strictEqual(rows[0].partial, true);
  assert.ok(Math.abs(rows[1].delta - (2 / 52 - 1 / 53)) < 1e-9);
  assert.strictEqual(rows[0].delta, null);
});

test("segment distance buckets include 10+, 15+ and 20+ miles", () => {
  const seg = (id, mi) => ({ segment_id: id, segment_name: `S${id}`, distance: mi * 1609.34, elevation_gain: 0 });
  const out = analytics.buildSegmentDistanceHighlights({
    activities: [{ id: 1, start_date: "2024-01-01T00:00:00" }, { id: 2, start_date: "2024-01-02T00:00:00" }],
    segmentData: { 1: [seg(1, 12), seg(2, 16), seg(3, 22)], 2: [seg(1, 12), seg(2, 16)] }
  }, new Set());
  const by = Object.fromEntries(out.map(b => [b.label, b]));
  assert.ok(!by["10+ mi"].empty);
  assert.strictEqual(by["15+ mi"].segmentId, "2");
  assert.strictEqual(by["20+ mi"].segmentId, "3");
  assert.ok(by["10+ mi"].attempts >= by["15+ mi"].attempts);
});
