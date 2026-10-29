const test = require("node:test");
const assert = require("node:assert");

let formatDurationHms;
let formatDurationGrouped;
test.before(async () => {
  ({ formatDurationHms, formatDurationGrouped } = await import("../client/src/lib/format.js"));
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

test("formatDurationGrouped inserts thousands separators into hours", () => {
  assert.strictEqual(formatDurationGrouped(999 * 3600), "999h");
  assert.strictEqual(formatDurationGrouped(1000 * 3600), "1,000h");
  assert.strictEqual(formatDurationGrouped(12345 * 3600 + 300), "12,345h 5m");
  assert.strictEqual(formatDurationGrouped(0), "0m");
  assert.strictEqual(formatDurationGrouped(1800), "30m");
  assert.strictEqual(formatDurationGrouped(undefined), "0m");
  assert.strictEqual(formatDurationGrouped("abc"), "0m");
});
