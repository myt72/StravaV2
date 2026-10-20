// Ported from V1 public/app.js so numbers match. Pure functions only.
import {
  miles, feet, comma, formatDuration, getDateKey, getWeekStartMonday, getWeekNumber,
  formatDate, formatShortDate, formatMonthLabel, getGearName, MONTHS
} from "./format.js";

export const EXCLUDED_HIGHEST_ELEVATION_ACTIVITY_ID = "1380665549";

/* ---------- filters ---------- */

export function applyGlobalFilters(rawData, { dateRange, activityType, bike }) {
  let activities = [...(rawData.activities || [])];

  if (dateRange !== "all") {
    const cutoff = Date.now() - Number(dateRange) * 86400000;
    activities = activities.filter(a => new Date(a.start_date).getTime() >= cutoff);
  }
  if (activityType !== "all") activities = activities.filter(a => a.sport_type === activityType);
  if (bike !== "all") activities = activities.filter(a => a.gear_id === bike);

  const segmentData = rawData.segmentData || {};
  return {
    ...rawData,
    activities,
    activityCounts: buildActivityCountsFromActivities(activities),
    gearTotals: buildGearTotalsFromActivities(activities, segmentData),
    bikeYearStats: buildBikeYearStatsFromActivities(activities, segmentData),
    gearDetails: rawData.gearDetails || {},
    annualStats: buildAnnualStatsSimple(activities)
  };
}

export function buildActivityCountsFromActivities(activities) {
  const counts = {};
  (activities || []).forEach(a => {
    if (!a?.sport_type) return;
    counts[a.sport_type] = (counts[a.sport_type] || 0) + 1;
  });
  return counts;
}

const prCountFor = (segmentData, a) =>
  segmentData && a.id in segmentData ? (segmentData[a.id] || []).filter(e => e.pr_rank === 1).length : 0;

export function buildGearTotalsFromActivities(activities, segmentData) {
  const gearTotals = {};
  (activities || []).forEach(a => {
    if (!a?.gear_id) return;
    if (!gearTotals[a.gear_id]) {
      gearTotals[a.gear_id] = { distance: 0, elevation: 0, count: 0, moving_time: 0, pr_count: 0 };
    }
    const g = gearTotals[a.gear_id];
    g.distance += a.distance || 0;
    g.elevation += a.total_elevation_gain || 0;
    g.count += 1;
    g.moving_time += a.moving_time || 0;
    g.pr_count += prCountFor(segmentData, a);
  });

  Object.values(gearTotals).forEach(gt => {
    if (gt.moving_time > 0 && gt.distance > 0) {
      const distMiles = gt.distance / 1609.34;
      gt.avg_speed_mph = distMiles / (gt.moving_time / 3600);
      gt.avg_pace_min_per_mi = (gt.moving_time / 60) / distMiles;
    }
  });
  return gearTotals;
}

export function buildBikeYearStatsFromActivities(activities, segmentData) {
  const bikeYearStats = {};

  (activities || []).forEach(a => {
    if (!a?.gear_id) return;
    const year = new Date(a.start_date).getFullYear();
    const weekStart = getWeekStartMonday(a.start_date);
    const weekKey = String(getWeekNumber(weekStart));

    if (!bikeYearStats[a.gear_id]) bikeYearStats[a.gear_id] = {};
    if (!bikeYearStats[a.gear_id][year]) {
      bikeYearStats[a.gear_id][year] = { distance: 0, elevation: 0, count: 0, moving_time: 0, pr_count: 0, weeks: {} };
    }

    const y = bikeYearStats[a.gear_id][year];
    y.distance += a.distance || 0;
    y.elevation += a.total_elevation_gain || 0;
    y.count += 1;
    y.moving_time += a.moving_time || 0;
    y.pr_count += prCountFor(segmentData, a);

    if (!y.weeks[weekKey]) {
      y.weeks[weekKey] = { distance: 0, elevation: 0, count: 0, moving_time: 0, trend: 0, week_start: weekStart.toISOString() };
    }
    const w = y.weeks[weekKey];
    w.distance += a.distance || 0;
    w.elevation += a.total_elevation_gain || 0;
    w.count += 1;
    w.moving_time += a.moving_time || 0;
  });

  Object.values(bikeYearStats).forEach(years => {
    Object.values(years).forEach(y => {
      if (y.moving_time > 0 && y.distance > 0) {
        y.avg_speed_mph = (y.distance / 1609.34) / (y.moving_time / 3600);
      }
      const weekNums = Object.keys(y.weeks).map(Number).sort((a, b) => a - b);
      weekNums.forEach((wk, idx) => {
        const curr = y.weeks[String(wk)];
        const prev = idx > 0 ? y.weeks[String(weekNums[idx - 1])] : null;
        curr.trend = prev && prev.distance > 0 ? (curr.distance - prev.distance) / prev.distance : 0;
      });
    });
  });
  return bikeYearStats;
}

export function buildAnnualStatsSimple(activities) {
  const annualStats = {};
  (activities || []).forEach(a => {
    const year = new Date(a.start_date).getFullYear();
    if (!annualStats[year]) annualStats[year] = { distance: 0, elevation: 0, count: 0 };
    annualStats[year].distance += a.distance || 0;
    annualStats[year].elevation += a.total_elevation_gain || 0;
    annualStats[year].count += 1;
  });
  return annualStats;
}

/* ---------- streaks ---------- */

export function computeMaxStreak(dateKeys) {
  return computeLongestStreakDetails(dateKeys).length;
}

export function computeLongestStreakDetails(dateKeys) {
  const sorted = [...new Set(dateKeys)].sort();
  if (!sorted.length) return { length: 0, start: null, end: null };

  let best = { length: 1, start: sorted[0], end: sorted[0] };
  let current = { ...best };

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(`${sorted[i - 1]}T00:00:00`);
    const curr = new Date(`${sorted[i]}T00:00:00`);
    const diffDays = Math.round((curr - prev) / 86400000);
    if (diffDays === 1) {
      current.length += 1;
      current.end = sorted[i];
    } else {
      current = { length: 1, start: sorted[i], end: sorted[i] };
    }
    if (current.length > best.length) best = { ...current };
  }
  return best;
}

export function computeLongestGapDetails(dateKeys) {
  const sorted = [...new Set(dateKeys)].sort();
  let best = { length: 0, start: null, end: null };

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(`${sorted[i - 1]}T00:00:00`);
    const curr = new Date(`${sorted[i]}T00:00:00`);
    const gapDays = Math.round((curr - prev) / 86400000) - 1;
    if (gapDays > best.length) {
      const gapStart = new Date(prev);
      gapStart.setDate(gapStart.getDate() + 1);
      const gapEnd = new Date(curr);
      gapEnd.setDate(gapEnd.getDate() - 1);
      best = { length: gapDays, start: getDateKey(gapStart), end: getDateKey(gapEnd) };
    }
  }
  return best;
}

export function buildKpis(activities, gearTotals) {
  const sum = key => activities.reduce((s, a) => s + (a[key] || 0), 0);
  const allDayKeys = activities.map(a => getDateKey(a.start_date));
  const rideDayKeys = activities.filter(a => a.sport_type === "Ride").map(a => getDateKey(a.start_date));
  return {
    count: activities.length,
    distance: sum("distance"),
    elevation: sum("total_elevation_gain"),
    movingTime: sum("moving_time"),
    activeBikes: Object.keys(gearTotals || {}).length,
    longestRideStreak: computeLongestStreakDetails(rideDayKeys),
    longestActivityStreak: computeLongestStreakDetails(allDayKeys),
    longestOffBikeStreak: computeLongestGapDetails(rideDayKeys)
  };
}

/* ---------- metrics ---------- */

