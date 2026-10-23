const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const fs = require("fs");
const crypto = require("crypto");
const { client_id, client_secret, admin_password, redirect_uri, port, bike_types, applyBikeTypes, findUnmatchedBikeTypes } = require("./config");
const routeMatching = require("./lib/routeMatching");
const segmentRanks = require("./lib/segmentRanks");

const app = express();
app.use(cors());
app.use(express.json());

let access_token = null;
let refresh_token = null;

const CACHE_FILE = "./cache.json";

/* Rate limit tracking */
let rateLimitRemaining = 600;
let rateLimitLimit = 600;
let rateLimitShortRemaining = 600;
let rateLimitShortLimit = 600;
let requestCount = 0;

/* Background PR backfill job state */
let prBackfillJob = {
  running: false,
  stopRequested: false,
  startedAt: null,
  lastRunAt: null,
  nextRetryAt: null,
  mode: "idle",
  message: "Idle",
  totalEligible: 0,
  remaining: 0,
  nextIndex: 0,
  fetchedThisRun: 0,
  processed: 0,
  completed: false,
  batchSize: 25,
  reserve: 25,
  idlePasses: 0
};

/* Background geo backfill job state (re-pages /athlete/activities to add summary_polyline + start/end latlng) */
let geoBackfillJob = {
  running: false,
  stopRequested: false,
  startedAt: null,
  lastRunAt: null,
  nextRetryAt: null,
  mode: "idle",
  message: "Idle",
  page: 1,
  pagesDone: 0,
  reserve: 25
};

/* Background segment leaderboard backfill job state (one leaderboard request per candidate segment) */
let segmentRankJob = {
  running: false,
  stopRequested: false,
  startedAt: null,
  lastRunAt: null,
  nextRetryAt: null,
  mode: "idle",
  message: "Idle",
  lastError: null,
  refresh: false,
  maxAgeDays: segmentRanks.DEFAULT_MAX_AGE_DAYS,
  checkedThisRun: 0,
  batchSize: 20,
  reserve: 25
};

/* ----------------- ADMIN PASSWORD PROTECTION ----------------- */
const ADMIN_FAIL_LIMIT = 10;
const ADMIN_FAIL_WINDOW_MS = 15 * 60 * 1000;
const adminFailures = new Map(); // ip -> { count, resetAt }

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireAdmin(req, res, next) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
  const now = Date.now();
  let entry = adminFailures.get(ip);
  if (entry && entry.resetAt <= now) {
    adminFailures.delete(ip);
    entry = null;
  }
  if (entry && entry.count >= ADMIN_FAIL_LIMIT) {
    res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
    return res.status(429).json({ error: "Too many failed attempts. Try again later." });
  }

  const supplied = req.get("x-admin-password") || "";
  if (!admin_password || !safeEqual(supplied, admin_password)) {
    if (!entry) {
      entry = { count: 0, resetAt: now + ADMIN_FAIL_WINDOW_MS };
      adminFailures.set(ip, entry);
    }
    entry.count += 1;
    return res.status(401).json({ error: "Unauthorized" });
  }
  adminFailures.delete(ip);
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of adminFailures) if (e.resetAt <= now) adminFailures.delete(ip);
}, ADMIN_FAIL_WINDOW_MS).unref();

/* ----------------- CACHE BUSTING MIDDLEWARE ----------------- */
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

/* ----------------- CACHE ----------------- */

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = fs.readFileSync(CACHE_FILE, "utf8").trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error("Cache corrupted:", err);
    return null;
  }
}

function saveCache(data, { skipClusters = false } = {}) {
  if (!skipClusters && data && Array.isArray(data.activities)) {
    try {
      data.routeClusters = routeMatching.buildRouteClusters(
        data.activities,
        data.segmentData || {},
        data.routeClusters,
        getRouteMatchingConfig()
      );
    } catch (err) {
      console.error("[Routes] Incremental clustering failed:", err);
    }
  }
  const tmp = CACHE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, CACHE_FILE);
}

function ensureCacheShape(cache) {
  const base = cache || {};
  if (!Array.isArray(base.activities)) base.activities = [];
  if (!base.segmentData || typeof base.segmentData !== "object") base.segmentData = {};
  if (!base.activityCounts || typeof base.activityCounts !== "object") base.activityCounts = {};
  if (!base.gearTotals || typeof base.gearTotals !== "object") base.gearTotals = {};
  if (!base.gearDetails || typeof base.gearDetails !== "object") base.gearDetails = {};
  if (!base.annualStats || typeof base.annualStats !== "object") base.annualStats = {};
  if (!base.bikeYearStats || typeof base.bikeYearStats !== "object") base.bikeYearStats = {};
  if (!base.routeClusters || typeof base.routeClusters !== "object" || !Array.isArray(base.routeClusters.clusters)) {
    base.routeClusters = routeMatching.emptyRouteClusters();
  }
  if (!base.geoBackfill || typeof base.geoBackfill !== "object") {
    base.geoBackfill = { nextPage: 1, completed: false, lastRunAt: null, pagesDone: 0 };
  }
  if (!base.segmentRanks || typeof base.segmentRanks !== "object" || Array.isArray(base.segmentRanks)) {
    base.segmentRanks = {};
  }
  if (!base.segmentRankMeta || typeof base.segmentRankMeta !== "object") {
    base.segmentRankMeta = { lastRunAt: null, lastError: null };
  }
  if (!base.segmentBackfill || typeof base.segmentBackfill !== "object") {
    base.segmentBackfill = {
      enabled: false,
      nextIndex: 0,
      completed: false,
      lastRunAt: null,
      totalEligible: 0,
      fetchedThisRun: 0,
      remaining: 0
    };
  }
  return base;
}

function setSegmentBackfillMeta(cache, meta = {}) {
  const shaped = ensureCacheShape(cache);
  shaped.segmentBackfill = {
    enabled: meta.enabled ?? true,
    nextIndex: meta.nextIndex ?? 0,
    completed: meta.completed ?? false,
    lastRunAt: meta.lastRunAt ?? new Date().toISOString(),
    totalEligible: meta.totalEligible ?? 0,
    fetchedThisRun: meta.fetchedThisRun ?? 0,
    remaining: meta.remaining ?? 0
  };
  return shaped;
}

/* Update rate limit from response headers */
function updateRateLimit(res) {
  const limit = res.headers.get("x-ratelimit-limit");
  const usage = res.headers.get("x-ratelimit-usage");

  if (limit && usage) {
    const [shortLimit, longLimit] = limit.split(",").map(Number);
    const [shortUsed, longUsed] = usage.split(",").map(Number);

    if (!Number.isNaN(shortLimit) && !Number.isNaN(shortUsed)) {
      rateLimitShortLimit = shortLimit;
      rateLimitShortRemaining = shortLimit - shortUsed;
    }

    if (!Number.isNaN(longLimit) && !Number.isNaN(longUsed)) {
      rateLimitLimit = longLimit;
      rateLimitRemaining = longLimit - longUsed;
    }

    console.log(`[Rate Limit] ${rateLimitShortRemaining}/${rateLimitShortLimit} short, ${rateLimitRemaining}/${rateLimitLimit} daily remaining`);
  }
}

/* Sleep utility */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getNextQuarterHourUtc(now = new Date()) {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  const minutes = d.getUTCMinutes();
  const nextQuarter = Math.ceil((minutes + 1) / 15) * 15;
  if (nextQuarter >= 60) {
    d.setUTCHours(d.getUTCHours() + 1);
    d.setUTCMinutes(0);
  } else {
    d.setUTCMinutes(nextQuarter);
  }
  return d;
}

function getNextDailyResetUtc(now = new Date()) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 5, 0);
  return d;
}

function getNextRetryTime() {
  const now = new Date();
  if (rateLimitRemaining <= 5) {
    return getNextDailyResetUtc(now);
  }
  return getNextQuarterHourUtc(now);
}

/* AUTH */

app.get("/dashboard", (req, res, next) => {
  if (!access_token) return res.redirect("/auth");
  next();
});

app.use("/dashboard", express.static(require("path").join(__dirname, "client", "dist")));
app.use("/dashboard", express.static(require("path").join(__dirname, "public")));

app.get("/auth", (req, res) => {
  const url =
    `https://www.strava.com/oauth/authorize?client_id=${client_id}` +
    `&response_type=code&redirect_uri=${redirect_uri}` +
    `&scope=read,activity:read_all`;
  res.redirect(url);
});

app.get("/exchange_token", async (req, res) => {
  const code = req.query.code;

  const tokenRes = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id,
      client_secret,
      code,
      grant_type: "authorization_code"
    })
  });

  const data = await tokenRes.json();
  access_token = data.access_token;
  refresh_token = data.refresh_token;

  res.redirect("/dashboard");
});

/* TOKEN REFRESH */

async function refreshToken() {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id,
      client_secret,
      grant_type: "refresh_token",
      refresh_token
    })
  });

  const data = await res.json();
  access_token = data.access_token;
  refresh_token = data.refresh_token;
}

/* FETCH WRAPPER */

async function stravaFetch(url) {
  requestCount++;

  if (rateLimitShortRemaining < 10 || rateLimitRemaining < 25) {
    console.warn(`[Rate Limit] Low headroom before request. short=${rateLimitShortRemaining}, daily=${rateLimitRemaining}`);
    await sleep(1000);
  }

  let res = await fetch(url, {
    headers: { Authorization: `Bearer ${access_token}` }
  });

  updateRateLimit(res);

  if (res.status === 401) {
    await refreshToken();
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    updateRateLimit(res);
  }

  if (res.status === 429) {
    console.error("[Rate Limit] Hit 429 - Strava rate limit exceeded");
  }

  return res;
}

