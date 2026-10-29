const test = require("node:test");
const assert = require("node:assert");

let formatDurationHms;
test.before(async () => {
  ({ formatDurationHms } = await import("../client/src/lib/format.js"));
});

test("formatDurationHms shows seconds with the appropriate larger units", () => {
  assert.strictEqual(formatDurationHms(0), "0s");
  assert.strictEqual(formatDurationHms(45), "45s");
  assert.strictEqual(formatDurationHms(59.6), "1m 0s");
  assert.strictEqual(formatDurationHms(60), "1m 0s");
  assert.strictEqual(formatDurationHms(242), "4m 2s");
  assert.strictEqual(formatDurationHms(3599), "59m 59s");
  assert.strictEqual(formatDurationHms(3600), "1h 0m 0s");
  assert.strictEqual(formatDurationHms(3725), "1h 2m 5s");
});

test("formatDurationHms uses an em dash for invalid durations", () => {
  assert.strictEqual(formatDurationHms(null), "—");
  assert.strictEqual(formatDurationHms(Number.NaN), "—");
  assert.strictEqual(formatDurationHms(Number.POSITIVE_INFINITY), "—");
  assert.strictEqual(formatDurationHms(-1), "—");
});