export const METRICS = {
  distance: { label: "Distance", unit: "mi", value: a => miles(a.distance || 0), fmt: v => `${comma(v.toFixed(1))} mi` },
  elevation: { label: "Elevation", unit: "ft", value: a => feet(a.total_elevation_gain || 0), fmt: v => `${comma(v.toFixed(0))} ft` },
  moving_time: { label: "Moving time", unit: "h", value: a => (a.moving_time || 0) / 3600, fmt: v => `${v.toFixed(1)} h` },
  count: { label: "Activities", unit: "", value: () => 1, fmt: v => comma(v) }
};

export function sumMetric(activities, metric) {
  const m = METRICS[metric] || METRICS.distance;
  return activities.reduce((s, a) => s + m.value(a), 0);
}

/* ---------- patterns ---------- */

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const TIME_OF_DAY = [
  { label: "Early AM", start: 0, end: 6 },
  { label: "Morning", start: 6, end: 12 },
  { label: "Afternoon", start: 12, end: 17 },
  { label: "Evening", start: 17, end: 21 },
  { label: "Night", start: 21, end: 24 }
];

export const weekdayIndex = date => (date.getDay() === 0 ? 6 : date.getDay() - 1);
export const timeOfDayLabel = date => {
  const hour = date.getHours();
  return (TIME_OF_DAY.find(g => hour >= g.start && hour < g.end) || {}).label;
};

export function buildWeekdayBreakdown(activities, metric) {
  const map = WEEKDAYS.map(label => ({ label, value: 0 }));
  (activities || []).forEach(a => {
    map[weekdayIndex(new Date(a.start_date))].value += (METRICS[metric] || METRICS.count).value(a);
  });
  return map;
}

export function buildTimeOfDayBreakdown(activities, metric) {
  const groups = TIME_OF_DAY.map(g => ({ ...g, value: 0 }));
  (activities || []).forEach(a => {
    const bucket = groups.find(g => g.label === timeOfDayLabel(new Date(a.start_date)));
    if (bucket) bucket.value += (METRICS[metric] || METRICS.count).value(a);
  });
  return groups;
}

/** Most recent 12 months that have activities, oldest first. */
export function buildMonthlyTrend(activities, metric) {
  const months = {};
  (activities || []).forEach(a => {
    const d = new Date(a.start_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!months[key]) {
      months[key] = {
        key,
        label: `${formatMonthLabel(d.getMonth())} ${d.getFullYear()}`,
        sortKey: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
        value: 0
      };
    }
    months[key].value += (METRICS[metric] || METRICS.count).value(a);
  });
  return Object.values(months).sort((a, b) => b.sortKey - a.sortKey).slice(0, 12).reverse();
}

/** Per-year, per-month values for year-over-year lines. */
export function buildYearOverYear(activities, metric, cumulative = false) {
  const years = {};
  (activities || []).forEach(a => {
    const d = new Date(a.start_date);
    const y = d.getFullYear();
    if (!years[y]) years[y] = Array(12).fill(0);
    years[y][d.getMonth()] += (METRICS[metric] || METRICS.count).value(a);
  });
  const yearList = Object.keys(years).map(Number).sort((a, b) => a - b);
  const now = new Date();
  const rows = Array.from({ length: 12 }, (_, m) => ({ label: formatMonthLabel(m) }));
  yearList.forEach(y => {
    let run = 0;
    for (let m = 0; m < 12; m++) {
      if (y === now.getFullYear() && m > now.getMonth()) { rows[m][y] = null; continue; }
      run += years[y][m];
      rows[m][y] = cumulative ? run : years[y][m];
    }
  });
  return { years: yearList, rows };
}

/** ISO week (Monday start) and ISO week-year for a date; Dec 29-31 may belong to week 1 of the next year. */
function isoWeekParts(d) {
  const thursday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  thursday.setDate(thursday.getDate() + 4 - (thursday.getDay() || 7));
  return { isoYear: thursday.getFullYear(), week: getWeekNumber(d) };
}

function isoWeeksInYear(y) {
  return getWeekNumber(new Date(y, 11, 28));
}

/** Per-ISO-week-year values for year-over-year lines; rows are keyed by week number (1..53) with label "Wk N". */
export function buildYearOverYearWeekly(activities, metric) {
  const years = {};
  (activities || []).forEach(a => {
    const { isoYear, week } = isoWeekParts(new Date(a.start_date));
    if (!years[isoYear]) years[isoYear] = Array(54).fill(0);
    years[isoYear][week] += (METRICS[metric] || METRICS.count).value(a);
  });
  const yearList = Object.keys(years).map(Number).sort((a, b) => a - b);
  const now = isoWeekParts(new Date());
  const rows = Array.from({ length: 53 }, (_, i) => ({ label: `Wk ${i + 1}`, week: i + 1 }));
  yearList.forEach(y => {
    const last = y === now.isoYear ? now.week : isoWeeksInYear(y);
    for (let w = 1; w <= 53; w++) rows[w - 1][y] = w > last ? null : years[y][w];
  });
  return { years: yearList, rows };
}

/**
 * Rank years by value at one x position (highest = rank 1; ties share a rank, competition ranking 1,1,3).
 * Input: { [year]: number | null }. Returns { ranked: [{ year, value, rank, diff, pct }], missing: [year] }.
 * diff/pct are relative to the leader (0 for the leader; pct is null when the leader's value is 0).
 */
export function rankYearValues(valuesByYear) {
  const entries = Object.entries(valuesByYear || {}).map(([year, value]) => ({ year: Number(year), value }));
  const present = entries.filter(e => typeof e.value === "number" && Number.isFinite(e.value))
    .sort((a, b) => b.value - a.value || b.year - a.year);
  const missing = entries.filter(e => !present.includes(e)).map(e => e.year).sort((a, b) => b - a);
  const top = present.length ? present[0].value : 0;
  let rank = 0;
  const ranked = present.map((e, i) => {
    if (i === 0 || e.value !== present[i - 1].value) rank = i + 1;
    return { year: e.year, value: e.value, rank, diff: e.value - top, pct: top ? ((e.value - top) / top) * 100 : null };
  });
  return { ranked, missing };
}

/* ---------- annual ---------- */

export function buildAnnualBreakdowns(activities) {
  const annual = {};
  let totalDistance = 0, totalElevation = 0, totalCount = 0, totalMovingTime = 0;

  for (const a of activities) {
    const year = new Date(a.start_date).getFullYear();
    if (!annual[year]) {
      annual[year] = { distance: 0, elevation: 0, count: 0, moving_time: 0, dayKeys: [], maxRideDistance: 0, maxRideElevation: 0 };
    }
    const y = annual[year];
    y.distance += a.distance || 0;
    y.elevation += a.total_elevation_gain || 0;
    y.count += 1;
    y.moving_time += a.moving_time || 0;
    y.dayKeys.push(getDateKey(a.start_date));
    y.maxRideDistance = Math.max(y.maxRideDistance, a.distance || 0);
    y.maxRideElevation = Math.max(y.maxRideElevation, a.total_elevation_gain || 0);

    totalDistance += a.distance || 0;
    totalElevation += a.total_elevation_gain || 0;
    totalCount += 1;
    totalMovingTime += a.moving_time || 0;
  }

  Object.values(annual).forEach(y => {
    y.activeDaysCount = new Set(y.dayKeys).size;
    y.maxStreak = computeMaxStreak(y.dayKeys);
  });
  return { annual, totalDistance, totalElevation, totalCount, totalMovingTime };
}