/* ACTIVITY FETCH */

function mapActivity(a) {
  return {
    id: a.id,
    name: a.name,
    url: `https://www.strava.com/activities/${a.id}`,
    sport_type: a.sport_type || a.type,
    distance: a.distance,
    moving_time: a.moving_time,
    elapsed_time: a.elapsed_time,
    total_elevation_gain: a.total_elevation_gain,
    start_date: a.start_date,
    gear_id: a.gear_id,
    ...mapGeoFields(a)
  };
}

function mapLatLng(v) {
  return Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? [v[0], v[1]] : [];
}

/* Geo fields from a /athlete/activities item. Always strings/arrays (possibly empty) so "missing" means "not backfilled yet". */
function mapGeoFields(a) {
  return {
    summary_polyline: (a.map && a.map.summary_polyline) || "",
    start_latlng: mapLatLng(a.start_latlng),
    end_latlng: mapLatLng(a.end_latlng)
  };
}

function activitySignature(activity, { includeGeo = true } = {}) {
  if (!activity) return "";
  const geo = includeGeo
    ? { summary_polyline: activity.summary_polyline, start_latlng: activity.start_latlng, end_latlng: activity.end_latlng }
    : {};
  return JSON.stringify({
    id: activity.id,
    name: activity.name,
    sport_type: activity.sport_type,
    distance: activity.distance,
    moving_time: activity.moving_time,
    elapsed_time: activity.elapsed_time,
    total_elevation_gain: activity.total_elevation_gain,
    start_date: activity.start_date,
    gear_id: activity.gear_id,
    ...geo
  });
}

async function fetchAllActivitiesOnce() {
  let page = 1;
  let all = [];

  while (true) {
    const res = await stravaFetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=${page}`
    );
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    all = all.concat(data.map(mapActivity));
    page++;
  }

  return all;
}

async function fetchNewActivitiesSince(lastDate) {
  if (!lastDate) return [];

  const lastTs = new Date(lastDate).getTime();

  const res = await stravaFetch(
    `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=1`
  );
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return [];

  const newActs = [];

  for (const a of data) {
    const ts = new Date(a.start_date).getTime();
    if (ts > lastTs) newActs.push(mapActivity(a));
    else break;
  }

  return newActs;
}

async function fetchRecentActivitiesPage() {
  const res = await stravaFetch(
    `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=1`
  );
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return [];
  return data.map(mapActivity);
}

function mergeActivitiesById(preferredActivities, existingActivities) {
  const merged = new Map();

  for (const activity of preferredActivities || []) {
    merged.set(String(activity.id), activity);
  }

  for (const activity of existingActivities || []) {
    const key = String(activity.id);
    if (!merged.has(key)) {
      merged.set(key, activity);
    }
  }

  return Array.from(merged.values()).sort(
    (a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime()
  );
}

function findChangedActivities(incomingActivities, existingActivities) {
  const existingById = new Map((existingActivities || []).map(a => [String(a.id), a]));
  const changed = [];
  const added = [];

  for (const activity of incomingActivities || []) {
    const existing = existingById.get(String(activity.id));
    if (!existing) {
      added.push(activity);
      changed.push(activity);
      continue;
    }

    // Legacy cached activities have no geo fields yet; don't treat that as a change (it would re-fetch segment data).
    const includeGeo = existing.summary_polyline !== undefined;
    if (activitySignature(activity, { includeGeo }) !== activitySignature(existing, { includeGeo })) {
      changed.push(activity);
    }
  }

  return { changed, added };
}

async function fetchActivitiesBefore(beforeDate) {
  if (!beforeDate) return [];

  const beforeTs = new Date(beforeDate).getTime();
  let page = 1;
  let all = [];
  let foundBefore = false;

  console.log(`[Resume] Fetching activities before ${beforeDate}...`);

  while (true) {
    const res = await stravaFetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=${page}`
    );
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    for (const a of data) {
      const ts = new Date(a.start_date).getTime();
      if (ts < beforeTs) {
        all.push(mapActivity(a));
        foundBefore = true;
      }
    }

    if (foundBefore && data[data.length - 1]) {
      const lastTs = new Date(data[data.length - 1].start_date).getTime();
      if (lastTs >= beforeTs) {
        page++;
        continue;
      } else {
        break;
      }
    }

    page++;
  }

  console.log(`[Resume] Found ${all.length} activities before ${beforeDate}`);
  return all;
}

/* GEAR FETCH */

async function fetchMissingGearDetails(existingGearDetails, gearTotals) {
  const knownIds = new Set(Object.keys(existingGearDetails || {}));
  const allIds = Object.keys(gearTotals || {});
  const missingIds = allIds.filter(id => !knownIds.has(id));

  if (missingIds.length === 0) return existingGearDetails || {};

  console.log(`[Gear Fetch] Fetching ${missingIds.length} gear details...`);

  const gearDetails = { ...(existingGearDetails || {}) };
  const BATCH_SIZE = 3;

  for (let i = 0; i < missingIds.length; i += BATCH_SIZE) {
    const batch = missingIds.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async gid => {
      const res = await stravaFetch(`https://www.strava.com/api/v3/gear/${gid}`);
      const data = await res.json();
      return { gid, data };
    });

    const results = await Promise.all(promises);
    for (const { gid, data } of results) {
      gearDetails[gid] = data;
    }

    if (i + BATCH_SIZE < missingIds.length) {
      await sleep(500);
    }
  }

  return gearDetails;
}

/* SEGMENT FETCH */

function normalizeSegmentEffort(e) {
  const elevationGain =
    e?.segment?.elevation_high != null && e?.segment?.elevation_low != null
      ? (e.segment.elevation_high - e.segment.elevation_low)
      : (e?.elevation_gain ?? null);

  return {
    segment_id: e?.segment?.id || null,
    segment_name: e?.segment?.name || e?.name || null,
    distance: e?.distance ?? e?.segment?.distance ?? 0,
    elapsed_time: e?.elapsed_time ?? 0,
    moving_time: e?.moving_time ?? null,
    start_date: e?.start_date || null,
    pr_rank: e?.pr_rank || null,
    average_grade: e?.segment?.average_grade ?? e?.average_grade ?? null,
    elevation_gain: elevationGain
  };
}

async function fetchSegmentEffortsForActivities(activities, existingSegmentData, fetchSegments = false, options = {}) {
  if (!fetchSegments) {
    console.log("[Segment Fetch] Skipped (disabled to save rate limit)");
    return existingSegmentData || {};
  }

  const existing = existingSegmentData || {};
  const forceActivityIds = new Set((options.forceActivityIds || []).map(id => String(id)));

  const toFetch = activities.filter(a => {
    if (!a || a.sport_type !== "Ride") return false;
    if (forceActivityIds.has(String(a.id))) return true;
    return !(a.id in existing);
  });

  if (toFetch.length === 0) {
    console.log("[Segment Fetch] No new ride segments to fetch");
    return existing;
  }

  console.warn(`[Segment Fetch] About to fetch ${toFetch.length} ride activities for segment data.`);

  if (rateLimitShortRemaining < toFetch.length + 10 || rateLimitRemaining < toFetch.length + 25) {
    console.error(`[Segment Fetch] Insufficient rate limit. short=${rateLimitShortRemaining}, daily=${rateLimitRemaining}. Skipping.`);
    return existing;
  }

  const result = { ...existing };
  let fetched = 0;

  for (const a of toFetch) {
    if (rateLimitShortRemaining < 5 || rateLimitRemaining < 15) {
      console.warn(`[Segment Fetch] Rate limit running low. Fetched ${fetched}/${toFetch.length} segments.`);
      break;
    }

    try {
      const res = await stravaFetch(`https://www.strava.com/api/v3/activities/${a.id}`);

      if (res.status === 429) {
        console.warn("[Segment Fetch] Hit 429. Stopping segment fetch.");
        break;
      }

      const detail = await res.json();
      const efforts = Array.isArray(detail.segment_efforts)
        ? detail.segment_efforts.map(normalizeSegmentEffort)
        : [];

      result[a.id] = efforts;
      fetched++;

      if (fetched % 5 === 0) {
        await sleep(750);
      }
    } catch (err) {
      console.warn(`[Segment Fetch] Failed for activity ${a.id}:`, err.message);
      result[a.id] = [];
    }
  }

  console.log(`[Segment Fetch] Completed: ${fetched}/${toFetch.length} activities`);
  return result;
}

/* RESUMABLE BACKFILL */

