const test = require("node:test");
const assert = require("node:assert/strict");

test("timeline selection defaults rental bikes off but honors explicit choices", async () => {
  const { isTimelineBikeSelected } = await import("../client/src/lib/bikeTimelineSelection.js");
  const rental = { gid: "r1", name: " Rental Bike " };
  const normal = { gid: "b1", name: "Road Bike" };
  assert.equal(isTimelineBikeSelected(rental, {}), false);
  assert.equal(isTimelineBikeSelected({ ...rental, name: "rental bike" }, {}), false);
  assert.equal(isTimelineBikeSelected(normal, {}), true);
  assert.equal(isTimelineBikeSelected(rental, { r1: true }), true);
  assert.equal(isTimelineBikeSelected(rental, { r1: false }), false);
  assert.equal(isTimelineBikeSelected(normal, { b1: false }), false);
  assert.equal(isTimelineBikeSelected({ ...rental, gid: "r2" }, { r1: true }), false);
});
