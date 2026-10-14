const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { encodePolyline } = require("../lib/polyline");
const routeMatching = require("../lib/routeMatching");
const calibration = require("../scripts/routeCalibration");

const ROOT = path.resolve(__dirname, "..");
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "calibration", "fixtures.json"), "utf8"));

function activity(id, points, extra = {}) {
  return {
    id: String(id),
    sport_type: "Ride",
    name: `Ride ${id}`,
    start_date: "2024-01-01T10:00:00Z",
    distance: 10000,
    summary_polyline: encodePolyline(points),
    start_latlng: points[0],
    end_latlng: points[points.length - 1],
    ...extra
  };
}

test("calibration seed schema validates committed fixtures and defaults optional fields", () => {
  const committed = JSON.parse(fs.readFileSync(path.join(ROOT, "calibration", "seeds.json"), "utf8"));
  const checked = calibration.validateSeeds(committed);
  assert.equal(checked.valid, true);
  assert.deepEqual(checked.seeds.map(seed => seed.expectedCount), [20, 40, 102, 40]);
  const defaults = calibration.validateSeeds([{ activityId: 123, expectedCount: 1 }]);
  assert.equal(defaults.seeds[0].includesSelf, true);
  assert.deepEqual(defaults.seeds[0].expectedMatchedIds, []);
  assert.equal(calibration.validateSeeds([{ activityId: "bad", expectedCount: -1 }]).valid, false);
  const dated = calibration.validateSeeds([{
    activityId: "123", expectedCount: 1, expectedMatchedIds: ["2024-01-01"]
  }]);
  assert.equal(dated.valid, true);
  assert.deepEqual(calibration.resolveActivityIds(["2024-01-01"], [
    { id: "123", start_date: "2024-01-01T10:00:00Z" },
    { id: "124", start_date: "2024-01-02T10:00:00Z" }
  ]), ["123"]);
});

test("precision/recall scoring and matched counts support both self interpretations", () => {
  const score = calibration.scoreMatchedIds(["1", "2", "4"], ["1", "2", "3"]);
  assert.equal(score.precision, 2 / 3);
  assert.equal(score.recall, 2 / 3);
  assert.equal(score.f1, 2 / 3);
  assert.deepEqual(score.missed, ["3"]);
  assert.deepEqual(score.extra, ["4"]);

  const includesSelf = calibration.countInterpretations(["10", "11"], {
    activityId: "10", expectedCount: 2, includesSelf: true
  });
  assert.deepEqual(includesSelf, {
    withSelf: { actual: 2, expected: 2, delta: 0 },
    withoutSelf: { actual: 1, expected: 1, delta: 0 }
  });
  const excludesSelf = calibration.countInterpretations(["10", "11"], {
    activityId: "10", expectedCount: 1, includesSelf: false
  });
  assert.equal(excludesSelf.withSelf.expected, 2);
  assert.equal(excludesSelf.withoutSelf.expected, 1);
});

test("sweep ranking prefers absolute count error, then F1", () => {
  const ranked = calibration.rankSweep([
    { config: { id: "error" }, totalAbsoluteError: 2, meanF1: 1 },
    { config: { id: "f1" }, totalAbsoluteError: 0, meanF1: 0.5 },
    { config: { id: "tie" }, totalAbsoluteError: 0, meanF1: 0.9 }
  ]);
  assert.deepEqual(ranked.map(row => row.config.id), ["tie", "f1", "error"]);
  assert.equal(calibration.buildSweepGrid().length, 128);
});

test("route-matching config is exported and validates bounded overrides", () => {
  assert.equal(routeMatching.DEFAULT_MATCH_CONFIG, routeMatching.DEFAULTS);
  assert.deepEqual(routeMatching.validateMatchConfig({ START_END_RADIUS_M: 200, ALLOW_REVERSE: true }), {
    START_END_RADIUS_M: 200,
    ALLOW_REVERSE: true
  });
  assert.throws(() => routeMatching.validateMatchConfig({ START_END_RADIUS_M: 2000 }), /between 10 and 1000/);
  assert.throws(() => routeMatching.validateMatchConfig({ ALLOW_REVERSE: "yes" }), /boolean/);
});

test("synthetic GPS fixture routes exercise matching directions and route shapes", () => {
  const { noisySameRoute, reversedRoute, differentRouteSameStart, loopVsOutAndBack } = fixture;
  const a = routeMatching.prepareRide(activity(1, noisySameRoute.reference));
  const noisy = routeMatching.prepareRide(activity(2, noisySameRoute.variant));
  assert.equal(routeMatching.compareRoutes(a, noisy).match, true);

  const reversed = routeMatching.prepareRide(activity(3, reversedRoute.variant));
  const reverseResult = routeMatching.compareRoutes(
    routeMatching.prepareRide(activity(4, reversedRoute.reference)),
    reversed
  );
  assert.equal(reverseResult.direction, "reverse");
  assert.equal(reverseResult.match, false);
  assert.equal(routeMatching.compareRoutes(
    routeMatching.prepareRide(activity(4, reversedRoute.reference)),
    reversed,
    { ALLOW_REVERSE: true }
  ).match, true);

  assert.equal(routeMatching.compareRoutes(
    routeMatching.prepareRide(activity(5, differentRouteSameStart.reference)),
    routeMatching.prepareRide(activity(6, differentRouteSameStart.variant))
  ).match, false);
  assert.equal(routeMatching.compareRoutes(
    routeMatching.prepareRide(activity(7, loopVsOutAndBack.loop)),
    routeMatching.prepareRide(activity(8, loopVsOutAndBack.outAndBack))
  ).match, false);
});

test("seed analysis reports count interpretations, funnel, and direction-specific candidates", () => {
  const { noisySameRoute, reversedRoute } = fixture;
  const activities = [
    activity("100", noisySameRoute.reference),
    activity("101", noisySameRoute.variant),
    activity("102", reversedRoute.variant)
  ];
  const seed = {
    activityId: "100",
    expectedCount: 2,
    includesSelf: true,
    expectedMatchedIds: ["100", "101"],
    notMatchedIds: ["102"]
  };
  const cache = { activities, segmentData: {} };
  const result = calibration.analyzeSeed(seed, cache);
  assert.equal(result.counts.withSelf.actual, 2);
  assert.equal(result.counts.withoutSelf.actual, 1);
  assert.equal(result.counts.withSelf.delta, 0);
  assert.equal(result.listScore.precision, 1);
  assert.equal(result.listScore.recall, 1);
  assert.ok(result.funnel.startFinish >= result.funnel.distance);
  assert.equal(result.reverseDirection.length, 1);
  assert.equal(result.reverseDirection[0].id, "102");
  assert.equal(result.reverseDirection[0].match, false);

  const permissive = calibration.analyzeSeed(seed, cache, { ALLOW_REVERSE: true });
  assert.equal(permissive.listScore.knownNotMatched.length, 1);
  assert.equal(permissive.listScore.extraRides[0].id, "102");
});

test("seed analysis gives actionable guidance when geo backfill fields are absent", () => {
  const result = calibration.analyzeSeed(
    { activityId: "100", expectedCount: 1, includesSelf: true },
    { activities: [{ id: "100", sport_type: "Ride" }], segmentData: {} }
  );
  assert.match(result.skipped, /run the geo backfill/i);
});
