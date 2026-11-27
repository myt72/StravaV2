/**
 * Per-segment effort backfill. Strava's activity detail can omit some segment efforts, so this asks
 * GET /segment_efforts?segment_id=… for every effort the athlete has on a segment and merges the ones
 * missing from the cache. Pure helpers so the logic can be unit-tested without Strava.
 */

const FATAL_STATUSES = new Set([401, 402, 403]);
const PER_PAGE = 200;
const MAX_PAGES = 25;
const DEFAULT_MIN_TRIES = 2;

/**
 * Segments with cached Ride efforts as [{ id, name, tries, watched }]. Watched segments come first,
 * then the most-ridden. Unwatched segments need at least `minTries` cached efforts.
 */
function buildEffortCandidates(segmentData, activities, { watched = [], minTries = DEFAULT_MIN_TRIES } = {}) {
  const rides = new Set((activities || []).filter(a => a && a.sport_type === "Ride").map(a => String(a.id)));
  const watchedSet = new Set((watched || []).map(String));
  const map = new Map();
  Object.entries(segmentData || {}).forEach(([activityId, efforts]) => {
    if (!rides.has(String(activityId)) || !Array.isArray(efforts)) return;
    efforts.forEach(e => {
      if (!e || !e.segment_id) return;
      const id = String(e.segment_id);
      const row = map.get(id) || { id, name: e.segment_name || `Segment ${id}`, tries: 0, watched: watchedSet.has(id) };
      row.tries++;
      map.set(id, row);
    });
  });
  return [...map.values()]
    .filter(row => row.watched || row.tries >= minTries)
    .sort((a, b) => Number(b.watched) - Number(a.watched) || b.tries - a.tries || (a.id < b.id ? -1 : 1));
}

/** Candidates without a stored result. `refresh` re-checks everything. */
function selectEffortsToCheck(candidates, synced, { refresh = false } = {}) {
  return (candidates || []).filter(c => refresh || !synced || !synced[c.id] || !synced[c.id].checkedAt);
}

/**
 * Adds efforts that are not cached yet to segmentData[activityId]. Only activities already present in
 * segmentData are touched (a ride that was never fetched is left to the normal backfill so it is not
 * wrongly marked as done). An effort counts as already cached when segment id and start date match.
 * Returns { added, skipped } where skipped efforts belong to activities not in segmentData.
 */
function mergeSegmentEfforts(segmentData, efforts, normalize) {
  let added = 0;
  let skipped = 0;
  for (const effort of efforts || []) {
    const activityId = effort && effort.activity && effort.activity.id;
    const list = activityId != null ? segmentData[activityId] : null;
    if (!Array.isArray(list)) { skipped++; continue; }
    const normalized = normalize(effort);
    if (!normalized.segment_id) continue;
    const exists = list.some(e => String(e.segment_id) === String(normalized.segment_id) && e.start_date === normalized.start_date);
    if (exists) continue;
    list.push(normalized);
    added++;
  }
  return { added, skipped };
}

/**
 * Processes queued segments one at a time (each may take several pages). Stops on 429, on 401/402/403
 * and on any other non-OK response, recording nothing for the unfinished segment.
 * fetchPage(segmentId, page) -> { status, ok, json }
 * Returns { checked, added, stopped: null|"rate_limited"|"forbidden"|"error"|"cancelled", error }.
 */
async function runEffortBatch({ queue, segmentData, synced, fetchPage, normalize, canContinue = () => true, now = () => new Date() }) {
  let checked = 0;
  let added = 0;
  for (const candidate of queue) {
    const found = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (!canContinue()) return { checked, added, stopped: "cancelled", error: null };
      const res = await fetchPage(candidate.id, page);
      const status = res && res.status;
      if (status === 429) return { checked, added, stopped: "rate_limited", error: null };
      if (FATAL_STATUSES.has(status)) {
        return {
          checked, added, stopped: "forbidden",
          error: `Strava refused the segment effort request for segment ${candidate.id} (HTTP ${status}). A Strava subscription may be required for this endpoint; the backfill was stopped.`
        };
      }
      if (!res || !res.ok || !Array.isArray(res.json)) {
        return { checked, added, stopped: "error", error: `Segment effort request for segment ${candidate.id} failed (HTTP ${status ?? "unknown"}); the backfill was stopped.` };
      }
      found.push(...res.json);
      if (res.json.length < PER_PAGE) break;
    }
    const merged = mergeSegmentEfforts(segmentData, found, normalize);
    added += merged.added;
    synced[candidate.id] = { checkedAt: now().toISOString(), fetched: found.length, added: merged.added, skipped: merged.skipped };
    checked++;
  }
  return { checked, added, stopped: null, error: null };
}

module.exports = { PER_PAGE, DEFAULT_MIN_TRIES, buildEffortCandidates, selectEffortsToCheck, mergeSegmentEfforts, runEffortBatch };