/** Aggregate of ALL activities passed in, shaped like a buildAnnualBreakdowns year row. */
export function buildAnnualTotals(activities) {
  const t = { distance: 0, elevation: 0, count: 0, moving_time: 0, maxRideDistance: 0, maxRideElevation: 0 };
  const dayKeys = [];
  for (const a of activities || []) {
    t.distance += a.distance || 0;
    t.elevation += a.total_elevation_gain || 0;
    t.count += 1;
    t.moving_time += a.moving_time || 0;
    t.maxRideDistance = Math.max(t.maxRideDistance, a.distance || 0);
    t.maxRideElevation = Math.max(t.maxRideElevation, a.total_elevation_gain || 0);
    dayKeys.push(getDateKey(a.start_date));
  }
  t.activeDaysCount = new Set(dayKeys).size;
  t.maxStreak = computeMaxStreak(dayKeys);
  return t;
}

/**
 * Nested rows for the annual summary.
 * mode: "monthly" | "weekly" | "bike" (V1 annualBreakdownMode values).
 * Pass one year's activities for a year row, or all activities with combineYears for the Totals row
 * (monthly = Jan..Dec combined across years; weekly is not supported when combined and returns []).
 * Weeks are keyed by their Monday (YYYY-MM-DD) so rows always sum to their parent; trend is the
 * percent change in distance vs the previous week that has data (null when there is none), as in V1.
 * Months get the same trend (distance vs the previous month with data); pass trendActivities (the full
 * selection, all years) so January can compare with the previous December. Not computed with combineYears.
 */
export function buildAnnualSubRows(activities, mode, { segmentData = {}, gearName = id => id, combineYears = false, trendActivities = null } = {}) {
  const buckets = new Map();
  const bucketFor = (key, extra) => {
    if (!buckets.has(key)) {
      buckets.set(key, { key, ...extra, distance: 0, elevation: 0, count: 0, moving_time: 0, pr_count: 0, maxRideDistance: 0, maxRideElevation: 0, days: new Set() });
    }
    return buckets.get(key);
  };

  for (const a of activities || []) {
    let b;
    if (mode === "monthly") {
      const d = new Date(a.start_date);
      const mi = d.getMonth();
      const monthKey = `${d.getFullYear()}-${String(mi + 1).padStart(2, "0")}`;
      b = combineYears ? bucketFor(String(mi).padStart(2, "0"), { label: MONTHS[mi] })
        : bucketFor(monthKey, { label: MONTHS[mi], monthKey });
    } else if (mode === "weekly") {
      if (combineYears) return [];
      const ws = getWeekStartMonday(a.start_date);
      const weekStart = getDateKey(ws);
      b = bucketFor(weekStart, { label: formatDate(ws), weekStart });
    } else {
      const gearId = a.gear_id || null;
      b = bucketFor(gearId || "none", { label: gearId ? gearName(gearId) : "No bike", gearId });
    }
    b.distance += a.distance || 0;
    b.elevation += a.total_elevation_gain || 0;
    b.count += 1;
    b.moving_time += a.moving_time || 0;
    b.pr_count += prCountFor(segmentData, a);
    b.maxRideDistance = Math.max(b.maxRideDistance, a.distance || 0);
    b.maxRideElevation = Math.max(b.maxRideElevation, a.total_elevation_gain || 0);
    b.days.add(getDateKey(a.start_date));
  }

  const rows = [...buckets.values()].map(({ days, ...r }) => {
    r.activeDaysCount = days.size;
    r.maxStreak = computeMaxStreak([...days]);
    if (r.moving_time > 0 && r.distance > 0) r.avg_speed_mph = (r.distance / 1609.34) / (r.moving_time / 3600);
    return r;
  });
  if (mode === "bike") return rows.sort((a, b) => b.distance - a.distance);
  rows.sort((a, b) => a.key.localeCompare(b.key));
  if (mode === "weekly") {
    rows.forEach((r, i) => {
      const prev = i > 0 ? rows[i - 1] : null;
      r.trend = prev && prev.distance > 0 ? ((r.distance - prev.distance) / prev.distance) * 100 : null;
    });
  }
  if (mode === "monthly" && !combineYears) {
    const totals = {};
    for (const a of trendActivities || activities || []) {
      const d = new Date(a.start_date);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      totals[k] = (totals[k] || 0) + (a.distance || 0);
    }
    const keys = Object.keys(totals).sort();
    rows.forEach(r => {
      const i = keys.indexOf(r.key);
      const prev = i > 0 ? totals[keys[i - 1]] : 0;
      r.trend = prev > 0 ? ((r.distance - prev) / prev) * 100 : null;
    });
  }
  return rows.reverse();
}

const quantileOf = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);

/**
 * Period tiles for the activity calendar. granularity: "week" | "month" | "quarter" | "year".
 * Returns { rows: [{ year, cells }], thresholds } with rows newest first (a single row for "year").
 * Weeks are ISO weeks (rows by ISO year). cell.params is the Activities drill-down for that period:
 * week = { week: Monday YYYY-MM-DD }, month = { month: YYYY-MM }, quarter = { quarter: YYYY-Qn }, year = { year }.
 */
