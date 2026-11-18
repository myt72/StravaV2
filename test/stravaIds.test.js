const test = require("node:test");
const assert = require("node:assert");
const { stravaActivityId } = require("../lib/stravaIds");

test("prefers id_str and preserves large activity IDs exactly", () => {
  const id = "9223372036854775807";
  const activity = JSON.parse('{"id":9223372036854775807,"id_str":"9223372036854775807"}');
  assert.notStrictEqual(String(activity.id), id);
  assert.strictEqual(stravaActivityId(activity), id);
});

test("uses safe numeric IDs for older Strava responses", () => {
  assert.strictEqual(stravaActivityId({ id: 123456789 }), "123456789");
});

test("rejects unsafe numeric IDs when id_str is absent", () => {
  assert.throws(() => stravaActivityId({ id: Number.MAX_SAFE_INTEGER + 1 }), /id_str is required/);
});
