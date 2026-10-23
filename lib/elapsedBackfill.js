/* Pure helpers for the elapsed_time backfill (no Strava or filesystem access). */

function defaultElapsedBackfill() {
  return { nextPage: 1, completed: false, lastRunAt: null, pagesDone: 0, secondPass: false, lastError: null };
}

function hasElapsedTime(activity) {
  return Boolean(activity) && typeof activity.elapsed_time === "number" && Number.isFinite(activity.elapsed_time);
}

/* Fill elapsed_time on cached activities from a page of activities (raw Strava or mapped). Mutates `cached`.
   Only sets elapsed_time where it is missing/non-finite; never touches other fields. Returns how many were filled. */
function mergeElapsedTime(cached, pageItems) {
  const byId = new Map();
  for (const a of cached || []) byId.set(String(a.id), a);
  let filled = 0;
  for (const item of pageItems || []) {
    if (!item || !hasElapsedTime(item)) continue;
    const existing = byId.get(String(item.id));
    if (existing && !hasElapsedTime(existing)) {
      existing.elapsed_time = item.elapsed_time;
      filled += 1;
    }
  }
  return filled;
}

module.exports = { defaultElapsedBackfill, hasElapsedTime, mergeElapsedTime };