export function buildPeriodGrid(activities, metric, granularity, now = new Date()) {
  const m = METRICS[metric] || METRICS.distance;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const pad = n => String(n).padStart(2, "0");
  const isoYearOf = ws => new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 3).getFullYear();
  const sums = {}, counts = {}, elevs = {};
  let minYear = Infinity;
  let maxYear = granularity === "week" ? isoYearOf(getWeekStartMonday(today)) : today.getFullYear();

  for (const a of activities || []) {
    const d = new Date(a.start_date);
    let key, yr = d.getFullYear();
    if (granularity === "week") {
      const ws = getWeekStartMonday(a.start_date);
      key = getDateKey(ws);
      yr = isoYearOf(ws);
    } else if (granularity === "month") key = `${yr}-${pad(d.getMonth() + 1)}`;
    else if (granularity === "quarter") key = `${yr}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    else key = String(yr);
    sums[key] = (sums[key] || 0) + m.value(a);
    counts[key] = (counts[key] || 0) + 1;
    elevs[key] = (elevs[key] || 0) + (a.total_elevation_gain || 0);
    minYear = Math.min(minYear, yr);
    maxYear = Math.max(maxYear, yr);
  }

  if (!isFinite(minYear)) minYear = maxYear;

  const cell = (key, label, fullLabel, start, params) => ({
    key, label, fullLabel, value: sums[key] || 0, count: counts[key] || 0, elevation: elevs[key] || 0, future: start > today, params
  });
  const yearCells = y => {
    if (granularity === "month") {
      return MONTHS.map((mn, i) => cell(`${y}-${pad(i + 1)}`, `${mn} ${y}`, `${mn} ${y}`, new Date(y, i, 1), { month: `${y}-${pad(i + 1)}` }));
    }
    if (granularity === "quarter") {
      return [1, 2, 3, 4].map(q => cell(`${y}-Q${q}`, `Q${q} ${y}`, `Q${q} ${y}`, new Date(y, (q - 1) * 3, 1), { quarter: `${y}-Q${q}` }));
    }
    const jan4 = new Date(y, 0, 4);
    const total = getWeekNumber(new Date(y, 11, 28));
    const cells = [];
    for (let w = 1; w <= total; w++) {
      const ws = new Date(y, 0, 4 - ((jan4.getDay() + 6) % 7) + (w - 1) * 7);
      const key = getDateKey(ws);
      cells.push(cell(key, `Wk ${w}`, `Week ${w}, ${y} (week of ${MONTHS[ws.getMonth()]} ${ws.getDate()})`, ws, { week: key }));
    }
    return cells;
  };

  const rows = [];
  if (granularity === "year") {
    const cells = [];
    for (let y = maxYear; y >= minYear; y--) cells.push(cell(String(y), String(y), String(y), new Date(y, 0, 1), { year: String(y) }));
    rows.push({ year: null, cells });
  } else {
    for (let y = maxYear; y >= minYear; y--) rows.push({ year: y, cells: yearCells(y) });
  }

  const nonZero = rows.flatMap(r => r.cells).filter(c => c.value > 0).map(c => c.value).sort((x, y) => x - y);
  return { rows, thresholds: [quantileOf(nonZero, 0.25), quantileOf(nonZero, 0.5), quantileOf(nonZero, 0.75)] };
}

/** Same-period comparison: this calendar year to date vs. last year to the same date. */
export function buildYearComparison(activities, now = new Date()) {
  const thisYear = now.getFullYear();
  const cutoffThis = now.getTime();
  const cutoffLast = new Date(thisYear - 1, now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
  const cur = [], prev = [];
  activities.forEach(a => {
    const d = new Date(a.start_date);
    const ts = d.getTime();
    if (d.getFullYear() === thisYear && ts <= cutoffThis) cur.push(a);
    else if (d.getFullYear() === thisYear - 1 && ts <= cutoffLast) prev.push(a);
  });
  const rows = ["distance", "elevation", "moving_time", "count"].map(metric => {
    const c = sumMetric(cur, metric);
    const p = sumMetric(prev, metric);
    return { metric, current: c, previous: p, delta: p > 0 ? ((c - p) / p) * 100 : null };
  });
  return { thisYear, lastYear: thisYear - 1, rows };
}

/** Last 30 days vs prior 30 days (V1 hero). */
export function buildRecentPeriodStats(activities, now = Date.now()) {
  const last30Cutoff = now - 30 * 86400000;
  const prev30Cutoff = now - 60 * 86400000;
  const last30 = activities.filter(a => new Date(a.start_date).getTime() >= last30Cutoff);
  const prev30 = activities.filter(a => {
    const ts = new Date(a.start_date).getTime();
    return ts >= prev30Cutoff && ts < last30Cutoff;
  });
  const sum = (list, key) => list.reduce((s, a) => s + (a[key] || 0), 0);
  const delta = (c, p) => (p > 0 ? ((c - p) / p) * 100 : 0);
  const d = [sum(last30, "distance"), sum(prev30, "distance")];
  const t = [sum(last30, "moving_time"), sum(prev30, "moving_time")];
  const e = [sum(last30, "total_elevation_gain"), sum(prev30, "total_elevation_gain")];
  return {
    distance: d[0], distanceDelta: delta(...d),
    time: t[0], timeDelta: delta(...t),
    elevation: e[0], elevationDelta: delta(...e)
  };
}

/* ---------- ride insights / records ---------- */

export function deriveRideInsights(data) {
  const rides = (data.activities || []).filter(a => a && a.gear_id && a.sport_type === "Ride");
  const allActivities = (data.activities || []).filter(Boolean);
  const rideActivities = allActivities.filter(a => a.sport_type === "Ride");
  const perBike = {};
  let totalRideDistance = 0;
  let totalRideCount = 0;
  let topMileageWeek = null;
  let topClimbingWeek = null;

  rides.forEach(a => {
    const gid = a.gear_id;
    if (!perBike[gid]) {
      perBike[gid] = { firstRide: null, lastRide: null, biggestMileageWeek: null, biggestClimbingWeek: null, mostActiveWeek: null, weeks: {} };
    }
    totalRideDistance += a.distance || 0;
    totalRideCount += 1;

    const ts = new Date(a.start_date).getTime();
    if (!perBike[gid].firstRide || ts < new Date(perBike[gid].firstRide).getTime()) perBike[gid].firstRide = a.start_date;
    if (!perBike[gid].lastRide || ts > new Date(perBike[gid].lastRide).getTime()) perBike[gid].lastRide = a.start_date;

    const weekStart = formatShortDate(getWeekStartMonday(a.start_date));
    if (!perBike[gid].weeks[weekStart]) perBike[gid].weeks[weekStart] = { label: weekStart, distance: 0, elevation: 0, count: 0 };
    perBike[gid].weeks[weekStart].distance += a.distance || 0;
    perBike[gid].weeks[weekStart].elevation += a.total_elevation_gain || 0;
    perBike[gid].weeks[weekStart].count += 1;
  });

  Object.keys(perBike).forEach(gid => {
    const bike = perBike[gid];
    const weeks = Object.values(bike.weeks);
    bike.biggestMileageWeek = weeks.reduce((best, w) => (!best || w.distance > best.distance ? w : best), null);
    bike.biggestClimbingWeek = weeks.reduce((best, w) => (!best || w.elevation > best.elevation ? w : best), null);
    bike.mostActiveWeek = weeks.reduce((best, w) => (!best || w.count > best.count ? w : best), null);

    const total = data.gearTotals && data.gearTotals[gid] ? data.gearTotals[gid] : null;
    bike.distanceShare = totalRideDistance > 0 && total ? total.distance / totalRideDistance : 0;
    bike.countShare = totalRideCount > 0 && total ? total.count / totalRideCount : 0;

    if (bike.biggestMileageWeek && (!topMileageWeek || bike.biggestMileageWeek.distance > topMileageWeek.distance)) {
      topMileageWeek = { ...bike.biggestMileageWeek, gid };
    }
    if (bike.biggestClimbingWeek && (!topClimbingWeek || bike.biggestClimbingWeek.elevation > topClimbingWeek.elevation)) {
      topClimbingWeek = { ...bike.biggestClimbingWeek, gid };
    }
  });

  const highlightCandidates = Object.keys(data.gearTotals || {}).map(gid => {
    const total = data.gearTotals[gid];
    const detail = (data.gearDetails || {})[gid] || {};
    if (!total) return null;
    return {
      gid,
      name: detail.name || gid,
      distance: total.distance || 0,
      elevation: total.elevation || 0,
      count: total.count || 0,
      moving_time: total.moving_time || 0,
      pr_count: total.pr_count || 0,
      avg_speed_mph: total.avg_speed_mph || 0,
      avg_distance_per_ride: total.count > 0 ? total.distance / total.count : 0,
      avg_elevation_per_ride: total.count > 0 ? total.elevation / total.count : 0
    };
  }).filter(Boolean);

  const bikeById = Object.fromEntries(highlightCandidates.map(b => [b.gid, b]));
  const best = (key) => highlightCandidates.reduce((b, c) => (!b || c[key] > b[key] ? c : b), null);

  const mostRecentBike = Object.keys(perBike).reduce((b, gid) => {
    const c = perBike[gid];
    if (!c?.lastRide) return b;
    if (!b || new Date(c.lastRide).getTime() > new Date(b.lastRide).getTime()) return { gid, ...c };
    return b;
  }, null);

  const longestUsedBike = Object.keys(perBike).reduce((b, gid) => {
    const c = perBike[gid];
    if (!c?.firstRide || !c?.lastRide) return b;
    const span = new Date(c.lastRide).getTime() - new Date(c.firstRide).getTime();
    if (!b || span > b.span) return { gid, ...c, span };
    return b;
  }, null);

  const longestActivity = allActivities.reduce((b, a) => (!b || (a.distance || 0) > (b.distance || 0) ? a : b), null);
  const highestElevationActivity = allActivities
    .filter(a => String(a.id) !== EXCLUDED_HIGHEST_ELEVATION_ACTIVITY_ID)
    .reduce((b, a) => (!b || (a.total_elevation_gain || 0) > (b.total_elevation_gain || 0) ? a : b), null);
  const longestMovingTimeActivity = allActivities.reduce((b, a) => (!b || (a.moving_time || 0) > (b.moving_time || 0) ? a : b), null);

  const fastestRide = rideActivities
    .filter(a => (a.distance || 0) > 0 && (a.moving_time || 0) > 0)
    .reduce((b, a) => {
      const avgSpeedMph = miles(a.distance) / (a.moving_time / 3600);
      return !b || avgSpeedMph > b.avg_speed_mph ? { ...a, avg_speed_mph: avgSpeedMph } : b;
    }, null);

  const steepestRide = rideActivities
    .filter(a => (a.distance || 0) > 0 && (a.total_elevation_gain || 0) > 0)
    .reduce((b, a) => {
      const elevationPerMile = feet(a.total_elevation_gain) / Math.max(miles(a.distance), 0.01);
      return !b || elevationPerMile > b.elevation_per_mile ? { ...a, elevation_per_mile: elevationPerMile } : b;
    }, null);

  return {
    perBike,
    highlights: {
      mostUsedByMiles: best("distance"),
      mostUsedByCount: best("count"),
      fastestBike: best("avg_speed_mph"),
      climbingBike: best("avg_elevation_per_ride"),
      longestAverageRideBike: best("avg_distance_per_ride"),
      mostTotalTimeBike: best("moving_time"),
      mostRecentBike: mostRecentBike ? { ...bikeById[mostRecentBike.gid], ...mostRecentBike } : null,
      biggestMileageWeekBike: topMileageWeek ? { ...bikeById[topMileageWeek.gid], ...topMileageWeek } : null,
      biggestClimbingWeekBike: topClimbingWeek ? { ...bikeById[topClimbingWeek.gid], ...topClimbingWeek } : null,
      longestUsedBike: longestUsedBike ? { ...bikeById[longestUsedBike.gid], ...longestUsedBike } : null,
      longestActivity,
      highestElevationActivity,
      longestMovingTimeActivity,
      fastestRide,
      steepestRide
    }
  };
}

/** Headline sentence for the Overview, driven by the primary metric (V1 hero). */
export function buildHeadline(data, rideInsights, metric) {
  const h = rideInsights?.highlights || {};
  const topWeekday = buildWeekdayBreakdown(data.activities, "distance")
    .reduce((b, i) => (!b || i.value > b.value ? i : b), null);

  if (metric === "distance" && topWeekday && h.mostUsedByMiles) {
    return `${topWeekday.label} is your biggest mileage day, and ${h.mostUsedByMiles.name} leads your ride volume with ${comma(miles(h.mostUsedByMiles.distance).toFixed(1))} mi.`;
  }
  if (metric === "moving_time" && h.mostTotalTimeBike) {
    return `${h.mostTotalTimeBike.name} has the highest total activity time at ${formatDuration(h.mostTotalTimeBike.moving_time)} in the current view.`;
  }
  if (metric === "elevation" && h.climbingBike) {
    return `${h.climbingBike.name} leads climbing intensity at ${comma(feet(h.climbingBike.avg_elevation_per_ride).toFixed(0))} ft per ride on average.`;
  }
  if (metric === "count" && h.mostUsedByCount) {
    return `${h.mostUsedByCount.name} has the highest ride count with ${comma(h.mostUsedByCount.count)} activities in the current view.`;
  }
  return "Training data is ready to explore.";
}

/* ---------- segments ---------- */

function newestOf(row, activity) {
  const ts = new Date(activity.start_date).getTime();
  if (!row.latestActivity || ts > new Date(row.latestActivity.start_date).getTime()) row.latestActivity = activity;
  if (!row.lastRidden || ts > new Date(row.lastRidden).getTime()) row.lastRidden = activity.start_date;
}

export function buildSegmentSummaryHighlights(data, excludedSegmentIds) {
  const segmentData = data.segmentData || {};
  const activityById = Object.fromEntries((data.activities || []).map(a => [String(a.id), a]));
  const perSegment = new Map();
  let totalEfforts = 0;
  let totalPrs = 0;

  Object.entries(segmentData).forEach(([activityId, efforts]) => {
    const activity = activityById[String(activityId)];
    if (!activity || !Array.isArray(efforts)) return;

    efforts.forEach((effort, index) => {
      const segmentId = effort?.segment_id ? String(effort.segment_id) : null;
      if (!segmentId || excludedSegmentIds.has(segmentId)) return;

      totalEfforts += 1;
      if (effort?.pr_rank === 1) totalPrs += 1;

      if (!perSegment.has(segmentId)) {
        perSegment.set(segmentId, {
          segmentId,
          segmentName: effort?.segment_name || effort?.name || `Segment ${index + 1}`,
          attempts: 0, prCount: 0, latestActivity: activity, lastRidden: activity.start_date
        });
      }
      const row = perSegment.get(segmentId);
      row.attempts += 1;
      if (effort?.pr_rank === 1) row.prCount += 1;
      newestOf(row, activity);
    });
  });

  const segments = Array.from(perSegment.values());
  return {
    totalSegments: segments.length,
    totalEfforts,
    totalPrs,
    mostAttempted: [...segments].sort((a, b) => b.attempts - a.attempts)[0] || null,
    mostPrs: [...segments].sort((a, b) => b.prCount - a.prCount)[0] || null
  };
}

/**
 * Segments whose current overall leaderboard rank is 1, 2 or 3 (from the leaderboard backfill's `segmentRanks`),
 * with efforts and last-ridden from the (filtered) activities. Tiers are exclusive. Excluded segments are not applied.
 */
export function buildSegmentRankings(data, segmentRanks) {
  const out = { kom: [], second: [], third: [] };
  const tiers = { 1: out.kom, 2: out.second, 3: out.third };
  const ranks = segmentRanks || {};
  const activityById = Object.fromEntries((data?.activities || []).map(a => [String(a.id), a]));
  const perSegment = new Map();

  Object.entries(data?.segmentData || {}).forEach(([activityId, efforts]) => {
    const activity = activityById[String(activityId)];
    if (!activity || !Array.isArray(efforts)) return;
    efforts.forEach(effort => {
      const segmentId = effort?.segment_id ? String(effort.segment_id) : null;
      if (!segmentId || !tiers[ranks[segmentId]?.rank]) return;
      let row = perSegment.get(segmentId);
      if (!row) {
        row = { segmentId, segmentName: effort.segment_name || effort.name || `Segment ${segmentId}`, attempts: 0, lastRidden: activity.start_date, rank: ranks[segmentId].rank };
        perSegment.set(segmentId, row);
      }
      row.attempts += 1;
      if (new Date(activity.start_date) > new Date(row.lastRidden)) row.lastRidden = activity.start_date;
    });
  });

  perSegment.forEach(row => tiers[row.rank].push({ segmentId: row.segmentId, segmentName: row.segmentName, attempts: row.attempts, lastRidden: row.lastRidden }));
  Object.values(out).forEach(rows => rows.sort((a, b) => b.attempts - a.attempts || a.segmentName.localeCompare(b.segmentName)));
  return out;
}

const DISTANCE_BUCKETS = [
  { key: "0-0.5", label: "Under 0.5 mi", min: 0, max: 0.5 },
  { key: "0.5-1", label: "0.5–1.0 mi", min: 0.5, max: 1.0 },
  { key: "1-2", label: "1.0–2.0 mi", min: 1.0, max: 2.0 },
  { key: "2-3", label: "2.0–3.0 mi", min: 2.0, max: 3.0 },
  { key: "3-5", label: "3.0–5.0 mi", min: 3.0, max: 5.0 },
  { key: "5plus", label: "5.0+ mi", min: 5.0, max: Infinity }
];

export function buildSegmentDistanceHighlights(data, excludedSegmentIds) {
  const segmentData = data.segmentData || {};
  const activityById = Object.fromEntries((data.activities || []).map(a => [String(a.id), a]));
  const perSegment = new Map();

  Object.entries(segmentData).forEach(([activityId, efforts]) => {
    const activity = activityById[String(activityId)];
    if (!activity || !Array.isArray(efforts)) return;

    efforts.forEach((effort, index) => {
      const segmentId = effort?.segment_id ? String(effort.segment_id) : null;
      const distanceMilesValue = miles(Number(effort?.distance || 0));
      if (!segmentId || distanceMilesValue <= 0) return;
      if (excludedSegmentIds.has(segmentId)) return;

      if (!perSegment.has(segmentId)) {
        perSegment.set(segmentId, {
          segmentId,
          segmentName: effort?.segment_name || effort?.name || `Segment ${index + 1}`,
          distanceMiles: distanceMilesValue,
          elevationFeet: feet(Number(effort?.elevation_gain || 0)),
          attempts: 0, prCount: 0, latestActivity: activity, lastRidden: activity.start_date
        });
      }
      const row = perSegment.get(segmentId);
      row.attempts += 1;
      if (effort?.pr_rank === 1) row.prCount += 1;
      newestOf(row, activity);
    });
  });

  return DISTANCE_BUCKETS.map(bucket => {
    const winner = Array.from(perSegment.values())
      .filter(s => s.distanceMiles >= bucket.min && s.distanceMiles < bucket.max)
      .sort((a, b) => {
        if (b.attempts !== a.attempts) return b.attempts - a.attempts;
        if ((b.prCount || 0) !== (a.prCount || 0)) return (b.prCount || 0) - (a.prCount || 0);
        return (b.distanceMiles || 0) - (a.distanceMiles || 0);
      })[0];

    if (!winner) {
      return { label: bucket.label, empty: true, emptyMessage: "No qualifying segments in this distance bucket." };
    }
    return {
      label: bucket.label,
      segmentId: winner.segmentId,
      segmentName: winner.segmentName,
      distanceMiles: winner.distanceMiles,
      elevationFeet: winner.elevationFeet,
      attempts: winner.attempts,
      prCount: winner.prCount,
      statsText: `${winner.distanceMiles.toFixed(1)} mi • ${comma(Math.round(winner.elevationFeet))} ft • ${comma(winner.attempts)} efforts${winner.prCount ? ` • ${comma(winner.prCount)} PRs` : ""}`,
      latestActivity: winner.latestActivity || null,
      lastRidden: winner.lastRidden || null
    };
  });
}

const ELEVATION_BUCKETS = [
  { key: "300-400", label: "300–400 ft", min: 300, max: 400 },
  { key: "400-600", label: "400–600 ft", min: 400, max: 600 },
  { key: "600-800", label: "600–800 ft", min: 600, max: 800 },
  { key: "800-1000", label: "800–1000 ft", min: 800, max: 1000 },
  { key: "1000-plus", label: "1000 ft+", min: 1000, max: Infinity }
];

export function buildSegmentElevationHighlights(data, excludedSegmentIds, minAttempts) {
  const segmentData = data.segmentData || {};
  const activityById = Object.fromEntries((data.activities || []).map(a => [String(a.id), a]));
  const perSegment = new Map();

  Object.entries(segmentData).forEach(([activityId, efforts]) => {
    const activity = activityById[String(activityId)];
    if (!activity || !Array.isArray(efforts)) return;

    efforts.forEach((effort, index) => {
      const segmentId = effort?.segment_id ? String(effort.segment_id) : null;
      const elevationFeet = effort?.elevation_gain != null ? feet(Number(effort.elevation_gain || 0)) : null;
      if (!segmentId || elevationFeet == null || elevationFeet < 300) return;
      if (excludedSegmentIds.has(segmentId)) return;

      if (!perSegment.has(segmentId)) {
        perSegment.set(segmentId, {
          segmentId,
          segmentName: effort?.segment_name || effort?.name || `Segment ${index + 1}`,
          elevationGainFeet: elevationFeet,
          distanceMiles: miles(Number(effort?.distance || 0)),
          attempts: 0, prCount: 0, fastestElapsedTime: null,
          averageGrade: typeof effort?.average_grade === "number" ? effort.average_grade : null,
          latestActivity: activity, firstRidden: activity.start_date, lastRidden: activity.start_date
        });
      }

      const row = perSegment.get(segmentId);
      row.attempts += 1;
      if (effort?.pr_rank === 1) row.prCount += 1;
      const elapsed = Number(effort?.elapsed_time || 0);
      if (elapsed > 0 && (!row.fastestElapsedTime || elapsed < row.fastestElapsedTime)) row.fastestElapsedTime = elapsed;
      newestOf(row, activity);
      const ts = new Date(activity.start_date).getTime();
      if (!row.firstRidden || ts < new Date(row.firstRidden).getTime()) row.firstRidden = activity.start_date;
    });
  });

  const all = Array.from(perSegment.values());
  const belowMinimum = all.filter(s => s.attempts < minAttempts).length;

  const items = ELEVATION_BUCKETS.map(bucket => {
    const winner = all
      .filter(s => s.attempts >= minAttempts && s.elevationGainFeet >= bucket.min && s.elevationGainFeet < bucket.max)
      .sort((a, b) => {
        if (b.attempts !== a.attempts) return b.attempts - a.attempts;
        if ((b.prCount || 0) !== (a.prCount || 0)) return (b.prCount || 0) - (a.prCount || 0);
        return (b.elevationGainFeet || 0) - (a.elevationGainFeet || 0);
      })[0];

    if (!winner) {
      return { label: bucket.label, empty: true, emptyMessage: `No segments meet the ${comma(minAttempts)}-effort minimum in this bucket.` };
    }

    const statParts = [
      `${comma(winner.attempts)} effort${winner.attempts === 1 ? "" : "s"}`,
      `${comma(Math.round(winner.elevationGainFeet))} ft`,
      `${winner.distanceMiles.toFixed(1)} mi`
    ];
    if (winner.prCount > 0) statParts.push(`${comma(winner.prCount)} PR${winner.prCount === 1 ? "" : "s"}`);
    if (winner.fastestElapsedTime) statParts.push(`fastest ${formatDuration(winner.fastestElapsedTime)}`);
    if (winner.averageGrade != null) statParts.push(`${winner.averageGrade.toFixed(1)}% avg`);

    return {
      label: bucket.label,
      segmentId: winner.segmentId,
      segmentName: winner.segmentName,
      elevationFeet: winner.elevationGainFeet,
      distanceMiles: winner.distanceMiles,
      attempts: winner.attempts,
      prCount: winner.prCount,
      statsText: statParts.join(" • "),
      latestActivity: winner.latestActivity || null,
      lastRidden: winner.lastRidden || null
    };
  });

  return { minAttempts, items, belowMinimum };
}

export { getGearName };

/* ---------- matched rides (route / segment leaderboards) ---------- */

const matchesPeriod = (dateStr, year, month) => {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  if (year != null && d.getFullYear() !== Number(year)) return false;
  if (month != null && d.getMonth() + 1 !== Number(month)) return false;
  return true;
};

const compareLeaderRows = (a, b) =>
  b.count - a.count || new Date(b.lastRidden).getTime() - new Date(a.lastRidden).getTime() || String(a.name).localeCompare(String(b.name));

function foldRides(rides) {
  let first = rides[0].start_date, last = rides[0].start_date;
  rides.forEach(r => {
    if (new Date(r.start_date) < new Date(first)) first = r.start_date;
    if (new Date(r.start_date) > new Date(last)) last = r.start_date;
  });
  return { first, last };
}

/**
 * Top routes by matched-ride count among the given (already globally filtered) activities.
 * Period uses the browser's local time zone like the rest of the Patterns page.
 */
export function buildRouteLeaderboard(routeClusters, activities, { year = null, month = null, limit = 20 } = {}) {
  const byId = new Map((activities || []).map(a => [String(a.id), a]));
  const rows = [];
  (routeClusters?.clusters || []).forEach(c => {
    const rides = c.activityIds.map(id => byId.get(String(id))).filter(a => a && a.start_date && matchesPeriod(a.start_date, year, month));
    if (!rides.length) return;
    const { first, last } = foldRides(rides);
    const rep = byId.get(String(c.representativeId)) || rides[0];
    rows.push({
      key: c.routeId, group: c.sportGroup || "Ride", name: c.name, count: rides.length, firstRidden: first, lastRidden: last,
      distance: c.distance, elevation: c.elevation, polyline: rep.summary_polyline || "",
      rides: rides.slice().sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
    });
  });
  return rows.sort(compareLeaderRows).slice(0, limit);
}

/** Top segments by number of distinct rides, from segmentData; respects excluded segments and filtered activities. */
export function buildSegmentLeaderboard(segmentData, activities, excludedSegmentIds, { year = null, month = null, limit = 20 } = {}) {
  const byId = new Map((activities || []).map(a => [String(a.id), a]));
  const map = new Map();
  Object.entries(segmentData || {}).forEach(([activityId, efforts]) => {
    const activity = byId.get(String(activityId));
    if (!activity) return;
    const seen = new Set();
    (efforts || []).forEach(e => {
      if (!e?.segment_id || !e.start_date) return;
      const sid = String(e.segment_id);
      if (excludedSegmentIds?.has(sid) || seen.has(sid) || !matchesPeriod(e.start_date, year, month)) return;
      seen.add(sid);
      let row = map.get(sid);
      if (!row) {
        row = { key: sid, segmentId: sid, name: e.segment_name || `Segment ${sid}`, count: 0, firstRidden: e.start_date, lastRidden: e.start_date,
          distance: e.distance || 0, elevation: e.elevation_gain || 0, polyline: "", rides: [] };
        map.set(sid, row);
      }
      row.count++;
      row.rides.push(activity);
      if (new Date(e.start_date) < new Date(row.firstRidden)) row.firstRidden = e.start_date;
      if (new Date(e.start_date) > new Date(row.lastRidden)) row.lastRidden = e.start_date;
    });
  });
  const rows = [...map.values()].sort(compareLeaderRows).slice(0, limit);
  rows.forEach(r => r.rides.sort((a, b) => new Date(b.start_date) - new Date(a.start_date)));
  return rows;
}

/** Years present in the activities (descending), for the period picker. */
export const activityYears = activities =>
  [...new Set((activities || []).map(a => new Date(a.start_date).getFullYear()).filter(Number.isFinite))].sort((a, b) => b - a);

/** How many rides already have GPS summaries (geo backfill progress). pending = not yet backfilled. */
export const ROUTE_SPORT_TYPES = ["Ride", "Walk", "Hike"];

export function buildGeoCoverage(activities, types = ROUTE_SPORT_TYPES) {
  const rides = (activities || []).filter(a => types.includes(a.sport_type));
  return {
    total: rides.length,
    withGps: rides.filter(a => a.summary_polyline).length,
    pending: rides.filter(a => a.summary_polyline === undefined).length
  };
}

export function buildMonthYearMatrix(activities, metric) {
  const years = [...new Set((activities || []).map(a => new Date(a.start_date).getFullYear()))].sort((a, b) => b - a);
  const sums = {};
  (activities || []).forEach(a => {
    const d = new Date(a.start_date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    sums[key] = (sums[key] || 0) + (METRICS[metric] || METRICS.distance).value(a);
  });
  return {
    years,
    rows: MONTHS.map((label, month) => ({
      label,
      month,
      ...Object.fromEntries(years.map(year => [year, sums[`${year}-${month}`] || 0]))
    }))
  };
}

export function buildMonthHighlights(activities, metric) {
  const buckets = {};
  (activities || []).forEach(a => {
    const d = new Date(a.start_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets[key] = (buckets[key] || 0) + (METRICS[metric] || METRICS.distance).value(a);
  });
  const years = {};
  Object.entries(buckets).forEach(([key, value]) => {
    const [year, month] = key.split("-").map(Number);
    (years[year] ||= []).push({ month, value });
  });
  const highlights = Object.entries(years).map(([year, months]) => {
    const sorted = [...months].sort((a, b) => b.value - a.value);
    return { year: Number(year), best: sorted[0], worst: sorted[sorted.length - 1] };
  }).sort((a, b) => b.year - a.year);
  if (!Object.keys(buckets).length) return { highlights, rolling: [] };
  const keys = Object.keys(buckets).sort();
  const [firstYear, firstMonth] = keys[0].split("-").map(Number);
  const [lastYear, lastMonth] = keys[keys.length - 1].split("-").map(Number);
  const rolling = [];
  for (let d = new Date(firstYear, firstMonth - 1, 1); d <= new Date(lastYear, lastMonth - 1, 1); d.setMonth(d.getMonth() + 1)) {
    let value = 0;
    for (let offset = 0; offset < 12; offset++) {
      const month = new Date(d.getFullYear(), d.getMonth() - offset, 1);
      value += buckets[`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`] || 0;
    }
    rolling.push({ label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, value });
  }
  return { highlights, rolling: rolling.reverse() };
}

export function buildSeasonalityIndex(activities, metric) {
  const totals = {};
  (activities || []).forEach(a => {
    const d = new Date(a.start_date);
    const year = d.getFullYear();
    const m = (METRICS[metric] || METRICS.distance).value(a);
    if (!totals[year]) totals[year] = { total: 0, months: Array(12).fill(0) };
    totals[year].total += m;
    totals[year].months[d.getMonth()] += m;
  });
  const usable = Object.values(totals).filter(y => y.total > 0);
  return MONTHS.map((label, month) => ({
    label,
    value: usable.length ? usable.reduce((sum, year) => sum + year.months[month] / year.total, 0) / usable.length * 100 : 0
  }));
}

export function buildConsistencyStats(activities, ridesPerWeek = 3) {
  const threshold = Math.max(1, Number(ridesPerWeek) || 3);
  const perYear = {};
  const dates = [];
  const weekCounts = {};
  (activities || []).forEach(a => {
    const date = new Date(a.start_date);
    if (Number.isNaN(date.getTime())) return;
    const dateKey = getDateKey(date);
    dates.push(dateKey);
    const { isoYear, week } = isoWeekParts(date);
    const key = `${isoYear}-${week}`;
    weekCounts[key] = (weekCounts[key] || 0) + 1;
    (perYear[isoYear] ||= new Set()).add(key);
  });
  const yearList = Object.keys(perYear).map(Number).sort((a, b) => a - b);
  const qualifying = Object.keys(weekCounts).filter(key => weekCounts[key] >= threshold).map(key => {
    const [year, week] = key.split("-").map(Number);
    return { year, week };
  }).sort((a, b) => a.year - b.year || a.week - b.week);
  let streak = 0, longestWeekStreak = 0, previous = null;
  qualifying.forEach(current => {
    const consecutive = previous && (
      (current.year === previous.year && current.week === previous.week + 1) ||
      (current.year === previous.year + 1 && previous.week === isoWeeksInYear(previous.year) && current.week === 1)
    );
    streak = consecutive ? streak + 1 : 1;
    longestWeekStreak = Math.max(longestWeekStreak, streak);
    previous = current;
  });
  const uniqueDates = [...new Set(dates)];
  return {
    years: yearList.map(year => ({
      year,
      weeksMeetingThreshold: [...(perYear[year] || [])].filter(key => weekCounts[key] >= threshold).length
    })),
    longestWeekStreak,
    longestDayStreak: computeLongestStreakDetails(uniqueDates).length,
    longestGap: computeLongestGapDetails(uniqueDates),
    threshold
  };
}

export function buildWeeklyRamp(activities, metric = "distance", now = new Date()) {
  const weekly = {};
  (activities || []).forEach(a => {
    const start = getWeekStartMonday(a.start_date);
    const key = getDateKey(start);
    weekly[key] = (weekly[key] || 0) + (metric === "moving_time" ? (a.moving_time || 0) / 3600 : miles(a.distance || 0));
  });
  const keys = Object.keys(weekly).sort();
  if (!keys.length) return [];
  const start = new Date(`${keys[0]}T00:00:00`);
  const end = getWeekStartMonday(now);
  const rows = [];
  let previous = 0;
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) {
    const key = getDateKey(d);
    const value = weekly[key] || 0;
    const baseline = metric === "moving_time" ? 1 : 5;
    rows.push({
      key,
      label: `${MONTHS[d.getMonth()]} ${d.getDate()}`,
      value,
      change: previous >= baseline ? (value - previous) / previous * 100 : null,
      warning: previous >= baseline && (value - previous) / previous > 0.1
    });
    previous = value;
  }
  return rows;
}

export function buildBikeTypeStats(activities) {
  const types = {};
  (activities || []).filter(a => a.sport_type === "Ride").forEach(a => {
    const type = a.bike_type || "unknown";
    if (!types[type]) types[type] = { type, count: 0, distance: 0, elevation: 0, moving_time: 0, names: new Set() };
    const row = types[type];
    row.count++;
    row.distance += a.distance || 0;
    row.elevation += a.total_elevation_gain || 0;
    row.moving_time += a.moving_time || 0;
    if (a.bike_name) row.names.add(a.bike_name);
  });
  return Object.values(types).map(row => ({
    ...row,
    names: [...row.names],
    hours: row.moving_time / 3600,
    avgRideMiles: row.count ? miles(row.distance) / row.count : 0,
    elevationPerMile: row.distance > 0 ? feet(row.elevation) / miles(row.distance) : 0,
    avgSpeed: row.moving_time > 0 ? miles(row.distance) / (row.moving_time / 3600) : 0
  })).sort((a, b) => b.distance - a.distance);
}

export function buildUnmappedBikes(activities) {
  const bikes = {};
  (activities || []).filter(a => a.sport_type === "Ride" && a.gear_id && (a.bike_type || "unknown") === "unknown").forEach(a => {
    if (!bikes[a.gear_id]) bikes[a.gear_id] = { gear_id: a.gear_id, name: a.bike_name || a.gear_id };
  });
  return Object.values(bikes).sort((x, y) => x.gear_id.localeCompare(y.gear_id));
}

export function buildEverestStats(activities) {
  const years = {};
  let lifetimeFeet = 0;
  (activities || []).forEach(a => {
    const gain = feet(a.total_elevation_gain || 0);
    const year = new Date(a.start_date).getFullYear();
    years[year] = (years[year] || 0) + gain;
    lifetimeFeet += gain;
  });
  return { lifetime: lifetimeFeet / 29031.7, years: Object.entries(years).map(([year, elevation]) => ({ year: Number(year), elevation, everests: elevation / 29031.7 })).sort((a, b) => a.year - b.year) };
}

export const MILESTONE_TARGETS = [1000, 2500, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000];
const MILESTONE_HORIZON_DAYS = 100 * 365.25;

export function buildMileageMilestones(activities, now = new Date(), lookbackDays = 90) {
  const sorted = [...(activities || [])].filter(a => a.start_date).sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
  const lifetime = sorted.reduce((sum, a) => sum + miles(a.distance || 0), 0);
  const targets = [...MILESTONE_TARGETS];
  while (targets[targets.length - 1] <= lifetime) targets.push(targets[targets.length - 1] + 5000);
  let total = 0;
  const achieved = [];
  sorted.forEach(a => {
    const before = total;
    total += miles(a.distance || 0);
    targets.forEach(target => {
      if (before < target && total >= target) achieved.push({ target, date: a.start_date, projected: false });
    });
  });
  const cutoff = new Date(now.getTime() - lookbackDays * 86400000);
  const recent = sorted.filter(a => new Date(a.start_date) >= cutoff && new Date(a.start_date) <= now);
  const recentMiles = recent.reduce((sum, a) => sum + miles(a.distance || 0), 0);
  const days = recent.length ? Math.max(1, (now - new Date(recent[0].start_date)) / 86400000) : 0;
  const pace = days ? recentMiles / days : 0;
  const paceLabel = `${lookbackDays}-day average`;
  const projectDate = target => {
    if (!(pace > 0)) return null;
    const daysAway = (target - total) / pace;
    return daysAway > MILESTONE_HORIZON_DAYS ? null : new Date(now.getTime() + daysAway * 86400000).toISOString();
  };
  const upcomingList = targets.filter(target => target > total).map(target => ({ target, date: projectDate(target), projected: true, pace: paceLabel }));
  const firstWithDate = upcomingList.find(item => item.date);
  return {
    total,
    achieved,
    upcomingList,
    upcoming: firstWithDate ? { target: firstWithDate.target, pace: paceLabel, date: firstWithDate.date } : null
  };
}

export function buildBikeSummaryRows(gearTotals, gearDetails, isRetired) {
  const rows = Object.entries(gearTotals || {}).map(([gid, t]) => {
    const distance = miles(t.distance);
    const elevation = feet(t.elevation);
    const count = t.count || 0;
    const time = t.moving_time || 0;
    return {
      gid,
      name: gearDetails?.[gid]?.name || gid,
      retired: !!(isRetired && isRetired(gid)),
      count,
      distance,
      avgDistance: count ? distance / count : 0,
      elevation,
      avgElevation: count ? elevation / count : 0,
      time,
      avgTime: count ? time / count : 0,
      avgSpeed: time > 0 ? distance / (time / 3600) : 0,
      prs: t.pr_count || 0
    };
  });
  const sum = key => rows.reduce((n, r) => n + r[key], 0);
  const count = sum("count");
  const distance = sum("distance");
  const elevation = sum("elevation");
  const time = sum("time");
  const total = {
    count,
    distance,
    avgDistance: count ? distance / count : 0,
    elevation,
    avgElevation: count ? elevation / count : 0,
    time,
    avgTime: count ? time / count : 0,
    avgSpeed: time > 0 ? distance / (time / 3600) : 0,
    prs: sum("prs")
  };
  return { rows, total };
}

/**
 * Distinct segments where a bike has at least one PR effort (pr_rank === 1), joining the bike's activities
 * (gear_id) with cache.segmentData. Excluded segments are skipped; one effort per segment per activity.
 */
export function buildBikePrSegments(segmentData, activities, gearId, excludedSegmentIds) {
  const map = new Map();
  (activities || []).forEach(activity => {
    if (!activity || String(activity.gear_id) !== String(gearId)) return;
    const seen = new Set();
    ((segmentData || {})[activity.id] || []).forEach(e => {
      if (e?.pr_rank !== 1 || !e.segment_id) return;
      const sid = String(e.segment_id);
      if (excludedSegmentIds?.has(sid) || seen.has(sid)) return;
      seen.add(sid);
      const date = e.start_date || activity.start_date;
      let row = map.get(sid);
      if (!row) {
        row = { segmentId: sid, name: e.segment_name || `Segment ${sid}`, count: 0, bestTime: null, latestDate: date, latestActivity: activity };
        map.set(sid, row);
      }
      row.count++;
      if (e.elapsed_time > 0 && (row.bestTime == null || e.elapsed_time < row.bestTime)) row.bestTime = e.elapsed_time;
      if (new Date(date) >= new Date(row.latestDate)) {
        row.latestDate = date;
        row.latestActivity = activity;
      }
    });
  });
  return [...map.values()].sort((a, b) => b.count - a.count || new Date(b.latestDate) - new Date(a.latestDate) || a.name.localeCompare(b.name));
}
