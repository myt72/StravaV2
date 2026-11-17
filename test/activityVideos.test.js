const test = require("node:test");
const assert = require("node:assert/strict");

test("portable fullscreen detection excludes desktop and touch laptops", async () => {
  const { isPortableTouchDevice } = await import("../client/src/lib/activityVideos.js");
  assert.equal(isPortableTouchDevice({ userAgent: "Mozilla/5.0 (Linux; Android 14)", platform: "Linux", maxTouchPoints: 5 }), true);
  assert.equal(isPortableTouchDevice({ userAgent: "Mozilla/5.0 (iPhone)", platform: "iPhone", maxTouchPoints: 5 }), true);
  assert.equal(isPortableTouchDevice({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 5 }), true);
  assert.equal(isPortableTouchDevice({ userAgent: "Mozilla/5.0 (Windows NT 10.0)", platform: "Win32", maxTouchPoints: 10 }), false);
  assert.equal(isPortableTouchDevice({ userAgent: "Mozilla/5.0 (X11; CrOS x86_64) Android", platform: "Linux", maxTouchPoints: 10 }), false);
  assert.equal(isPortableTouchDevice({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 0 }), false);
});

test("horizontal cover swipes select the next or previous item", async () => {
  const { swipeDirection } = await import("../client/src/lib/activityVideos.js");
  assert.equal(swipeDirection({ x: 100, y: 100 }, { x: 35, y: 115 }), 1);
  assert.equal(swipeDirection({ x: 100, y: 100 }, { x: 165, y: 115 }), -1);
  assert.equal(swipeDirection({ x: 100, y: 100 }, { x: 60, y: 100 }), 0);
  assert.equal(swipeDirection({ x: 100, y: 100 }, { x: 25, y: 180 }), 0);
});

test("cover touch gestures navigate without blocking taps or vertical scrolling", async () => {
  const { listenForCoverSwipes } = await import("../client/src/lib/activityVideos.js");
  const cover = new EventTarget();
  const directions = [];
  const cleanup = listenForCoverSwipes(cover, direction => directions.push(direction));
  const point = (x, y, identifier = 1) => ({ clientX: x, clientY: y, identifier });
  function touch(type, touches, changedTouches = touches) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { touches, changedTouches });
    cover.dispatchEvent(event);
    return event.defaultPrevented;
  }

  touch("touchstart", [point(100, 100)]);
  assert.equal(touch("touchmove", [point(90, 102)]), true);
  assert.equal(touch("touchend", [], [point(35, 115)]), true);
  assert.deepEqual(directions, [1]);

  touch("touchstart", [point(100, 100)]);
  assert.equal(touch("touchmove", [point(110, 102)]), true);
  touch("touchend", [], [point(165, 115)]);
  assert.deepEqual(directions, [1, -1]);

  touch("touchstart", [point(100, 100)]);
  assert.equal(touch("touchmove", [point(102, 120)]), false);
  assert.equal(touch("touchend", [], [point(35, 115)]), false);
  touch("touchstart", [point(100, 100)]);
  assert.equal(touch("touchend", [], [point(102, 101)]), false);
  assert.deepEqual(directions, [1, -1]);

  touch("touchstart", [point(100, 100)]);
  touch("touchstart", [point(100, 100), point(110, 100, 2)]);
  touch("touchend", [], [point(35, 100)]);
  touch("touchstart", [point(100, 100)]);
  touch("touchcancel", [], [point(100, 100)]);
  touch("touchend", [], [point(35, 100)]);
  cleanup();
  touch("touchstart", [point(100, 100)]);
  touch("touchend", [], [point(35, 100)]);
  assert.deepEqual(directions, [1, -1]);
});

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
