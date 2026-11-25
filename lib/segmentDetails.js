/**
 * Segment details (min/max elevation, max grade, shape) fetched once per segment from Strava's
 * GET /segments/{id}. Pure helpers so the logic can be unit-tested without Strava.
 */

const FATAL_STATUSES = new Set([401, 402, 403]);

const num = value => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Distinct segments with a cached effort on a Ride, as [{ id, name }] sorted by id. */
function buildDetailCandidates(segmentData, activities) {
  const rides = new Set((activities || []).filter(a => a && a.sport_type === "Ride").map(a => String(a.id)));
  const map = new Map();
  Object.entries(segmentData || {}).forEach(([activityId, efforts]) => {
    if (!rides.has(String(activityId)) || !Array.isArray(efforts)) return;
    efforts.forEach(e => {
      if (!e || !e.segment_id) return;
      const id = String(e.segment_id);
      if (!map.has(id)) map.set(id, { id, name: e.segment_name || `Segment ${id}` });
    });
  });
  return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Candidates without a stored result. `refresh` re-fetches everything. */
function selectDetailsToFetch(candidates, details, { refresh = false } = {}) {
  return (candidates || []).filter(c => refresh || !details || !details[c.id] || !details[c.id].checkedAt);
}

/** Keeps only the fields the app uses; the polyline is the segment's full-resolution shape. */
function normalizeSegmentDetail(json, checkedAt) {
  const polyline = json && json.map && typeof json.map.polyline === "string" ? json.map.polyline : null;
  return {
    checkedAt,
    distance: num(json && json.distance),
    average_grade: num(json && json.average_grade),
    maximum_grade: num(json && json.maximum_grade),
    elevation_high: num(json && json.elevation_high),
    elevation_low: num(json && json.elevation_low),
    polyline: polyline || null
  };
}

/**
 * Fetches queued segments one request at a time, writing results into `details`.
 * Stops (recording nothing for the unprocessed segment) on 429, on 401/402/403 and on any other non-OK response,
 * so a failing endpoint is never retried in a loop. A 404 (deleted/private segment) is recorded as `missing`.
 * fetchDetail(segmentId) -> { status, ok, json }
 * Returns { checked, stopped: null|"rate_limited"|"forbidden"|"error"|"cancelled", error }.
 */
async function runDetailBatch({ queue, details, fetchDetail, canContinue = () => true, now = () => new Date() }) {
  let checked = 0;
  for (const candidate of queue) {
    if (!canContinue()) return { checked, stopped: "cancelled", error: null };
    const res = await fetchDetail(candidate.id);
    const status = res && res.status;
    if (status === 429) return { checked, stopped: "rate_limited", error: null };
    if (FATAL_STATUSES.has(status)) {
      return {
        checked, stopped: "forbidden",
        error: `Strava refused the segment request for segment ${candidate.id} (HTTP ${status}); the backfill was stopped.`
      };
    }
    const checkedAt = now().toISOString();
    if (status === 404) {
      details[candidate.id] = { checkedAt, missing: true };
      checked++;
      continue;
    }
    if (!res || !res.ok) {
      return { checked, stopped: "error", error: `Segment request for segment ${candidate.id} failed (HTTP ${status ?? "unknown"}); the backfill was stopped.` };
    }
    details[candidate.id] = normalizeSegmentDetail(res.json, checkedAt);
    checked++;
  }
  return { checked, stopped: null, error: null };
}

module.exports = { buildDetailCandidates, selectDetailsToFetch, normalizeSegmentDetail, runDetailBatch };
