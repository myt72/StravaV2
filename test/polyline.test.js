const test = require("node:test");
const assert = require("node:assert");
const { decodePolyline, encodePolyline } = require("../lib/polyline");

test("decodes the reference Google example", () => {
  const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  assert.deepStrictEqual(pts, [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
});

test("round-trips and handles empty / malformed input", () => {
  const pts = [[51.50123, -0.14211], [51.50999, -0.12345], [51.4, -0.2]];
  assert.deepStrictEqual(decodePolyline(encodePolyline(pts)), pts);
  assert.deepStrictEqual(decodePolyline(""), []);
  assert.deepStrictEqual(decodePolyline(undefined), []);
  assert.deepStrictEqual(decodePolyline("_p~iF"), []);
});
