// Gear ids from Strava look like "b1234567". Users may write them with
// different case/whitespace, without the "b" prefix, or as a number.
function normalizeGearId(id) {
  if (id === null || id === undefined) return "";
  const s = String(id).trim().toLowerCase();
  if (!s) return "";
  return /^\d+$/.test(s) ? `b${s}` : s;
}

function normalizeBikeTypes(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, type] of Object.entries(raw)) {
    const key = normalizeGearId(id);
    const value = typeof type === "string" ? type.trim() : "";
    if (key && value) out[key] = value;
  }
  return out;
}

function createBikeTypeResolver(rawTypes) {
  const types = normalizeBikeTypes(rawTypes);
  const getBikeType = gearId => types[normalizeGearId(gearId)] || "unknown";

  // Resolved at response time so caches saved before bike_types existed work.
  function applyBikeTypes(payload) {
    if (!payload || typeof payload !== "object") return payload;
    const out = { ...payload };
    const details = out.gearDetails && typeof out.gearDetails === "object" ? out.gearDetails : null;
    if (details) {
      out.gearDetails = {};
      for (const [gid, d] of Object.entries(details)) {
        const type = getBikeType(gid);
        out.gearDetails[gid] = { ...(d || {}), bike_type: type, bikeType: type };
      }
    }
    if (Array.isArray(out.activities)) {
      out.activities = out.activities.map(a => ({
        ...a,
        bike_type: getBikeType(a.gear_id),
        bike_name: a.gear_id ? details?.[a.gear_id]?.name || a.gear_id : null
      }));
    }
    return out;
  }

  function findUnmatched(gearIds) {
    const seen = new Set((gearIds || []).map(normalizeGearId));
    return Object.keys(types).filter(id => !seen.has(id));
  }

  return { types, getBikeType, applyBikeTypes, findUnmatched };
}

module.exports = { normalizeGearId, normalizeBikeTypes, createBikeTypeResolver };
