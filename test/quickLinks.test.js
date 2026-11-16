const test = require("node:test");
const assert = require("node:assert/strict");
const { renderToStaticMarkup } = require("react-dom/server");
const React = require("react");
const path = require("node:path");

test("quick links render accessible external links and the requested thumbnails", async () => {
  const { createServer } = await import("vite");
  const server = await createServer({
    configFile: path.join(__dirname, "../client/vite.config.mjs"),
    root: path.join(__dirname, "../client"),
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true }
  });
  try {
    const { QuickLinks } = await server.ssrLoadModule("/src/components/Shell.jsx");
    const html = renderToStaticMarkup(React.createElement(QuickLinks));
    const links = [...html.matchAll(/<a\b[^>]*>.*?<\/a>/g)].map(match => match[0]);
    const expected = [
      ["Ride With GPS", "https://ridewithgps.com", "ridewithgps.svg"],
      ["Garmin Connect", "https://connectgarmin.com", "garminconnect.png"],
      ["VeloViewer", "https://veloviewer.com/athlete/72850/", "veloviewer.png"],
      ["Komoot", "https://www.komoot.com/", "Komoot.png"]
    ];
    assert.equal(links.length, expected.length);
    for (const [index, [name, url, image]] of expected.entries()) {
      assert.ok(links[index].includes(`href="${url}"`));
      assert.ok(links[index].includes(`title="${name}"`));
      assert.ok(links[index].includes(`aria-label="${name} (opens in a new tab)"`));
      assert.ok(links[index].includes('target="_blank" rel="noopener noreferrer"'));
      assert.ok(links[index].includes(`/quick-links/${image}`));
    }
  } finally {
    await server.close();
  }
});
