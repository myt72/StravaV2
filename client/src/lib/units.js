// Imperial / Metric display units. Server data stays in native units (meters, seconds); the client converts
// only for display. Analytics keep imperial maths internally where noted (avg_speed_mph, ft/mi) and convert here.

export const M_PER_MI = 1609.34;
export const FT_PER_M = 3.28084;
export const KM_PER_MI = M_PER_MI / 1000;
export const M_PER_FT = 1 / FT_PER_M;

export const UNIT_SYSTEMS = [
  { value: "imperial", label: "Imperial" },
  { value: "metric", label: "Metric" }
];

export function makeUnits(system = "imperial") {
  const metric = system === "metric";
  const distUnit = metric ? "km" : "mi";
  const elevUnit = metric ? "m" : "ft";
  const speedUnit = metric ? "km/h" : "mph";
  const paceUnit = metric ? "min/km" : "min/mi";
  const gradeUnit = metric ? "m/km" : "ft/mi";

  /** meters -> mi | km */
  const distance = meters => (metric ? (meters || 0) / 1000 : (meters || 0) / M_PER_MI);
  /** meters -> ft | m */
  const elevation = meters => (metric ? meters || 0 : (meters || 0) * FT_PER_M);
  /** miles -> mi | km */
  const fromMiles = mi => (metric ? (mi || 0) * KM_PER_MI : mi || 0);
  /** feet -> ft | m */
  const fromFeet = ft => (metric ? (ft || 0) * M_PER_FT : ft || 0);
  /** mph -> mph | km/h */
  const speed = mph => (metric ? (mph || 0) * KM_PER_MI : mph || 0);
  /** ft per mile -> ft/mi | m/km */
  const elevPerDist = ftPerMi => (metric ? ((ftPerMi || 0) * M_PER_FT) / KM_PER_MI : ftPerMi || 0);

  const num = (v, digits) => Number(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const fmtDistance = (meters, digits = 1) => `${num(distance(meters), digits)} ${distUnit}`;
  const fmtDistanceValue = (value, digits = 1) => `${num(value, digits)} ${distUnit}`;
  const fmtElevation = (meters, digits = 0) => `${num(elevation(meters), digits)} ${elevUnit}`;
  const fmtElevationValue = (value, digits = 0) => `${num(value, digits)} ${elevUnit}`;
  const fmtSpeed = (mph, digits = 1) => `${speed(mph).toFixed(digits)} ${speedUnit}`;
  const fmtElevPerDist = (ftPerMi, digits = 0) => `${num(elevPerDist(ftPerMi), digits)} ${gradeUnit}`;
  /** Pace "m:ss" per mi | km, from an average speed in mph. */
  const fmtPace = mph => {
    const s = speed(mph);
    if (!(s > 0)) return null;
    const pace = 60 / s;
    let min = Math.floor(pace);
    let sec = Math.round((pace - min) * 60);
    if (sec === 60) { min += 1; sec = 0; }
    return `${min}:${String(sec).padStart(2, "0")} ${paceUnit}`;
  };

  return {
    system: metric ? "metric" : "imperial", metric,
    distUnit, elevUnit, speedUnit, paceUnit, gradeUnit,
    distance, elevation, fromMiles, fromFeet, speed, elevPerDist,
    fmtDistance, fmtDistanceValue, fmtElevation, fmtElevationValue, fmtSpeed, fmtElevPerDist, fmtPace
  };
}

export const IMPERIAL = makeUnits("imperial");
export const METRIC = makeUnits("metric");
export const unitsFor = system => (system === "metric" ? METRIC : IMPERIAL);
