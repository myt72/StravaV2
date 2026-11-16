export function isPortableTouchDevice({ userAgent, platform, maxTouchPoints }) {
  return maxTouchPoints > 0 && !/CrOS/i.test(userAgent) && (
    /Android|iPhone|iPad|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1)
  );
}

export function swipeDirection(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.3 ? (dx < 0 ? 1 : -1) : 0;
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
