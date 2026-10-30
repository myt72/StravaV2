/* Pure helpers for the photo count backfill (no Strava or filesystem access).
   Strava's /athlete/activities list often reports total_photo_count 0 even when photos exist; GET /activities/{id} has the real total.
   Only counts are stored (never images or URLs). photo_checked is deliberately NOT part of activitySignature so it never flags an
   activity as changed (which would trigger segment re-fetches). */

const { toCount } = require("./engagementBackfill");

const PHOTO_BACKFILL_VERSION = 1;
const DEFAULT_RECENT_CHECK = 25;
const DEFAULT_RECENT_RECHECK = 50;

function defaultPhotoBackfill() {
  return { completed: false, checked: 0, total: 0, lastRunAt: null, lastError: null, version: PHOTO_BACKFILL_VERSION };
}

/* Photo total from a GET /activities/{id} response: total_photo_count, else photos.count, else photo_count. undefined when none is valid. */
function photoCountFromDetail(detail) {
  if (!detail || typeof detail !== "object") return undefined;
  const candidates = [detail.total_photo_count, detail.photos && detail.photos.count, detail.photo_count];
  for (const value of candidates) {
    const n = toCount(value);
    if (n !== undefined) return n;
  }
  return undefined;
}

function needsPhotoCheck(activity) {
  return Boolean(activity) && activity.photo_checked !== true;
}

function startTime(activity) {
  const t = new Date(activity && activity.start_date).getTime();
  return Number.isFinite(t) ? t : 0;
}

function newestFirst(activities) {
  return (activities || []).filter(Boolean).slice().sort((a, b) => startTime(b) - startTime(a));
}

/* Up to n unverified activities, newest first. */
function pickNextBatch(activities, n) {
  return newestFirst(activities).filter(needsPhotoCheck).slice(0, Math.max(0, Math.floor(Number(n)) || 0));
}

/* The newest n activities (verified or not) when includeVerified, else only the unverified ones among them. */
function pickRecent(activities, n, { includeVerified = false } = {}) {
  const window = newestFirst(activities).slice(0, Math.max(0, Math.floor(Number(n)) || 0));
  return includeVerified ? window : window.filter(needsPhotoCheck);
}

/* Store a verified count. A missing count (undefined) leaves the activity untouched/unverified. Returns true when applied. */
function applyPhotoCount(activity, count) {
  const n = toCount(count);
  if (!activity || n === undefined) return false;
  activity.photo_count = n;
  activity.photo_checked = true;
  return true;
}

/* Mark verified without changing the existing count (e.g. the activity no longer exists on Strava). */
function markPhotoChecked(activity) {
  if (!activity) return false;
  activity.photo_checked = true;
  return true;
}

/* A freshly fetched list item must not overwrite a verified count with the list's (unreliable) value. Mutates and returns `fresh`. */
function carryPhotoCheck(fresh, existing) {
  if (!fresh || !existing || existing.photo_checked !== true) return fresh;
  fresh.photo_checked = true;
  if (toCount(existing.photo_count) !== undefined) fresh.photo_count = existing.photo_count;
  return fresh;
}

function photoBackfillProgress(activities) {
  const list = (activities || []).filter(Boolean);
  const checked = list.filter(a => !needsPhotoCheck(a)).length;
  return { checked, total: list.length, remaining: list.length - checked };
}

module.exports = {
  PHOTO_BACKFILL_VERSION,
  DEFAULT_RECENT_CHECK,
  DEFAULT_RECENT_RECHECK,
  defaultPhotoBackfill,
  photoCountFromDetail,
  needsPhotoCheck,
  pickNextBatch,
  pickRecent,
  applyPhotoCount,
  markPhotoChecked,
  carryPhotoCheck,
  photoBackfillProgress
};
