const test = require("node:test");
const assert = require("node:assert");
const { createBikeTypeResolver } = require("../lib/bikeTypes");

test("bike type lookup handles mapped, unmapped and loosely written ids", () => {
  const r = createBikeTypeResolver({ b111: "road", " B222 ": "hardtail", 333: "full-suspension" });
  assert.strictEqual(r.getBikeType("b111"), "road");
  assert.strictEqual(r.getBikeType("b999"), "unknown");
  assert.strictEqual(r.getBikeType(undefined), "unknown");
  assert.strictEqual(r.getBikeType("b222"), "hardtail");
  assert.strictEqual(r.getBikeType("b333"), "full-suspension");
  assert.deepStrictEqual(r.findUnmatched(["b111"]), ["b333", "b222"]);
});

test("cache written before bike_types existed gets types at response time", () => {
  const r = createBikeTypeResolver({ "1": "road" });
  const cache = {
    activities: [{ id: 1, gear_id: "b1" }, { id: 2, gear_id: "b2" }, { id: 3 }],
    gearDetails: { b1: { name: "Roadie" }, b2: { name: "Other" } }
  };
  const out = r.applyBikeTypes(cache);
  assert.deepStrictEqual(out.activities.map(a => a.bike_type), ["road", "unknown", "unknown"]);
  assert.strictEqual(out.activities[0].bike_name, "Roadie");
  assert.strictEqual(out.gearDetails.b1.bike_type, "road");
  assert.strictEqual(out.gearDetails.b2.bikeType, "unknown");
  assert.strictEqual(cache.activities[0].bike_type, undefined);
});
