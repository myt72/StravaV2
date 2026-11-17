export function isPortableTouchDevice({ userAgent, platform, maxTouchPoints }) {
  return maxTouchPoints > 0 && !/CrOS/i.test(userAgent) && (
    /Android|iPhone|iPad|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1)
  );
}

export async function requestVideoFullscreen(player, doc, userAgent) {
  const methods = [];
  const nativeFullscreen = player.webkitEnterFullscreen || player.webkitEnterFullScreen;
  if (/iPhone|iPod/i.test(userAgent) && nativeFullscreen) methods.push(nativeFullscreen);
  if (player.requestFullscreen && doc.fullscreenEnabled !== false) methods.push(player.requestFullscreen);
  if (player.webkitRequestFullscreen && doc.webkitFullscreenEnabled !== false) methods.push(player.webkitRequestFullscreen);
  if (!/iPhone|iPod/i.test(userAgent) && nativeFullscreen) methods.push(nativeFullscreen);

  for (const method of methods) {
    try {
      await method.call(player);
      return;
    } catch {
      // Another fullscreen API may be available on this device.
    }
  }
  throw new Error("Fullscreen unavailable");
}

export function listenForVideoFullscreenExit(player, doc, onExit) {
  let active = false;

  function fullscreenChange() {
    const fullscreenElement = doc.fullscreenElement || doc.webkitFullscreenElement;
    if (fullscreenElement === player) {
      active = true;
    } else if (active) {
      active = false;
      onExit();
    }
  }

  function nativeEnd() {
    active = false;
    onExit();
  }

  doc.addEventListener("fullscreenchange", fullscreenChange);
  doc.addEventListener("webkitfullscreenchange", fullscreenChange);
  player.addEventListener("webkitendfullscreen", nativeEnd);
  return () => {
    doc.removeEventListener("fullscreenchange", fullscreenChange);
    doc.removeEventListener("webkitfullscreenchange", fullscreenChange);
    player.removeEventListener("webkitendfullscreen", nativeEnd);
  };
}

export function swipeDirection(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.3 ? (dx < 0 ? 1 : -1) : 0;
}

export function listenForCoverSwipes(element, onSwipe) {
  let gesture = null;

  function start(event) {
    if (event.touches.length !== 1) {
      gesture = null;
      return;
    }
    const touch = event.touches[0];
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, axis: null };
  }

  function move(event) {
    if (!gesture || event.touches.length !== 1 || event.touches[0].identifier !== gesture.id) {
      gesture = null;
      return;
    }
    const touch = event.touches[0];
    const dx = Math.abs(touch.clientX - gesture.x);
    const dy = Math.abs(touch.clientY - gesture.y);
    if (!gesture.axis && Math.max(dx, dy) >= 8) {
      gesture.axis = dx > dy ? "horizontal" : "vertical";
    }
    if (gesture.axis === "horizontal" && event.cancelable) event.preventDefault();
  }

  function end(event) {
    if (!gesture) return;
    const touch = Array.from(event.changedTouches).find(item => item.identifier === gesture.id);
    if (touch && gesture.axis !== "vertical") {
      const direction = swipeDirection(gesture, { x: touch.clientX, y: touch.clientY });
      if (direction) {
        if (event.cancelable) event.preventDefault();
        onSwipe(direction);
      }
    }
    gesture = null;
  }

  function cancel() {
    gesture = null;
  }

  element.addEventListener("touchstart", start, { passive: true });
  element.addEventListener("touchmove", move, { passive: false });
  element.addEventListener("touchend", end, { passive: false });
  element.addEventListener("touchcancel", cancel);
  return () => {
    element.removeEventListener("touchstart", start);
    element.removeEventListener("touchmove", move);
    element.removeEventListener("touchend", end);
    element.removeEventListener("touchcancel", cancel);
  };
}

export async function fetchActivityVideos() {
  const res = await fetch("/dashboard/activity-videos.json", { cache: "no-store" });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Could not load activity videos (${res.status}).`);

  let items;
  try {
    items = await res.json();
  } catch {
    throw new Error("activity-videos.json is not valid JSON.");
  }
  if (!Array.isArray(items) || items.length > 10) {
    throw new Error("activity-videos.json must contain an array of at most 10 videos.");
  }
  return items.map((item, index) => {
    if (!item || typeof item.title !== "string" || !item.title.trim() ||
        typeof item.file !== "string" || !/^[^/\\\x00-\x1f]+\.mp4$/i.test(item.file)) {
      throw new Error(`Video ${index + 1} needs a title and an MP4 filename in public/videos.`);
    }
    const imageFile = item.file.replace(/\.mp4$/i, ".png");
    return {
      title: item.title.trim(),
      url: `/dashboard/videos/${encodeURIComponent(item.file)}`,
      imageUrl: `/dashboard/videos/${encodeURIComponent(imageFile)}`
    };
  });
}