async function backfillSegmentEffortsResumable(cache, options = {}) {
  const workingCache = ensureCacheShape(cache);
  const rides = (workingCache.activities || []).filter(a => a && a.sport_type === "Ride");

  const sortedRides = [...rides].sort(
    (a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime()
  );

  const batchSize = Math.max(1, Number(options.batchSize || 25));
  const reserve = Math.max(5, Number(options.reserve || 25));
  const startIndex = Number.isInteger(workingCache.segmentBackfill.nextIndex)
    ? workingCache.segmentBackfill.nextIndex
    : 0;

  let currentIndex = startIndex;
  let fetchedThisRun = 0;
  let processedThisRun = 0;
  let stoppedForRateLimit = false;

  console.log(`[Segment Backfill] Starting at index ${startIndex} of ${sortedRides.length}. Batch size ${batchSize}. Reserve ${reserve}.`);

  while (currentIndex < sortedRides.length && fetchedThisRun < batchSize) {
    if (prBackfillJob.stopRequested) {
      console.warn("[Segment Backfill] Stop requested.");
      break;
    }

    const activity = sortedRides[currentIndex];
    currentIndex++;

    if (activity.id in workingCache.segmentData) {
      processedThisRun++;
      continue;
    }

    if (rateLimitShortRemaining <= reserve || rateLimitRemaining <= reserve) {
      stoppedForRateLimit = true;
      currentIndex--;
      console.warn(`[Segment Backfill] Stopping for rate limit safety at short=${rateLimitShortRemaining}, daily=${rateLimitRemaining}.`);
      break;
    }

    try {
      const res = await stravaFetch(`https://www.strava.com/api/v3/activities/${activity.id}`);

      if (res.status === 429) {
        stoppedForRateLimit = true;
        currentIndex--;
        console.warn("[Segment Backfill] Hit 429. Saving progress and stopping.");
        break;
      }

      const detail = await res.json();
      const efforts = Array.isArray(detail.segment_efforts)
        ? detail.segment_efforts.map(normalizeSegmentEffort)
        : [];

      workingCache.segmentData[activity.id] = efforts;
      fetchedThisRun++;
      processedThisRun++;

      if (fetchedThisRun % 5 === 0) {
        saveCache(workingCache);
        await sleep(750);
      }
    } catch (err) {
      console.warn(`[Segment Backfill] Failed for activity ${activity.id}:`, err.message);
      workingCache.segmentData[activity.id] = [];
      fetchedThisRun++;
      processedThisRun++;
    }
  }

  const remaining = sortedRides.filter(a => !(a.id in workingCache.segmentData)).length;
  const completed = remaining === 0;

  setSegmentBackfillMeta(workingCache, {
    enabled: true,
    nextIndex: completed ? 0 : currentIndex,
    completed,
    lastRunAt: new Date().toISOString(),
    totalEligible: sortedRides.length,
    fetchedThisRun,
    remaining
  });

  const { activityCounts, gearTotals, annualStats, bikeYearStats } = computeAnalytics(
    workingCache.activities,
    workingCache.segmentData
  );

  const gearDetails = await fetchMissingGearDetails(workingCache.gearDetails, gearTotals);

  workingCache.activityCounts = activityCounts;
  workingCache.gearTotals = gearTotals;
  workingCache.gearDetails = gearDetails;
  workingCache.annualStats = annualStats;
  workingCache.bikeYearStats = bikeYearStats;

  saveCache(workingCache);

  return {
    cache: workingCache,
    meta: {
      fetchedThisRun,
      processedThisRun,
      stoppedForRateLimit,
      completed,
      nextIndex: workingCache.segmentBackfill.nextIndex,
      remaining,
      totalEligible: sortedRides.length,
      lastRunAt: workingCache.segmentBackfill.lastRunAt
    }
  };
}

/* ISO WEEK HELPER */

function getISOWeek(dateStr) {
  const d = new Date(dateStr);
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
  return { year: thursday.getUTCFullYear(), week };
}

/* ANALYTICS */

function computeAnalytics(allActivities, segmentData) {
  const activityCounts = {};
  const gearTotals = {};
  const annualStats = {};
  const bikeYearStats = {};

  for (const a of allActivities) {
    const type = a.sport_type;
    activityCounts[type] = (activityCounts[type] || 0) + 1;

    const prCount = segmentData && a.id in segmentData
      ? (segmentData[a.id] || []).filter(e => e.pr_rank === 1).length
      : 0;

    if (a.gear_id) {
      if (!gearTotals[a.gear_id]) {
        gearTotals[a.gear_id] = { distance: 0, elevation: 0, count: 0, moving_time: 0, pr_count: 0 };
      }
      gearTotals[a.gear_id].distance += a.distance;
      gearTotals[a.gear_id].elevation += a.total_elevation_gain;
      gearTotals[a.gear_id].count++;
      gearTotals[a.gear_id].moving_time += a.moving_time || 0;
      gearTotals[a.gear_id].pr_count += prCount;
    }

    const year = new Date(a.start_date).getFullYear();
    if (!annualStats[year]) annualStats[year] = { distance: 0, elevation: 0, count: 0 };
    annualStats[year].distance += a.distance;
    annualStats[year].elevation += a.total_elevation_gain;
    annualStats[year].count++;

    if (a.gear_id) {
      if (!bikeYearStats[a.gear_id]) bikeYearStats[a.gear_id] = {};
      if (!bikeYearStats[a.gear_id][year]) {
        bikeYearStats[a.gear_id][year] = {
          distance: 0,
          elevation: 0,
          count: 0,
          moving_time: 0,
          pr_count: 0,
          weeks: {}
        };
      }
      bikeYearStats[a.gear_id][year].distance += a.distance;
      bikeYearStats[a.gear_id][year].elevation += a.total_elevation_gain;
      bikeYearStats[a.gear_id][year].count++;
      bikeYearStats[a.gear_id][year].moving_time += a.moving_time || 0;
      bikeYearStats[a.gear_id][year].pr_count += prCount;

      const isoWeek = getISOWeek(a.start_date);
      const wk = String(isoWeek.week);
      if (!bikeYearStats[a.gear_id][year].weeks[wk]) {
        bikeYearStats[a.gear_id][year].weeks[wk] = { distance: 0, elevation: 0, count: 0, moving_time: 0 };
      }
      bikeYearStats[a.gear_id][year].weeks[wk].distance += a.distance;
      bikeYearStats[a.gear_id][year].weeks[wk].elevation += a.total_elevation_gain;
      bikeYearStats[a.gear_id][year].weeks[wk].count++;
      bikeYearStats[a.gear_id][year].weeks[wk].moving_time += a.moving_time || 0;
    }
  }

  for (const gid of Object.keys(gearTotals)) {
    const gt = gearTotals[gid];
    if (gt.moving_time > 0 && gt.distance > 0) {
      const distMiles = gt.distance / 1609.34;
      const timeHours = gt.moving_time / 3600;
      gt.avg_speed_mph = distMiles / timeHours;
      gt.avg_pace_min_per_mi = (gt.moving_time / 60) / distMiles;
    }
  }

  for (const gid of Object.keys(bikeYearStats)) {
    for (const year of Object.keys(bikeYearStats[gid])) {
      const ys = bikeYearStats[gid][year];
      if (ys.moving_time > 0 && ys.distance > 0) {
        const distMiles = ys.distance / 1609.34;
        const timeHours = ys.moving_time / 3600;
        ys.avg_speed_mph = distMiles / timeHours;
        ys.avg_pace_min_per_mi = (ys.moving_time / 60) / distMiles;
      }

      const weekNums = Object.keys(ys.weeks).map(Number).sort((a, b) => a - b);
      for (let i = 0; i < weekNums.length; i++) {
        const wk = String(weekNums[i]);
        const prevWk = i > 0 ? String(weekNums[i - 1]) : null;
        ys.weeks[wk].trend = prevWk && ys.weeks[prevWk].distance > 0
          ? (ys.weeks[wk].distance - ys.weeks[prevWk].distance) / ys.weeks[prevWk].distance
          : 0;
      }
    }
  }

  return { activityCounts, gearTotals, annualStats, bikeYearStats };
}

/* BACKGROUND JOB DRIVER */

async function runPrBackfillJobLoop() {
  if (prBackfillJob.running) return;

  prBackfillJob.running = true;
  prBackfillJob.stopRequested = false;
  prBackfillJob.startedAt = prBackfillJob.startedAt || new Date().toISOString();
  prBackfillJob.mode = "running";
  prBackfillJob.message = "PR backfill running";

  while (!prBackfillJob.stopRequested) {
    if (prBackfillJob.nextRetryAt) {
      const now = Date.now();
      const retryAt = new Date(prBackfillJob.nextRetryAt).getTime();
      if (retryAt > now) {
        prBackfillJob.mode = "waiting";
        prBackfillJob.message = `Waiting until ${new Date(prBackfillJob.nextRetryAt).toLocaleString()} to retry`;
        await sleep(Math.min(retryAt - now, 60000));
        continue;
      }
      prBackfillJob.nextRetryAt = null;
    }

    if (!access_token) {
      prBackfillJob.mode = "error";
      prBackfillJob.message = "Not authenticated";
      break;
    }

    const cache = ensureCacheShape(loadCache());
    if (!cache || !cache.activities || cache.activities.length === 0) {
      prBackfillJob.mode = "error";
      prBackfillJob.message = "No cache available. Run a full data pull first.";
      break;
    }

    requestCount = 0;

    try {
      const result = await backfillSegmentEffortsResumable(cache, {
        batchSize: prBackfillJob.batchSize,
        reserve: prBackfillJob.reserve
      });

      const meta = result.meta;
      prBackfillJob.lastRunAt = meta.lastRunAt;
      prBackfillJob.totalEligible = meta.totalEligible;
      prBackfillJob.remaining = meta.remaining;
      prBackfillJob.nextIndex = meta.nextIndex;
      prBackfillJob.fetchedThisRun = meta.fetchedThisRun;
      prBackfillJob.processed = meta.totalEligible - meta.remaining;
      prBackfillJob.completed = meta.completed;

      if (meta.completed) {
        prBackfillJob.mode = "complete";
        prBackfillJob.message = "PR backfill complete";
        prBackfillJob.running = false;
        prBackfillJob.nextRetryAt = null;
        return;
      }

      if (meta.fetchedThisRun > 0) {
        prBackfillJob.idlePasses = 0;
        prBackfillJob.mode = "running";
        prBackfillJob.message = `Fetched ${meta.fetchedThisRun} rides this pass`;
        await sleep(1000);
        continue;
      }

      prBackfillJob.idlePasses += 1;
      const nextRetry = getNextRetryTime();
      prBackfillJob.nextRetryAt = nextRetry.toISOString();
      prBackfillJob.mode = "waiting";
      prBackfillJob.message = `No progress due to rate limits. Waiting until ${nextRetry.toLocaleString()}`;
    } catch (err) {
      console.error("[PR Backfill Job] Error:", err);
      const nextRetry = getNextQuarterHourUtc();
      prBackfillJob.nextRetryAt = nextRetry.toISOString();
      prBackfillJob.mode = "error";
      prBackfillJob.message = `Error encountered. Retrying at ${nextRetry.toLocaleString()}`;
    }
  }

  prBackfillJob.running = false;
  if (prBackfillJob.stopRequested) {
    prBackfillJob.mode = "stopped";
    prBackfillJob.message = "PR backfill stopped";
  }
}

function getPrBackfillStatus() {
  const cache = ensureCacheShape(loadCache());
  const meta = cache && cache.segmentBackfill ? cache.segmentBackfill : {};

  return {
    running: prBackfillJob.running,
    stopRequested: prBackfillJob.stopRequested,
    startedAt: prBackfillJob.startedAt,
    lastRunAt: prBackfillJob.lastRunAt || meta.lastRunAt || null,
    nextRetryAt: prBackfillJob.nextRetryAt,
    mode: prBackfillJob.mode,
    message: prBackfillJob.message,
    totalEligible: prBackfillJob.totalEligible || meta.totalEligible || 0,
    remaining: prBackfillJob.remaining || meta.remaining || 0,
    nextIndex: prBackfillJob.nextIndex || meta.nextIndex || 0,
    fetchedThisRun: prBackfillJob.fetchedThisRun || meta.fetchedThisRun || 0,
    processed: prBackfillJob.processed || Math.max(0, (meta.totalEligible || 0) - (meta.remaining || 0)),
    completed: prBackfillJob.completed || meta.completed || false,
    batchSize: prBackfillJob.batchSize,
    reserve: prBackfillJob.reserve
  };
}

/* GEO BACKFILL (about ceil(activities / 200) API calls; no per-activity requests) */

function isGeoPending(activity) {
  return activity.summary_polyline === undefined;
}

function getGeoBackfillStatus() {
  const cache = ensureCacheShape(loadCache());
  const rides = cache.activities.filter(a => routeMatching.sportGroupOf(a.sport_type));
  const meta = cache.geoBackfill;
  return {
    running: geoBackfillJob.running,
    stopRequested: geoBackfillJob.stopRequested,
    startedAt: geoBackfillJob.startedAt,
    lastRunAt: geoBackfillJob.lastRunAt || meta.lastRunAt || null,
    nextRetryAt: geoBackfillJob.nextRetryAt,
    mode: geoBackfillJob.mode,
    message: geoBackfillJob.message,
    nextPage: meta.nextPage || 1,
    pagesDone: meta.pagesDone || 0,
    estimatedPages: Math.ceil(cache.activities.length / 200),
    totalRides: rides.length,
    processed: rides.filter(a => !isGeoPending(a)).length,
    withGps: rides.filter(a => a.summary_polyline).length,
    completed: Boolean(meta.completed) && !rides.some(isGeoPending),
    reserve: geoBackfillJob.reserve
  };
}

async function runGeoBackfillJobLoop() {
  if (geoBackfillJob.running) return;

  geoBackfillJob.running = true;
  geoBackfillJob.stopRequested = false;
  geoBackfillJob.mode = "running";
  geoBackfillJob.message = "Geo backfill running";

  while (!geoBackfillJob.stopRequested) {
    if (geoBackfillJob.nextRetryAt) {
      const retryAt = new Date(geoBackfillJob.nextRetryAt).getTime();
      if (retryAt > Date.now()) {
        geoBackfillJob.mode = "waiting";
        geoBackfillJob.message = `Waiting until ${new Date(geoBackfillJob.nextRetryAt).toLocaleString()} to retry`;
        await sleep(Math.min(retryAt - Date.now(), 60000));
        continue;
      }
      geoBackfillJob.nextRetryAt = null;
      geoBackfillJob.mode = "running";
    }

    if (!access_token) {
      geoBackfillJob.mode = "error";
      geoBackfillJob.message = "Not authenticated";
      break;
    }

    // Keep a safety reserve of the rate limit for other jobs.
    if (rateLimitRemaining <= geoBackfillJob.reserve || rateLimitShortRemaining <= 2) {
      const nextRetry = getNextRetryTime();
      geoBackfillJob.nextRetryAt = nextRetry.toISOString();
      geoBackfillJob.mode = "waiting";
      geoBackfillJob.message = `Rate limit reserve reached. Waiting until ${nextRetry.toLocaleString()}`;
      rateLimitRemaining = Math.max(rateLimitRemaining, geoBackfillJob.reserve + 1);
      rateLimitShortRemaining = Math.max(rateLimitShortRemaining, 3);
      continue;
    }

    const cache = ensureCacheShape(loadCache());
    if (!cache.activities.length) {
      geoBackfillJob.mode = "error";
      geoBackfillJob.message = "No cache available. Run a full data pull first.";
      break;
    }

    try {
      const page = cache.geoBackfill.nextPage || 1;
      requestCount = 0;
      const res = await stravaFetch(`https://www.strava.com/api/v3/athlete/activities?per_page=200&page=${page}`);

      if (res.status === 429) {
        const nextRetry = getNextRetryTime();
        geoBackfillJob.nextRetryAt = nextRetry.toISOString();
        geoBackfillJob.mode = "waiting";
        geoBackfillJob.message = `Rate limited (429). Waiting until ${nextRetry.toLocaleString()}`;
        continue;
      }
      if (!res.ok) throw new Error(`Strava responded ${res.status}`);

      const data = await res.json();
      if (!Array.isArray(data)) throw new Error("Unexpected response from Strava");

      const meta = cache.geoBackfill;
      meta.lastRunAt = new Date().toISOString();
      geoBackfillJob.lastRunAt = meta.lastRunAt;

      if (data.length === 0) {
        // End of the list. A second pass picks up anything shifted between pages; leftovers no longer exist on Strava.
        const stillPending = cache.activities.filter(isGeoPending);
        if (stillPending.length && !meta.secondPass) {
          meta.secondPass = true;
          meta.nextPage = 1;
          saveCache(cache, { skipClusters: true });
          continue;
        }
        for (const a of stillPending) Object.assign(a, { summary_polyline: "", start_latlng: [], end_latlng: [] });
        meta.completed = true;
        meta.secondPass = false;
        cache.routeClusters = routeMatching.emptyRouteClusters();
        saveCache(cache); // full route recompute now that geo data is complete
        geoBackfillJob.mode = "complete";
        geoBackfillJob.message = "Geo backfill complete";
        geoBackfillJob.running = false;
        return;
      }

      const byId = new Map(cache.activities.map(a => [String(a.id), a]));
      for (const item of data) {
        const existing = byId.get(String(item.id));
        if (existing) Object.assign(existing, mapGeoFields(item));
      }
      meta.nextPage = page + 1;
      meta.pagesDone = (meta.pagesDone || 0) + 1;
      saveCache(cache, { skipClusters: true });
      geoBackfillJob.mode = "running";
      geoBackfillJob.message = `Processed page ${page} (${data.length} activities)`;
      await sleep(1000);
    } catch (err) {
      console.error("[Geo Backfill Job] Error:", err);
      const nextRetry = getNextQuarterHourUtc();
      geoBackfillJob.nextRetryAt = nextRetry.toISOString();
      geoBackfillJob.mode = "error";
      geoBackfillJob.message = `Error encountered. Retrying at ${nextRetry.toLocaleString()}`;
    }
  }

  geoBackfillJob.running = false;
  if (geoBackfillJob.stopRequested) {
    geoBackfillJob.mode = "stopped";
    geoBackfillJob.message = "Geo backfill stopped";
  }
}

/* SEGMENT RANK BACKFILL (one leaderboard request per candidate segment, plus one /athlete request per run) */

function getSegmentRankCandidates(cache) {
  return segmentRanks.buildRankCandidates(cache.segmentData, cache.activities);
}

function getSegmentRankStatus() {
  const cache = ensureCacheShape(loadCache());
  const candidates = getSegmentRankCandidates(cache);
  const pending = segmentRanks.selectSegmentsToCheck(candidates, cache.segmentRanks);
  const meta = cache.segmentRankMeta;
  return {
    running: segmentRankJob.running,
    stopRequested: segmentRankJob.stopRequested,
    startedAt: segmentRankJob.startedAt,
    lastRunAt: segmentRankJob.lastRunAt || meta.lastRunAt || null,
    nextRetryAt: segmentRankJob.nextRetryAt,
    mode: segmentRankJob.mode,
    message: segmentRankJob.message,
    lastError: segmentRankJob.lastError || meta.lastError || null,
    refresh: segmentRankJob.refresh,
    totalCandidates: candidates.length,
    checked: candidates.length - pending.length,
    remaining: pending.length,
    stale: segmentRanks.selectSegmentsToCheck(candidates, cache.segmentRanks, { refresh: true, maxAgeDays: segmentRankJob.maxAgeDays }).length - pending.length,
    completed: candidates.length > 0 && pending.length === 0,
    counts: segmentRanks.summarizeRanks(cache.segmentRanks),
    reserve: segmentRankJob.reserve
  };
}

function setSegmentRankError(message) {
  segmentRankJob.lastError = message;
  const cache = ensureCacheShape(loadCache());
  cache.segmentRankMeta.lastError = message;
  saveCache(cache, { skipClusters: true });
}

async function fetchAthleteName() {
  try {
    const res = await stravaFetch("https://www.strava.com/api/v3/athlete");
    if (!res.ok) return null;
    const a = await res.json();
    return a && a.firstname ? { firstname: a.firstname, lastname: a.lastname || "" } : null;
  } catch (err) {
    return null;
  }
}

async function fetchSegmentLeaderboard(segmentId) {
  const res = await stravaFetch(`https://www.strava.com/api/v3/segments/${encodeURIComponent(segmentId)}/leaderboard?per_page=3`);
  let json = null;
  if (res.ok) {
    try { json = await res.json(); } catch (err) { json = null; }
  }
  return { status: res.status, ok: res.ok, json };
}

async function runSegmentRankJobLoop() {
  if (segmentRankJob.running) return;

  segmentRankJob.running = true;
  segmentRankJob.stopRequested = false;
  segmentRankJob.mode = "running";
  segmentRankJob.message = "Segment rank backfill running";
  segmentRankJob.lastError = null;
  segmentRankJob.checkedThisRun = 0;
  let athlete;

  try {
    const first = ensureCacheShape(loadCache());
    first.segmentRankMeta.lastError = null;
    saveCache(first, { skipClusters: true });

    while (!segmentRankJob.stopRequested) {
      if (segmentRankJob.nextRetryAt) {
        const retryAt = new Date(segmentRankJob.nextRetryAt).getTime();
        if (retryAt > Date.now()) {
          segmentRankJob.mode = "waiting";
          segmentRankJob.message = `Waiting until ${new Date(segmentRankJob.nextRetryAt).toLocaleString()} to retry`;
          await sleep(Math.min(retryAt - Date.now(), 60000));
          continue;
        }
        segmentRankJob.nextRetryAt = null;
        segmentRankJob.mode = "running";
      }

      if (!access_token) {
        segmentRankJob.mode = "error";
        segmentRankJob.message = "Not authenticated";
        break;
      }

      if (rateLimitRemaining <= segmentRankJob.reserve || rateLimitShortRemaining <= 5) {
        const nextRetry = getNextRetryTime();
        segmentRankJob.nextRetryAt = nextRetry.toISOString();
        segmentRankJob.mode = "waiting";
        segmentRankJob.message = `Rate limit reserve reached. Waiting until ${nextRetry.toLocaleString()}`;
        rateLimitRemaining = Math.max(rateLimitRemaining, segmentRankJob.reserve + 1);
        rateLimitShortRemaining = Math.max(rateLimitShortRemaining, 6);
        continue;
      }

      const cache = ensureCacheShape(loadCache());
      const candidates = getSegmentRankCandidates(cache);
      const queue = segmentRanks.selectSegmentsToCheck(candidates, cache.segmentRanks, {
        refresh: segmentRankJob.refresh, maxAgeDays: segmentRankJob.maxAgeDays
      });
      if (!queue.length) {
        segmentRankJob.mode = "complete";
        segmentRankJob.message = candidates.length ? "Segment rank backfill complete" : "No candidate segments (no cached PR efforts on rides)";
        return;
      }

      if (athlete === undefined) athlete = await fetchAthleteName();

      requestCount = 0;
      // Stay inside the reserve for the whole batch, not just at the start.
      const result = await segmentRanks.runRankBatch({
        queue: queue.slice(0, segmentRankJob.batchSize),
        ranks: cache.segmentRanks,
        athlete,
        fetchLeaderboard: fetchSegmentLeaderboard,
        canContinue: () => !segmentRankJob.stopRequested
          && rateLimitRemaining > segmentRankJob.reserve && rateLimitShortRemaining > 5
      });

      const now = new Date().toISOString();
      cache.segmentRankMeta.lastRunAt = now;
      segmentRankJob.lastRunAt = now;
      segmentRankJob.checkedThisRun += result.checked;
      saveCache(cache, { skipClusters: true });

      if (result.stopped === "rate_limited") {
        const nextRetry = getNextRetryTime();
        segmentRankJob.nextRetryAt = nextRetry.toISOString();
        segmentRankJob.mode = "waiting";
        segmentRankJob.message = `Rate limited (429). Waiting until ${nextRetry.toLocaleString()}`;
        continue;
      }
      if (result.stopped === "forbidden" || result.stopped === "error") {
        segmentRankJob.mode = "error";
        segmentRankJob.message = result.error;
        setSegmentRankError(result.error);
        return;
      }
      segmentRankJob.message = `Checked ${segmentRankJob.checkedThisRun} segments this run`;
      await sleep(500);
    }
  } catch (err) {
    console.error("[Segment Rank Job] Error:", err);
    segmentRankJob.mode = "error";
    segmentRankJob.message = `Error: ${err.message}`;
    try { setSegmentRankError(segmentRankJob.message); } catch (e) { /* ignore */ }
  } finally {
    segmentRankJob.running = false;
    if (segmentRankJob.stopRequested) {
      segmentRankJob.mode = "stopped";
      segmentRankJob.message = "Segment rank backfill stopped";
    }
  }
}

/* API */

// Resolve bike types at response time so existing caches and every analytics response carry them.
app.use("/api/analytics", (req, res, next) => {
  const json = res.json.bind(res);
  res.json = body => json(applyBikeTypes(body));
  next();
});

app.get("/api/analytics/auto", async (req, res) => {
  if (!access_token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const cache = ensureCacheShape(loadCache());

  if (cache) {
    return res.json({
      cached: true,
      ...cache,
      prBackfill: getPrBackfillStatus(),
      geoBackfillStatus: getGeoBackfillStatus(),
      segmentRankStatus: getSegmentRankStatus(),
      message: "Loaded from local cache.json"
    });
  }

  return res.json({
    cached: false,
    message: "No local data available — populate from the API."
  });
});

app.post("/api/pr-backfill/start", requireAdmin, async (req, res) => {
  if (!access_token) return res.status(401).json({ error: "Not authenticated" });

  const cache = ensureCacheShape(loadCache());
  if (!cache || !cache.activities || cache.activities.length === 0) {
    return res.status(400).json({ error: "No cache available. Run a full data pull first." });
  }

  if (geoBackfillJob.running) {
    return res.status(409).json({ error: "Geo backfill is running. Stop it before starting the PR backfill." });
  }

  if (prBackfillJob.running) {
    return res.json({
      ok: true,
      alreadyRunning: true,
      prBackfill: getPrBackfillStatus(),
      message: "PR backfill already running"
    });
  }

  prBackfillJob = {
    ...prBackfillJob,
    running: false,
    stopRequested: false,
    startedAt: new Date().toISOString(),
    lastRunAt: null,
    nextRetryAt: null,
    mode: "starting",
    message: "PR backfill starting",
    totalEligible: cache.segmentBackfill.totalEligible || 0,
    remaining: cache.segmentBackfill.remaining || 0,
    nextIndex: cache.segmentBackfill.nextIndex || 0,
    fetchedThisRun: 0,
    processed: 0,
    completed: false,
    batchSize: Number(req.query.batchSize || req.body?.batchSize || 25),
    reserve: Number(req.query.reserve || req.body?.reserve || 25),
    idlePasses: 0
  };

  runPrBackfillJobLoop();

  return res.json({
    ok: true,
    prBackfill: getPrBackfillStatus(),
    message: "PR backfill started"
  });
});

app.post("/api/pr-backfill/stop", requireAdmin, async (req, res) => {
  prBackfillJob.stopRequested = true;
  return res.json({
    ok: true,
    prBackfill: getPrBackfillStatus(),
    message: "PR backfill stop requested"
  });
});

app.get("/api/pr-backfill/status", requireAdmin, async (req, res) => {
  return res.json({
    ok: true,
    prBackfill: getPrBackfillStatus()
  });
});

app.post("/api/geo-backfill/start", requireAdmin, async (req, res) => {
  if (!access_token) return res.status(401).json({ error: "Not authenticated" });

  const cache = ensureCacheShape(loadCache());
  if (!cache.activities.length) {
    return res.status(400).json({ error: "No cache available. Run a full data pull first." });
  }
  if (geoBackfillJob.running) {
    return res.json({ ok: true, alreadyRunning: true, geoBackfill: getGeoBackfillStatus(), message: "Geo backfill already running" });
  }
  if (prBackfillJob.running) {
    return res.status(409).json({ error: "PR backfill is running. Stop it before starting the geo backfill." });
  }

  const restart = req.query.restart === "1" || (req.body && req.body.restart === true);
  const status = getGeoBackfillStatus();
  if (status.completed && !restart) {
    return res.json({ ok: true, geoBackfill: status, message: "Geo backfill already complete" });
  }
  if (restart || status.completed) {
    cache.geoBackfill = { nextPage: 1, completed: false, lastRunAt: cache.geoBackfill.lastRunAt, pagesDone: 0 };
    saveCache(cache, { skipClusters: true });
  }

  const reserve = Number(req.query.reserve || (req.body && req.body.reserve) || 25);
  geoBackfillJob = {
    ...geoBackfillJob,
    running: false,
    stopRequested: false,
    startedAt: new Date().toISOString(),
    nextRetryAt: null,
    mode: "starting",
    message: "Geo backfill starting",
    reserve: Number.isFinite(reserve) && reserve >= 0 ? reserve : 25
  };

  runGeoBackfillJobLoop();

  return res.json({ ok: true, geoBackfill: getGeoBackfillStatus(), message: "Geo backfill started" });
});

app.post("/api/geo-backfill/stop", requireAdmin, async (req, res) => {
  geoBackfillJob.stopRequested = true;
  return res.json({ ok: true, geoBackfill: getGeoBackfillStatus(), message: "Geo backfill stop requested" });
});

app.get("/api/geo-backfill/status", requireAdmin, async (req, res) => {
  return res.json({ ok: true, geoBackfill: getGeoBackfillStatus() });
});

app.post("/api/segment-ranks/start", requireAdmin, async (req, res) => {
  if (!access_token) return res.status(401).json({ error: "Not authenticated" });

  const cache = ensureCacheShape(loadCache());
  if (!cache.activities.length) {
    return res.status(400).json({ error: "No cache available. Run a full data pull first." });
  }
  if (segmentRankJob.running) {
    return res.json({ ok: true, alreadyRunning: true, segmentRanks: getSegmentRankStatus(), message: "Segment rank backfill already running" });
  }

  const body = req.body || {};
  const refresh = req.query.refresh === "1" || body.refresh === true;
  const reserve = Number(req.query.reserve || body.reserve || 25);
  const maxAge = Number(req.query.maxAgeDays || body.maxAgeDays || segmentRanks.DEFAULT_MAX_AGE_DAYS);
  segmentRankJob = {
    ...segmentRankJob,
    running: false,
    stopRequested: false,
    startedAt: new Date().toISOString(),
    nextRetryAt: null,
    mode: "starting",
    message: refresh ? "Segment rank refresh starting" : "Segment rank backfill starting",
    lastError: null,
    refresh,
    maxAgeDays: Number.isFinite(maxAge) && maxAge >= 0 ? maxAge : segmentRanks.DEFAULT_MAX_AGE_DAYS,
    reserve: Number.isFinite(reserve) && reserve >= 0 ? reserve : 25
  };

  runSegmentRankJobLoop();

  return res.json({ ok: true, segmentRanks: getSegmentRankStatus(), message: refresh ? "Segment rank refresh started" : "Segment rank backfill started" });
});

app.post("/api/segment-ranks/stop", requireAdmin, async (req, res) => {
  segmentRankJob.stopRequested = true;
  return res.json({ ok: true, segmentRanks: getSegmentRankStatus(), message: "Segment rank backfill stop requested" });
});

app.get("/api/segment-ranks/status", requireAdmin, async (req, res) => {
  return res.json({ ok: true, segmentRanks: getSegmentRankStatus() });
});

/* MATCHED RIDES */

app.get("/api/matched-rides", async (req, res) => {
  if (!access_token) return res.status(401).json({ error: "Not authenticated" });

  const period = req.query.period || "all";
  if (!["all", "year", "month"].includes(period)) {
    return res.status(400).json({ error: "period must be all, year or month" });
  }
  const type = req.query.type || "routes";
  if (!["routes", "segments"].includes(type)) {
    return res.status(400).json({ error: "type must be routes or segments" });
  }
  const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return res.status(400).json({ error: "limit must be an integer between 1 and 500" });
  }

  const opts = { limit };
  if (period !== "all" && req.query.year !== undefined) {
    const year = Number(req.query.year);
    if (!Number.isInteger(year) || year < 1970 || year > 3000) return res.status(400).json({ error: "year must be a 4 digit year" });
    opts.year = year;
  }
  if (period === "year" && opts.year === undefined) return res.status(400).json({ error: "year is required when period=year" });
  if (period === "month") {
    const month = Number(req.query.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) return res.status(400).json({ error: "month must be 1-12 when period=month" });
    opts.month = month;
  }

  const cache = ensureCacheShape(loadCache());
  const rows = type === "segments"
    ? routeMatching.segmentLeaderboard(cache.segmentData, {
        ...opts,
        excludedSegmentIds: loadSettings().excludedSegments || []
      })
    : routeMatching.routeLeaderboard(cache.routeClusters, cache.activities, opts);
  return res.json({ type, period, year: opts.year ?? null, month: opts.month ?? null, limit, rows, geoBackfill: getGeoBackfillStatus() });
});

app.post("/api/matched-rides/recompute", requireAdmin, async (req, res) => {
  const cache = ensureCacheShape(loadCache());
  if (!cache.activities.length) return res.status(400).json({ error: "No cache available. Run a full data pull first." });
  if (geoBackfillJob.running) return res.status(409).json({ error: "Geo backfill is running. Try again when it finishes." });
  cache.routeClusters = routeMatching.emptyRouteClusters();
  saveCache(cache); // rebuilds every cluster from scratch
  const clusters = cache.routeClusters.clusters;
  return res.json({
    ok: true,
    clusters: clusters.length,
    rides: Object.keys(cache.routeClusters.index).length,
    repeatedRoutes: clusters.filter(c => c.activityIds.length > 1).length,
    message: "Route clusters recomputed"
  });
});

app.get("/api/analytics", requireAdmin, async (req, res) => {
  if (!access_token) return res.status(401).json({ error: "Not authenticated" });

  const full = req.query.full === "1";
  const refresh = req.query.refresh === "1";
  const resume = req.query.resume === "1";
  const updated = req.query.updated === "1";
  const cache = ensureCacheShape(loadCache());
  const fetchSegments = req.query.segments === "1";

  requestCount = 0;
  const mode = full
    ? "FULL"
    : refresh
      ? (updated ? "REFRESH_UPDATED" : "REFRESH")
      : resume
        ? "RESUME"
        : "AUTO";

  console.log(`\n[API Call] Starting ${mode} pull. fetchSegments=${fetchSegments}`);

  if (full) {
    const allActivities = await fetchAllActivitiesOnce();

    if (!allActivities || allActivities.length === 0) {
      return res.json({
        error: "Strava returned no activities. Check authentication, scope, or rate limits."
      });
    }

    const segmentData = await fetchSegmentEffortsForActivities(allActivities, {}, fetchSegments);
    const { activityCounts, gearTotals, annualStats, bikeYearStats } = computeAnalytics(allActivities, segmentData);
    const gearDetails = await fetchMissingGearDetails({}, gearTotals);

    const newCache = setSegmentBackfillMeta({
      activities: allActivities,
      segmentData,
      segmentRanks: cache.segmentRanks,
      segmentRankMeta: cache.segmentRankMeta,
      activityCounts,
      gearTotals,
      gearDetails,
      annualStats,
      bikeYearStats
    }, {
      enabled: false,
      nextIndex: 0,
      completed: false,
      lastRunAt: null,
      totalEligible: allActivities.filter(a => a.sport_type === "Ride").length,
      fetchedThisRun: 0,
      remaining: allActivities.filter(a => a.sport_type === "Ride").length
    });

    saveCache(newCache);

    return res.json({
      cached: false,
      ...newCache,
      prBackfill: getPrBackfillStatus(),
      message: `Full data pull complete. (${requestCount} API calls, ${allActivities.length} activities)`
    });
  }

  if (resume) {
    if (!cache || !cache.activities || cache.activities.length === 0) {
      return res.json({ error: "No cache to resume from. Run a full pull first." });
    }

    const oldestCached = cache.activities[cache.activities.length - 1];
    const olderActivities = await fetchActivitiesBefore(oldestCached.start_date);

    if (!olderActivities || olderActivities.length === 0) {
      return res.json({
        cached: true,
        ...cache,
        prBackfill: getPrBackfillStatus(),
        message: "Resume: No older activities found. Cache appears complete."
      });
    }

    const allActivities = cache.activities.concat(olderActivities);
    const segmentData = await fetchSegmentEffortsForActivities(olderActivities, cache.segmentData || {}, fetchSegments);
    const { activityCounts, gearTotals, annualStats, bikeYearStats } = computeAnalytics(allActivities, segmentData);
    const gearDetails = await fetchMissingGearDetails(cache.gearDetails, gearTotals);

    const rideCount = allActivities.filter(a => a.sport_type === "Ride").length;
    const remaining = allActivities.filter(a => a.sport_type === "Ride" && !(a.id in segmentData)).length;

    const newCache = setSegmentBackfillMeta({
      ...cache,
      activities: allActivities,
      segmentData,
      activityCounts,
      gearTotals,
      gearDetails,
      annualStats,
      bikeYearStats
    }, {
      enabled: true,
      nextIndex: cache.segmentBackfill?.nextIndex || 0,
      completed: remaining === 0,
      lastRunAt: cache.segmentBackfill?.lastRunAt || null,
      totalEligible: rideCount,
      fetchedThisRun: 0,
      remaining
    });

    saveCache(newCache);

    return res.json({
      cached: false,
      ...newCache,
      prBackfill: getPrBackfillStatus(),
      message: `Resume complete. Added ${olderActivities.length} older activities. (${requestCount} API calls, ${allActivities.length} total activities)`
    });
  }

  if (!refresh && cache && cache.activities.length) {
    return res.json({
      cached: true,
      ...cache,
      prBackfill: getPrBackfillStatus(),
      message: `Loaded from cache.json (${cache.activities.length} activities)`
    });
  }

  if (!cache || !cache.activities || cache.activities.length === 0) {
    const allActivities = await fetchAllActivitiesOnce();

    if (!allActivities || allActivities.length === 0) {
      return res.json({
        error: "Strava returned no activities. Check authentication, scope, or rate limits."
      });
    }

    const segmentData = await fetchSegmentEffortsForActivities(allActivities, {}, fetchSegments);
    const { activityCounts, gearTotals, annualStats, bikeYearStats } = computeAnalytics(allActivities, segmentData);
    const gearDetails = await fetchMissingGearDetails({}, gearTotals);

    const rideCount = allActivities.filter(a => a.sport_type === "Ride").length;

    const newCache = setSegmentBackfillMeta({
      activities: allActivities,
      segmentData,
      segmentRanks: cache.segmentRanks,
      segmentRankMeta: cache.segmentRankMeta,
      activityCounts,
      gearTotals,
      gearDetails,
      annualStats,
      bikeYearStats
    }, {
      enabled: false,
      nextIndex: 0,
      completed: false,
      lastRunAt: null,
      totalEligible: rideCount,
      fetchedThisRun: 0,
      remaining: rideCount
    });

    saveCache(newCache);

    return res.json({
      cached: false,
      ...newCache,
      prBackfill: getPrBackfillStatus(),
      message: `Initial full fetch complete. (${requestCount} API calls, ${allActivities.length} activities)`
    });
  }

  if (updated) {
    const recentActivities = await fetchRecentActivitiesPage();
    const { changed, added } = findChangedActivities(recentActivities, cache.activities);

    if ((!recentActivities || recentActivities.length === 0) && (!added.length && !changed.length)) {
      return res.json({
        cached: true,
        ...cache,
        prBackfill: getPrBackfillStatus(),
        message: `No updated activities found. (${cache.activities.length} activities in cache)`
      });
    }

    const changedRideIds = changed
      .filter(activity => activity.sport_type === "Ride")
      .map(activity => activity.id);

    const previousRideIdsThatChanged = changed
      .map(activity => {
        const existing = (cache.activities || []).find(cached => String(cached.id) === String(activity.id));
        return existing?.sport_type === "Ride" ? existing.id : null;
      })
      .filter(Boolean);

    const segmentData = { ...(cache.segmentData || {}) };

    for (const id of previousRideIdsThatChanged) {
      delete segmentData[id];
    }

    const mergedActivities = mergeActivitiesById(recentActivities, cache.activities);

    const refreshedSegmentData = await fetchSegmentEffortsForActivities(
      changed,
      segmentData,
      fetchSegments,
      { forceActivityIds: changedRideIds }
    );

    const { activityCounts, gearTotals, annualStats, bikeYearStats } = computeAnalytics(mergedActivities, refreshedSegmentData);
    const gearDetails = await fetchMissingGearDetails(cache.gearDetails, gearTotals);

    const rideCount = mergedActivities.filter(a => a.sport_type === "Ride").length;
    const remaining = mergedActivities.filter(a => a.sport_type === "Ride" && !(a.id in refreshedSegmentData)).length;

    const newCache = setSegmentBackfillMeta({
      ...cache,
      activities: mergedActivities,
      segmentData: refreshedSegmentData,
      activityCounts,
      gearTotals,
      gearDetails,
      annualStats,
      bikeYearStats
    }, {
      enabled: true,
      nextIndex: cache.segmentBackfill?.nextIndex || 0,
      completed: remaining === 0,
      lastRunAt: cache.segmentBackfill?.lastRunAt || null,
      totalEligible: rideCount,
      fetchedThisRun: 0,
      remaining
    });

    saveCache(newCache);

    return res.json({
      cached: false,
      ...newCache,
      prBackfill: getPrBackfillStatus(),
      message: `Refresh complete. Added ${added.length} new and re-synced ${changed.length - added.length} updated activities. (${requestCount} API calls, ${mergedActivities.length} total)`
    });
  }

  const newestDate = cache.activities[0].start_date;
  const newActs = await fetchNewActivitiesSince(newestDate);

  if (!newActs || newActs.length === 0) {
    return res.json({
      cached: true,
      ...cache,
      prBackfill: getPrBackfillStatus(),
      message: `No new activities. (${cache.activities.length} activities in cache)`
    });
  }

  const allActivities = newActs.concat(cache.activities);
  const segmentData = await fetchSegmentEffortsForActivities(newActs, cache.segmentData || {}, fetchSegments);
  const { activityCounts, gearTotals, annualStats, bikeYearStats } = computeAnalytics(allActivities, segmentData);
  const gearDetails = await fetchMissingGearDetails(cache.gearDetails, gearTotals);

  const rideCount = allActivities.filter(a => a.sport_type === "Ride").length;
  const remaining = allActivities.filter(a => a.sport_type === "Ride" && !(a.id in segmentData)).length;

  const newCache = setSegmentBackfillMeta({
    ...cache,
    activities: allActivities,
    segmentData,
    activityCounts,
    gearTotals,
    gearDetails,
    annualStats,
    bikeYearStats
  }, {
    enabled: true,
    nextIndex: cache.segmentBackfill?.nextIndex || 0,
    completed: remaining === 0,
    lastRunAt: cache.segmentBackfill?.lastRunAt || null,
    totalEligible: rideCount,
    fetchedThisRun: 0,
    remaining
  });

  saveCache(newCache);

  res.json({
    cached: false,
    ...newCache,
    prBackfill: getPrBackfillStatus(),
    message: `Added ${newActs.length} new activities. (${requestCount} API calls, ${allActivities.length} total)`
  });
});

/* START */

/* BIKE IMAGES */

const path = require("path");
const BIKE_IMAGES_DIR = path.join(__dirname, "public", "images", "bikes");
const BIKE_MANIFEST_PATH = path.join(BIKE_IMAGES_DIR, "manifest.json");
const GEAR_ID_RE = /^[A-Za-z0-9_-]+$/;
const FILENAME_RE = /^[A-Za-z0-9_-]+\.(jpg|png|webp|gif)$/;
const IMAGE_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const bikeImageUpload = express.raw({ type: "image/*", limit: "15mb" });

function detectImageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  return null;
}

