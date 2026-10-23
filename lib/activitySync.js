/* Change detection for incoming vs cached activities. */

function activitySignature(activity, { includeGeo = true, includeElapsed = true } = {}) {
  if (!activity) return "";
  const geo = includeGeo
    ? { summary_polyline: activity.summary_polyline, start_latlng: activity.start_latlng, end_latlng: activity.end_latlng }
    : {};
  const elapsed = includeElapsed ? { elapsed_time: activity.elapsed_time } : {};
  return JSON.stringify({
    id: activity.id,
    name: activity.name,
    sport_type: activity.sport_type,
    distance: activity.distance,
    moving_time: activity.moving_time,
    ...elapsed,
    total_elevation_gain: activity.total_elevation_gain,
    start_date: activity.start_date,
    gear_id: activity.gear_id,
    ...geo
  });
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

    // Legacy cached activities lack geo/elapsed fields; don't treat that as a change (it would re-fetch segment data).
    const includeGeo = existing.summary_polyline !== undefined;
    const includeElapsed = existing.elapsed_time !== undefined;
    if (
      activitySignature(activity, { includeGeo, includeElapsed }) !==
      activitySignature(existing, { includeGeo, includeElapsed })
    ) {
      changed.push(activity);
    }
  }

  return { changed, added };
}

module.exports = { activitySignature, findChangedActivities };
