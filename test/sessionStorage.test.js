const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToString } = require("react-dom/server");

let storage;
test.before(async () => {
  storage = await import("../client/src/lib/storage.js");
});

test("session state restores list and segment-specific filters on remount", () => {
  const data = new Map();
  global.sessionStorage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value)
  };
  try {
    storage.writeSession("segments:tries", "25");
    storage.writeSession("segments:range", { minDist: "1", maxDist: "5", minMin: "", maxMin: "" });
    storage.writeSession("segment:123:bike", "b1");
    function Filters({ id }) {
      const [tries] = storage.useSessionState("segments:tries", "2");
      const [range] = storage.useSessionState("segments:range", { minDist: "" });
      const [bike] = storage.useSessionState(`segment:${id}:bike`, "all");
      return React.createElement("span", null, `${tries}:${range.minDist}:${bike}`);
    }
    assert.match(renderToString(React.createElement(Filters, { id: "123" })), /25:1:b1/);
    assert.match(renderToString(React.createElement(Filters, { id: "456" })), /25:1:all/);
    data.clear();
    assert.match(renderToString(React.createElement(Filters, { id: "123" })), /2::all/);
  } finally {
    delete global.sessionStorage;
  }
});

test("unavailable or invalid session storage falls back to defaults", () => {
  global.sessionStorage = { getItem: () => "{", setItem: () => { throw new Error("unavailable"); } };
  try {
    assert.equal(storage.readSession("segments:tries", "2"), "2");
    assert.doesNotThrow(() => storage.writeSession("segments:tries", "10"));
  } finally {
    delete global.sessionStorage;
  }
});
