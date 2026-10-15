/**
 * Segment leaderboard ranks (KOM / 2nd / 3rd). Pure helpers so the logic can be unit-tested without Strava.
 *
 * Strava's SegmentLeaderboardEntry documents: athlete_name, elapsed_time, moving_time, start_date,
 * start_date_local, rank. Older/undocumented payloads may also carry activity_id / effort_id; both are used
 * when present, otherwise the athlete's entry is found by start_date + elapsed_time of their best effort.
 */

const TOP_RANKS = [1, 2, 3];
const FATAL_STATUSES = new Set([401, 402, 403]);
const DEFAULT_MAX_AGE_DAYS = 7;
const DAY_MS = 86400000;

const ts = value => {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
};

/**
 * Segments where the athlete has at least one cached PR effort (pr_rank === 1) on a Ride. Current rank 1-3
 * requires the athlete's best effort to be a PR, so nothing else needs a leaderboard request.
 * Returns an array of { id, name, activityIds, bestEfforts, lastPrDate } sorted by id.
 */
function buildRankCandidates(segmentData, activities) {
  const rides = new Set((activities || []).filter(a => a && a.sport_type === "Ride").map(a => String(a.id)));
  const map = new Map();
  Object.entries(segmentData || {}).forEach(([activityId, efforts]) => {
    if (!rides.has(String(activityId)) || !Array.isArray(efforts)) return;
    efforts.forEach(e => {
      if (!e || !e.segment_id) return;
      const id = String(e.segment_id);
      let c = map.get(id);
      if (!c) {
        c = { id, name: e.segment_name || `Segment ${id}`, activityIds: new Set(), efforts: [], hasPr: false, lastPrDate: null };
        map.set(id, c);
      }
      c.activityIds.add(String(activityId));
      c.efforts.push({ activityId: String(activityId), start: ts(e.start_date), elapsed: Number(e.elapsed_time) || 0 });
      if (e.pr_rank === 1) {
        c.hasPr = true;
        const t = ts(e.start_date);
        if (t != null && (c.lastPrDate == null || t > c.lastPrDate)) c.lastPrDate = t;
      }
    });
  });
  return [...map.values()]
    .filter(c => c.hasPr)
    .map(c => {
      const timed = c.efforts.filter(e => e.start != null && e.elapsed > 0);
      const best = timed.length ? Math.min(...timed.map(e => e.elapsed)) : null;
      return {
        id: c.id, name: c.name, activityIds: c.activityIds, lastPrDate: c.lastPrDate,
        // every effort tied for fastest, so a tie between two of the athlete's own efforts still matches
        bestEfforts: best == null ? [] : timed.filter(e => e.elapsed === best)
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const norm = s => String(s || "").trim().toLowerCase().replace(/\./g, "");

/** Leaderboard names are abbreviated ("Jane D."), so compare first name and last initial; unknown names don't veto. */
function nameMatches(entryName, athlete) {
  if (!entryName || !athlete || !athlete.firstname) return true;
  const parts = norm(entryName).split(/\s+/).filter(Boolean);
  if (!parts.length) return true;
  if (parts[0] !== norm(athlete.firstname)) return false;
  const lastInitial = norm(athlete.lastname).charAt(0);
  const entryLast = parts.length > 1 ? parts[parts.length - 1] : "";
  return !lastInitial || !entryLast || entryLast.charAt(0) === lastInitial;
}

/**
 * Finds the athlete's own entry among leaderboard entries and returns its rank (1-3) or null when they are not in
 * the top 3. `athlete` ({ firstname, lastname }) is only used to break ties between entries that match by time.
 */
function matchLeaderboardEntry(entries, candidate, athlete = null) {
  if (!Array.isArray(entries)) return null;
  const rankOf = (entry, index) => {
    const r = Number(entry && entry.rank);
    return Number.isFinite(r) && r > 0 ? r : index + 1;
  };

  let matches = entries
    .map((entry, index) => ({ entry, rank: rankOf(entry, index) }))
    .filter(({ entry }) => {
      if (!entry) return false;
      if (entry.activity_id != null) return candidate.activityIds.has(String(entry.activity_id));
      const start = ts(entry.start_date);
      const elapsed = Number(entry.elapsed_time);
      if (start == null || !Number.isFinite(elapsed)) return false;
      return candidate.bestEfforts.some(e => e.start === start && e.elapsed === elapsed);
    });

  if (matches.length > 1) {
    const byName = matches.filter(m => nameMatches(m.entry.athlete_name, athlete));
    if (byName.length) matches = byName;
  }
  if (!matches.length) return null;
  const rank = Math.min(...matches.map(m => m.rank));
  return TOP_RANKS.includes(rank) ? rank : null;
}

/** Candidates that still need a leaderboard request. `refresh` also re-checks stale entries and those with a newer PR. */
function selectSegmentsToCheck(candidates, ranks, { refresh = false, maxAgeDays = DEFAULT_MAX_AGE_DAYS, now = Date.now() } = {}) {
  const maxAge = (Number.isFinite(Number(maxAgeDays)) && Number(maxAgeDays) >= 0 ? Number(maxAgeDays) : DEFAULT_MAX_AGE_DAYS) * DAY_MS;
  return (candidates || []).filter(c => {
    const r = ranks && ranks[c.id];
    if (!r || !r.checkedAt) return true;
    if (!refresh) return false;
    const checked = ts(r.checkedAt);
    if (checked == null || now - checked > maxAge) return true;
    return c.lastPrDate != null && c.lastPrDate > checked;
  });
}

/**
 * Processes queued candidates one request at a time, writing results into `ranks`.
 * Stops (without recording anything for the unprocessed segment) on 429, on 401/402/403 and on any other
 * non-OK response, so a failing endpoint is never retried in a loop.
 * fetchLeaderboard(segmentId) -> { status, ok, json }
 * Returns { checked, stopped: null|"limit"|"rate_limited"|"forbidden"|"error"|"cancelled", error }.
 */
async function runRankBatch({ queue, ranks, fetchLeaderboard, athlete = null, canContinue = () => true, now = () => new Date() }) {
  let checked = 0;
  for (const candidate of queue) {
    if (!canContinue()) return { checked, stopped: "cancelled", error: null };
    const res = await fetchLeaderboard(candidate.id);
    const status = res && res.status;
    if (status === 429) return { checked, stopped: "rate_limited", error: null };
    if (FATAL_STATUSES.has(status)) {
      return {
        checked, stopped: "forbidden",
        error: `Strava refused the leaderboard request for segment ${candidate.id} (HTTP ${status}). The athlete or app may not be allowed to read segment leaderboards; the backfill was stopped.`
      };
    }
    const checkedAt = now().toISOString();
    if (status === 404) {
      // Segment deleted or made private: nothing to rank, don't ask again until a refresh.
      ranks[candidate.id] = { rank: null, checkedAt, entries: 0 };
      checked++;
      continue;
    }
    if (!res || !res.ok) {
      return { checked, stopped: "error", error: `Leaderboard request for segment ${candidate.id} failed (HTTP ${status ?? "unknown"}); the backfill was stopped.` };
    }
    const body = res.json || {};
    const entries = Array.isArray(body.entries) ? body.entries : [];
    ranks[candidate.id] = { rank: matchLeaderboardEntry(entries, candidate, athlete), checkedAt, entries: entries.length };
    checked++;
  }
  return { checked, stopped: null, error: null };
}

/** Counts of current ranks, for the status endpoint. */
function summarizeRanks(ranks) {
  const out = { kom: 0, second: 0, third: 0 };
  Object.values(ranks || {}).forEach(r => {
    if (r && r.rank === 1) out.kom++;
    else if (r && r.rank === 2) out.second++;
    else if (r && r.rank === 3) out.third++;
  });
  return out;
}

module.exports = {
  DEFAULT_MAX_AGE_DAYS, buildRankCandidates, matchLeaderboardEntry, nameMatches,
  selectSegmentsToCheck, runRankBatch, summarizeRanks
};
