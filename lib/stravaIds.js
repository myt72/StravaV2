function stravaActivityId(activity) {
  if (!activity) return null;
  const id = activity.id_str ?? activity.id;
  if (id == null) return null;
  if (typeof id === "number" && !Number.isSafeInteger(id)) {
    throw new RangeError("Strava activity id is unsafe; id_str is required");
  }
  if (typeof id !== "string" && typeof id !== "number") {
    throw new TypeError("Strava activity id must be a string or number");
  }
  return String(id);
}

module.exports = { stravaActivityId };
