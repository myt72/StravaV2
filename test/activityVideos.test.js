const test = require("node:test");
const assert = require("node:assert/strict");

test("activity video manifest resolves local MP4 filenames", async () => {
  const { fetchActivityVideos } = await import("../client/src/lib/activityVideos.js");
  const original = global.fetch;
  try {
    global.fetch = async (url, options) => {
      assert.equal(url, "/dashboard/activity-videos.json");
      assert.equal(options.cache, "no-store");
      return { ok: true, json: async () => [{ title: "  Ride  ", file: "my ride #1.MP4" }] };
    };
    assert.deepEqual(await fetchActivityVideos(), [
      { title: "Ride", url: "/dashboard/videos/my%20ride%20%231.MP4",
        imageUrl: "/dashboard/videos/my%20ride%20%231.png" }
    ]);

    global.fetch = async () => ({ status: 404 });
    assert.deepEqual(await fetchActivityVideos(), []);
    global.fetch = async () => ({ status: 500, ok: false });
    await assert.rejects(fetchActivityVideos(), /500/);
    global.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError(); } });
    await assert.rejects(fetchActivityVideos(), /not valid JSON/);
  } finally {
    global.fetch = original;
  }
});

test("activity video manifest rejects invalid entries and more than 10 videos", async () => {
  const { fetchActivityVideos } = await import("../client/src/lib/activityVideos.js");
  const original = global.fetch;
  try {
    for (const data of [
      {}, Array(11).fill({ title: "Ride", file: "ride.mp4" }),
      [{ title: "", file: "ride.mp4" }], [{ title: "Ride", file: "../ride.mp4" }],
      [{ title: "Ride", file: "C:\\ride.mp4" }], [{ title: "Ride", file: "ride.webm" }]
    ]) {
      global.fetch = async () => ({ ok: true, json: async () => data });
      await assert.rejects(fetchActivityVideos());
    }
  } finally {
    global.fetch = original;
  }
});
