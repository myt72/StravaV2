// All calls use relative URLs so the app always talks to the server that served it.

export class ApiError extends Error {
  constructor(message, { status, unauthenticated } = {}) {
    super(message);
    this.status = status;
    this.unauthenticated = Boolean(unauthenticated);
  }
}

async function request(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    throw new ApiError("Could not reach the server. Is `node server.js` running?");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
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
  const { data } = await request(PULLS[kind]);
  if (data.error) throw new ApiError(data.error);
  return data;
}

export async function fetchPrBackfillStatus() {
  const { data } = await request("/api/pr-backfill/status");
  return data.prBackfill;
}

export async function startPrBackfill() {
  const { data } = await request("/api/pr-backfill/start", { method: "POST" });
  if (data.error) throw new ApiError(data.error);
  return data;
}

export async function stopPrBackfill() {
  const { data } = await request("/api/pr-backfill/stop", { method: "POST" });
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
