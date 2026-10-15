// All calls use relative URLs so the app always talks to the server that served it.

export class ApiError extends Error {
  constructor(message, { status, unauthenticated } = {}) {
    super(message);
    this.status = status;
    this.unauthenticated = Boolean(unauthenticated);
  }
}

const ADMIN_PW_KEY = "adminPw";

/** fetch() for Data / Admin endpoints: sends the shared admin password (prompted once, kept in localStorage). */
export async function adminFetch(url, options = {}) {
  let pw = null;
  try { pw = localStorage.getItem(ADMIN_PW_KEY); } catch { /* storage unavailable */ }
  if (!pw) {
    pw = window.prompt("Admin password:");
    if (!pw) throw new ApiError("Admin password required.", { status: 401 });
    try { localStorage.setItem(ADMIN_PW_KEY, pw); } catch { /* storage unavailable */ }
  }
  const res = await fetch(url, { ...options, headers: { ...(options.headers || {}), "x-admin-password": pw } });
  if (res.status === 401) {
    const body = await res.clone().json().catch(() => null);
    if (body?.error === "Unauthorized") {
      try { localStorage.removeItem(ADMIN_PW_KEY); } catch { /* ignore */ }
      throw new ApiError("Wrong password", { status: 401 });
    }
  }
  return res;
}

async function request(url, options, fetcher = fetch) {
  let res;
  try {
    res = await fetcher(url, options);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("Could not reach the server. Is `node server.js` running?");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (res.status === 429) throw new ApiError(data?.error || "Too many attempts", { status: 429 });
  if (res.status === 401) throw new ApiError(data?.error || "Not authenticated", { status: 401, unauthenticated: true });
  if (!res.ok && !data) throw new ApiError(`Request failed (${res.status})`, { status: res.status });
  return { data: data || {}, ok: res.ok, status: res.status };
}

export async function fetchAnalyticsAuto() {
  const { data } = await request("/api/analytics/auto");
  return data;
}

export const PULLS = {
  refresh: "/api/analytics?refresh=1&segments=1&updated=1",
  resume: "/api/analytics?resume=1",
  full: "/api/analytics?full=1"
};

export async function runPull(kind) {
  const { data } = await request(PULLS[kind], undefined, adminFetch);
  if (data.error) throw new ApiError(data.error);
  return data;
}

export async function fetchPrBackfillStatus() {
  const { data } = await request("/api/pr-backfill/status", undefined, adminFetch);
  return data.prBackfill;
}

export async function startPrBackfill() {
  const { data } = await request("/api/pr-backfill/start", { method: "POST" }, adminFetch);
  if (data.error) throw new ApiError(data.error);
  return data;
}

export async function stopPrBackfill() {
  const { data } = await request("/api/pr-backfill/stop", { method: "POST" }, adminFetch);
  return data;
}

export async function fetchGeoBackfillStatus() {
  const { data } = await request("/api/geo-backfill/status", undefined, adminFetch);
  return data.geoBackfill;
}

export async function startGeoBackfill() {
  const { data } = await request("/api/geo-backfill/start", { method: "POST" }, adminFetch);
  if (data.error) throw new ApiError(data.error);
  return data;
}

export async function stopGeoBackfill() {
  const { data } = await request("/api/geo-backfill/stop", { method: "POST" }, adminFetch);
  return data;
}

export async function fetchSegmentRankStatus() {
  const { data } = await request("/api/segment-ranks/status", undefined, adminFetch);
  return data.segmentRanks;
}

export async function startSegmentRanks({ refresh = false } = {}) {
  const { data } = await request(`/api/segment-ranks/start${refresh ? "?refresh=1" : ""}`, { method: "POST" }, adminFetch);
  if (data.error) throw new ApiError(data.error);
  return data;
}

export async function stopSegmentRanks() {
  const { data } = await request("/api/segment-ranks/stop", { method: "POST" }, adminFetch);
  return data;
}

export async function recomputeMatchedRides() {
  const { data } = await request("/api/matched-rides/recompute", { method: "POST" }, adminFetch);
  if (data.error) throw new ApiError(data.error);
  return data;
}

export async function fetchFeaturedActivities() {
  try {
    const res = await fetch("/dashboard/featured-activities.json", { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/* Bike images: raw image body with the file's Content-Type. */
export const BIKE_IMAGES_API = "/api/bike-images";
export const BIKE_MAX_BYTES = 15 * 1024 * 1024;

export async function fetchBikeImages() {
  try {
    const res = await fetch(BIKE_IMAGES_API);
    return res.ok ? await res.json() : {};
  } catch (err) {
    console.warn("Could not load bike images", err);
    return {};
  }
}

export async function bikeImageRequest(method, gid, filename, file) {
  const url = `${BIKE_IMAGES_API}/${encodeURIComponent(gid)}${filename ? `/${encodeURIComponent(filename)}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: file ? { "Content-Type": file.type, "X-Filename": encodeURIComponent(file.name) } : {},
    body: file || undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* Bike photo prefs (cover + focal point), stored server-side in settings.json. */
export const BIKE_PHOTO_PREFS_API = "/api/bike-photo-prefs";

export async function fetchBikePhotoPrefs() {
  try {
    const res = await fetch(BIKE_PHOTO_PREFS_API);
    const data = res.ok ? await res.json() : {};
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch (err) {
    console.warn("Could not load bike photo prefs", err);
    return {};
  }
}

export async function saveBikePhotoPrefs(gid, prefs) {
  const res = await fetch(`${BIKE_PHOTO_PREFS_API}/${encodeURIComponent(gid)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const EXCLUDED_SEGMENTS_API = "/api/settings/excluded-segments";

export async function fetchExcludedSegments() {
  try {
    const res = await fetch(EXCLUDED_SEGMENTS_API);
    const data = res.ok ? await res.json() : {};
    return Array.isArray(data.excludedSegments) ? data.excludedSegments : [];
  } catch (err) {
    console.warn("Could not load excluded segments", err);
    return [];
  }
}

export async function saveExcludedSegments(list) {
  const res = await fetch(EXCLUDED_SEGMENTS_API, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ excludedSegments: list })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
