/* Pure helpers for the engagement (kudos / comments / photos) backfill (no Strava or filesystem access).
   Engagement fields are deliberately NOT part of activitySignature: counts keep changing after a ride and must never
   flag an activity as changed (which would trigger segment re-fetches). */

const ENGAGEMENT_FIELDS = ["kudos_count", "comment_count", "photo_count"];
const DEFAULT_REFRESH_PAGES = 2;
const SNAPSHOT_CAP = 5000;
/* Bump when the mapping changes in a way that makes cached values wrong. v2: photo_count now stores total_photo_count. */
const ENGAGEMENT_VERSION = 2;

function defaultEngagementBackfill() {
  return { nextPage: 1, completed: false, lastRunAt: null, pagesDone: 0, secondPass: false, lastError: null, version: ENGAGEMENT_VERSION };
}

function engagementNeedsRerun(meta) {
  return !meta || !(Number(meta.version) >= ENGAGEMENT_VERSION);
}

/* A backfill meta from before the current version is treated as not completed so it re-runs (once; `migrating` keeps progress
   of the re-run across cache loads). Mutates and returns `meta`. */
function migrateEngagementMeta(meta) {
  if (!engagementNeedsRerun(meta) || meta.migrating) return meta;
  meta.completed = false;
  meta.nextPage = 1;
  meta.pagesDone = 0;
  meta.secondPass = false;
  meta.migrating = true;
  return meta;
}

/* Non-negative integer, or undefined when the value is missing/invalid ("not backfilled yet" stays distinguishable from 0). */
function toCount(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.floor(n));
}

/* Engagement fields from a raw /athlete/activities item. Absent fields are omitted entirely.
   The cached photo_count is the TOTAL photos on the activity: Strava's photo_count is only externally hosted (Instagram) photos
   and is almost always 0, while total_photo_count is Strava-hosted + Instagram. total_photo_count wins when valid; otherwise
   we fall back to photo_count. (Not Math.max: when total_photo_count is present it is authoritative.) */
function mapEngagementFields(a) {
  const src = a || {};
  const photo = toCount(src.total_photo_count) !== undefined ? toCount(src.total_photo_count) : toCount(src.photo_count);
  const out = {};
  const kudos = toCount(src.kudos_count);
  const comments = toCount(src.comment_count);
  if (kudos !== undefined) out.kudos_count = kudos;
  if (comments !== undefined) out.comment_count = comments;
  if (photo !== undefined) out.photo_count = photo;
  return out;
}

function hasEngagement(activity) {
  return Boolean(activity) && toCount(activity.kudos_count) !== undefined;
}

/* Merge engagement fields by id into cached activities (raw Strava or mapped items). Mutates `cached`; never touches other fields.
   Default: only fills fields that are missing. With { overwrite: true } (refresh) fresh values win; overwrite may also be an array of field names to overwrite. Returns how many activities changed. */
function mergeEngagement(cached, pageItems, { overwrite = false } = {}) {
  const byId = new Map();
  for (const a of cached || []) byId.set(String(a.id), a);
  let updated = 0;
  for (const item of pageItems || []) {
    if (!item) continue;
    const existing = byId.get(String(item.id));
    if (!existing) continue;
    const fresh = mapEngagementFields(item);
    let touched = false;
    for (const field of ENGAGEMENT_FIELDS) {
      if (fresh[field] === undefined) continue;
      let over = overwrite === true || (Array.isArray(overwrite) && overwrite.includes(field));
      // A count verified from the detail endpoint (photo backfill) is more reliable than the list's value.
      if (field === "photo_count" && existing.photo_checked === true) over = false;
      if (over ? existing[field] !== fresh[field] : toCount(existing[field]) === undefined) {
        existing[field] = fresh[field];
        touched = true;
      }
    }
    if (touched) updated += 1;
  }
  return updated;
}

/* When a freshly fetched activity lacks engagement fields, keep the cached ones. Mutates and returns `fresh`. */
function carryEngagement(fresh, existing) {
  if (!fresh || !existing) return fresh;
  for (const field of ENGAGEMENT_FIELDS) {
    if (toCount(fresh[field]) === undefined && toCount(existing[field]) !== undefined) fresh[field] = existing[field];
  }
  return fresh;
}

/* Follower/following snapshot from a /athlete response; null when the fields are absent. */
function athleteSnapshotFrom(athlete, now = new Date()) {
  if (!athlete) return null;
  const followers = toCount(athlete.follower_count);
  const following = toCount(athlete.friend_count);
  if (followers === undefined || following === undefined) return null;
  return { date: now.toISOString().slice(0, 10), followers, following };
}

/* Append a snapshot (max one per day; a same-day snapshot is replaced). Returns the new array, capped at SNAPSHOT_CAP. */
function appendAthleteSnapshot(snapshots, snapshot, cap = SNAPSHOT_CAP) {
  const list = Array.isArray(snapshots) ? snapshots.slice() : [];
  if (!snapshot) return list;
  const idx = list.findIndex(s => s && s.date === snapshot.date);
  if (idx >= 0) list[idx] = snapshot;
  else list.push(snapshot);
  return list.length > cap ? list.slice(list.length - cap) : list;
}

module.exports = {
  ENGAGEMENT_FIELDS,
  DEFAULT_REFRESH_PAGES,
  SNAPSHOT_CAP,
  ENGAGEMENT_VERSION,
  defaultEngagementBackfill,
  engagementNeedsRerun,
  migrateEngagementMeta,
  toCount,
  mapEngagementFields,
  hasEngagement,
  mergeEngagement,
  carryEngagement,
  athleteSnapshotFrom,
  appendAthleteSnapshot
};
