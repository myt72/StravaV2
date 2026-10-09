// Unit conversions and formatting, matching V1 conventions (API distances are meters).
export const comma = x => Number(x).toLocaleString("en-US");
export const miles = meters => (meters || 0) / 1609.34;
export const feet = meters => (meters || 0) * 3.28084;

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function formatDate(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

export const formatShortDate = formatDate;

export function formatDateTime(dateStr) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleString();
}

export function formatYearsBetween(startDate, endDate) {
  if (!startDate || !endDate) return "-";
  const years = (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  return `${years.toFixed(1)} years`;
}

export function formatDayDifference(startDate, endDate) {
  if (!startDate || !endDate) return "-";
  const start = new Date(startDate);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  const diffDays = Math.round((end - start) / 86400000);
  return `${comma(diffDays)} day${diffDays === 1 ? "" : "s"}`;
}

export function formatDateRange(start, end) {
  if (!start || !end) return "—";
  return `${formatDate(`${start}T00:00:00`)} – ${formatDate(`${end}T00:00:00`)}`;
}

export function formatSpeed(avgSpeedMph, sportType = "Ride") {
  if (!avgSpeedMph || avgSpeedMph <= 0) return null;
  if (sportType === "Run" || sportType === "Walk") {
    const pace = 60 / avgSpeedMph;
    const paceMin = Math.floor(pace);
    const paceSec = Math.round((pace - paceMin) * 60);
    return `avg ${paceMin}:${String(paceSec).padStart(2, "0")} min/mi pace`;
  }
  return `avg ${avgSpeedMph.toFixed(1)} mph`;
}

export const fmtMiles = meters => `${comma(miles(meters).toFixed(1))} mi`;
export const fmtFeet = meters => `${comma(feet(meters).toFixed(0))} ft`;

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const formatMonthLabel = monthIndex => MONTHS[monthIndex];

export function getDateKey(dateStr) {
  const d = new Date(dateStr);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function getWeekStartMonday(dateStr) {
  const d = new Date(dateStr);
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = local.getDay();
  local.setDate(local.getDate() + (day === 0 ? -6 : 1 - day));
  local.setHours(0, 0, 0, 0);
  return local;
}

export function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

export function getMondayForIsoWeek(year, isoWeek) {
  const simple = new Date(year, 0, 1 + (isoWeek - 1) * 7);
  const day = simple.getDay();
  const isoMonday = new Date(simple);
  if (day <= 4 && day !== 0) isoMonday.setDate(simple.getDate() - day + 1);
  else if (day === 0) isoMonday.setDate(simple.getDate() - 6);
  else isoMonday.setDate(simple.getDate() + (8 - day));
  isoMonday.setHours(0, 0, 0, 0);
  return isoMonday;
}

export const getGearName = (gearDetails, gearId) => {
  if (!gearId) return "-";
  return gearDetails?.[gearId]?.name || gearId;
};

export const formatActivityTitle = activity => (activity ? activity.name || activity.sport_type || "Activity" : "-");

export function isValidHttpUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function extractStravaActivityId(activityUrl) {
  if (!activityUrl) return null;
  const match = String(activityUrl).match(/strava\.com\/activities\/(\d+)/i);
  return match ? match[1] : null;
}

export const getStravaSegmentUrl = segmentId => `https://www.strava.com/segments/${segmentId}`;