function readBikeManifest() {
  try {
    const data = JSON.parse(fs.readFileSync(BIKE_MANIFEST_PATH, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch (err) {
    return {};
  }
}

function writeBikeManifest(manifest) {
  fs.mkdirSync(BIKE_IMAGES_DIR, { recursive: true });
  const tmp = `${BIKE_MANIFEST_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
  fs.renameSync(tmp, BIKE_MANIFEST_PATH);
}

function bikeImageUrls(manifest, gearId) {
  return (manifest[gearId] || []).map(f => `/dashboard/images/bikes/${gearId}/${f}`);
}

function validateBikeImageRequest(req, res) {
  const { gearId } = req.params;
  if (!GEAR_ID_RE.test(gearId)) {
    res.status(400).json({ error: "Invalid gear id" });
    return null;
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(415).json({ error: "Body must be a jpeg, png, webp or gif image" });
    return null;
  }
  const mime = detectImageType(req.body);
  const declared = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!mime || !IMAGE_EXT[declared] || mime !== declared) {
    res.status(415).json({ error: "Unsupported or mismatched image type" });
    return null;
  }
  return { gearId, ext: IMAGE_EXT[mime] };
}

function resolveBikeImage(manifest, gearId, filename) {
  const name = path.basename(String(filename));
  if (!GEAR_ID_RE.test(gearId) || name !== filename || !FILENAME_RE.test(name)) return null;
  const list = manifest[gearId] || [];
  const index = list.indexOf(name);
  if (index === -1) return null;
  return { name, index, file: path.join(BIKE_IMAGES_DIR, gearId, name) };
}

app.get("/api/bike-images", (req, res) => {
  const manifest = readBikeManifest();
  const out = {};
  Object.keys(manifest).forEach(gid => {
    if (GEAR_ID_RE.test(gid)) out[gid] = bikeImageUrls(manifest, gid);
  });
  res.json(out);
});

app.post("/api/bike-images/:gearId", bikeImageUpload, (req, res) => {
  const v = validateBikeImageRequest(req, res);
  if (!v) return;
  try {
    const dir = path.join(BIKE_IMAGES_DIR, v.gearId);
    fs.mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${v.ext}`;
    fs.writeFileSync(path.join(dir, name), req.body);
    const manifest = readBikeManifest();
    manifest[v.gearId] = [...(manifest[v.gearId] || []), name];
    writeBikeManifest(manifest);
    res.status(201).json({ gearId: v.gearId, images: bikeImageUrls(manifest, v.gearId) });
  } catch (err) {
    console.error("Bike image upload failed:", err);
    res.status(500).json({ error: "Failed to save image" });
  }
});

app.put("/api/bike-images/:gearId/:filename", bikeImageUpload, (req, res) => {
  const manifest = readBikeManifest();
  const target = resolveBikeImage(manifest, req.params.gearId, req.params.filename);
  if (!target) return res.status(404).json({ error: "Image not found" });
  const v = validateBikeImageRequest(req, res);
  if (!v) return;
  try {
    const dir = path.join(BIKE_IMAGES_DIR, v.gearId);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${v.ext}`;
    fs.writeFileSync(path.join(dir, name), req.body);
    manifest[v.gearId][target.index] = name;
    writeBikeManifest(manifest);
    fs.rmSync(target.file, { force: true });
    res.json({ gearId: v.gearId, images: bikeImageUrls(manifest, v.gearId) });
  } catch (err) {
    console.error("Bike image replace failed:", err);
    res.status(500).json({ error: "Failed to replace image" });
  }
});

app.delete("/api/bike-images/:gearId/:filename", (req, res) => {
  const manifest = readBikeManifest();
  const target = resolveBikeImage(manifest, req.params.gearId, req.params.filename);
  if (!target) return res.status(404).json({ error: "Image not found" });
  try {
    manifest[req.params.gearId].splice(target.index, 1);
    if (!manifest[req.params.gearId].length) delete manifest[req.params.gearId];
    writeBikeManifest(manifest);
    fs.rmSync(target.file, { force: true });
    res.json({ gearId: req.params.gearId, images: bikeImageUrls(manifest, req.params.gearId) });
  } catch (err) {
    console.error("Bike image delete failed:", err);
    res.status(500).json({ error: "Failed to delete image" });
  }
});

app.use("/api/bike-images", (err, req, res, next) => {
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "Image exceeds 15 MB limit" });
  if (err) return res.status(400).json({ error: "Invalid request" });
  next();
});

const SETTINGS_FILE = require("path").join(__dirname, "settings.json");
const THEME_ID_RE = /^[a-z0-9-]{1,40}$/;
const MAX_HIDDEN_THEMES = 100;

function loadSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    console.error("Settings corrupted:", err);
    return {};
  }
}

function getRouteMatchingConfig() {
  try {
    return routeMatching.validateMatchConfig(loadSettings().routeMatching || {});
  } catch (err) {
    console.error("Invalid routeMatching settings; using defaults:", err.message);
    return {};
  }
}

function saveSettings(data) {
  const tmp = SETTINGS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, SETTINGS_FILE);
}

app.get("/api/settings", (req, res) => {
  const settings = loadSettings();
  const out = {};
  if (Array.isArray(settings.hiddenThemes)) {
    out.hiddenThemes = settings.hiddenThemes.filter(id => typeof id === "string" && THEME_ID_RE.test(id));
  } else {
    out.hiddenThemes = [];
  }
  res.json(Object.assign(out, {
    hasHiddenThemes: Array.isArray(settings.hiddenThemes),
    routeMatching: { ...routeMatching.DEFAULT_MATCH_CONFIG, ...getRouteMatchingConfig() }
  }));
});

app.put("/api/settings/route-matching", (req, res) => {
  let routeMatchingConfig;
  try {
    routeMatchingConfig = routeMatching.validateMatchConfig(req.body && req.body.routeMatching);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    const settings = loadSettings();
    settings.routeMatching = routeMatchingConfig;
    saveSettings(settings);
    const cache = loadCache();
    if (cache && Array.isArray(cache.activities)) {
      cache.routeClusters = routeMatching.emptyRouteClusters(routeMatchingConfig);
      saveCache(cache);
    }
    res.json({ routeMatching: { ...routeMatching.DEFAULT_MATCH_CONFIG, ...routeMatchingConfig } });
  } catch (err) {
    console.error("Failed to save route-matching settings:", err);
    res.status(500).json({ error: "Failed to save route-matching settings" });
  }
});

app.put("/api/settings/hidden-themes", (req, res) => {
  const list = req.body && req.body.hiddenThemes;
  if (!Array.isArray(list) || list.length > MAX_HIDDEN_THEMES ||
      !list.every(id => typeof id === "string" && THEME_ID_RE.test(id))) {
    return res.status(400).json({ error: "hiddenThemes must be an array of up to 100 theme IDs ([a-z0-9-], 1-40 chars)" });
  }
  try {
    const settings = loadSettings();
    settings.hiddenThemes = [...new Set(list)];
    saveSettings(settings);
    res.json({ hiddenThemes: settings.hiddenThemes });
  } catch (err) {
    console.error("Failed to save settings:", err);
    res.status(500).json({ error: "Failed to save settings" });
  }
});

const SEGMENT_ID_RE = /^\d{1,15}$/;
const MAX_EXCLUDED_SEGMENTS = 5000;

app.get("/api/settings/excluded-segments", (req, res) => {
  const stored = loadSettings().excludedSegments;
  const list = Array.isArray(stored) ? stored.filter(id => typeof id === "string" && SEGMENT_ID_RE.test(id)) : [];
  res.json({ excludedSegments: list });
});

app.put("/api/settings/excluded-segments", (req, res) => {
  const list = req.body && req.body.excludedSegments;
  if (!Array.isArray(list) || list.length > MAX_EXCLUDED_SEGMENTS ||
      !list.every(id => typeof id === "string" && SEGMENT_ID_RE.test(id))) {
    return res.status(400).json({ error: "excludedSegments must be an array of up to 5000 numeric segment ID strings" });
  }
  try {
    const settings = loadSettings();
    settings.excludedSegments = [...new Set(list)];
    saveSettings(settings);
    res.json({ excludedSegments: settings.excludedSegments });
  } catch (err) {
    console.error("Failed to save settings:", err);
    res.status(500).json({ error: "Failed to save settings" });
  }
});

const MAX_FOCUS_ENTRIES = 50;
const clamp01 = n => Math.min(1, Math.max(0, n));

function sanitizeBikePhotoPrefs(input) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  if (typeof input.cover === "string" && FILENAME_RE.test(input.cover)) out.cover = input.cover;
  const focus = {};
  if (input.focus && typeof input.focus === "object" && !Array.isArray(input.focus)) {
    Object.keys(input.focus).forEach(name => {
      const pt = input.focus[name];
      if (!FILENAME_RE.test(name) || !pt || typeof pt !== "object") return;
      if (typeof pt.x !== "number" || typeof pt.y !== "number" || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return;
      focus[name] = { x: clamp01(pt.x), y: clamp01(pt.y) };
    });
  }
  if (Object.keys(focus).length) out.focus = focus;
  return out;
}

app.get("/api/bike-photo-prefs", (req, res) => {
  const stored = loadSettings().bikePhotoPrefs;
  const out = {};
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    Object.keys(stored).forEach(gid => {
      if (!GEAR_ID_RE.test(gid)) return;
      const prefs = sanitizeBikePhotoPrefs(stored[gid]);
      if (prefs.cover || prefs.focus) out[gid] = prefs;
    });
  }
  res.json(out);
});

app.put("/api/bike-photo-prefs/:gearId", (req, res) => {
  const gearId = req.params.gearId;
  const body = req.body;
  if (!GEAR_ID_RE.test(gearId)) return res.status(400).json({ error: "Invalid gear id" });
  if (!body || typeof body !== "object" || Array.isArray(body)) return res.status(400).json({ error: "Body must be a JSON object" });
  const prefs = {};
  if (body.cover !== undefined && body.cover !== null) {
    if (typeof body.cover !== "string" || !FILENAME_RE.test(body.cover)) return res.status(400).json({ error: "cover must be null or a valid image filename" });
    prefs.cover = body.cover;
  }
  if (body.focus !== undefined) {
    const focus = body.focus;
    if (!focus || typeof focus !== "object" || Array.isArray(focus)) return res.status(400).json({ error: "focus must be an object keyed by image filename" });
    const names = Object.keys(focus);
    if (names.length > MAX_FOCUS_ENTRIES) return res.status(400).json({ error: `focus may have at most ${MAX_FOCUS_ENTRIES} entries` });
    const clean = {};
    for (const name of names) {
      const pt = focus[name];
      if (!FILENAME_RE.test(name)) return res.status(400).json({ error: "focus keys must be valid image filenames" });
      if (!pt || typeof pt !== "object" || typeof pt.x !== "number" || typeof pt.y !== "number" || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
        return res.status(400).json({ error: "focus values must be { x, y } with finite numbers" });
      }
      clean[name] = { x: clamp01(pt.x), y: clamp01(pt.y) };
    }
    if (names.length) prefs.focus = clean;
  }
  try {
    const settings = loadSettings();
    const all = settings.bikePhotoPrefs && typeof settings.bikePhotoPrefs === "object" && !Array.isArray(settings.bikePhotoPrefs) ? settings.bikePhotoPrefs : {};
    if (prefs.cover || prefs.focus) all[gearId] = prefs; else delete all[gearId];
    settings.bikePhotoPrefs = all;
    saveSettings(settings);
    res.json({ gearId, prefs });
  } catch (err) {
    console.error("Failed to save bike photo prefs:", err);
    res.status(500).json({ error: "Failed to save settings" });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
  const configured = Object.keys(bike_types).length;
  console.log(`[Config] Loaded ${configured} bike_types entries (restart the server after editing config.local.js).`);
  if (configured) {
    const cache = loadCache();
    const seen = new Set((cache?.activities || []).map(a => a.gear_id).filter(Boolean));
    Object.keys(cache?.gearDetails || {}).forEach(id => seen.add(id));
    if (seen.size) {
      const unmatched = findUnmatchedBikeTypes([...seen]);
      if (unmatched.length) console.warn(`[Config] bike_types ids not found in cache: ${unmatched.join(", ")}`);
    }
  }
});
