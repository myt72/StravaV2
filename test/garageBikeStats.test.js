const test = require("node:test");
const assert = require("node:assert/strict");
const { renderToStaticMarkup } = require("react-dom/server");
const React = require("react");
const path = require("node:path");

test("Garage bike stats link the longest ride to its activity", async () => {
  const { createServer } = await import("vite");
  const server = await createServer({
    configFile: path.join(__dirname, "../client/vite.config.mjs"),
    root: path.join(__dirname, "../client"),
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true }
  });
  try {
    const { BikeStats } = await server.ssrLoadModule("/src/views/Garage.jsx");
    const total = { distance: 3218.68, elevation: 0, count: 1, moving_time: 0, longest_ride: 1609.34, longest_ride_activity_id: "9007199254740993" };
    const render = overrides => renderToStaticMarkup(React.createElement(BikeStats, { total, gid: "b1", name: "Road", showLongestRide: true, ...overrides }));
    assert.match(render(), /href="#\/activities\?id=9007199254740993" aria-label="View longest ride for Road">1\.0 mi<\/a>/);
    assert.match(render({ total: { ...total, longest_ride_activity_id: null } }), /Longest ride: 1\.0 mi/);
    assert.match(render({ total: { ...total, longest_ride: 0, longest_ride_activity_id: null } }), /Longest ride: —/);
  } finally {
    await server.close();
  }
});
