import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../lib/api.js";
import { applyGlobalFilters, deriveRideInsights } from "../lib/analytics.js";
import { usePersistentState } from "../lib/storage.js";
import { getGearName } from "../lib/format.js";

const Ctx = createContext(null);
export const filenameOf = url => String(url).split("?")[0].split("/").pop();
export const focusPosition = focus => (focus ? `${focus.x * 100}% ${focus.y * 100}%` : "50% 50%");
export const useAppData = () => useContext(Ctx);

export const DATE_RANGES = [
  { value: "all", label: "All time" },
  { value: "365", label: "Last 365 days" },
  { value: "180", label: "Last 180 days" },
  { value: "90", label: "Last 90 days" },
  { value: "30", label: "Last 30 days" }
];

export const isBackfillActive = s => Boolean(s && (s.running || s.mode === "waiting" || s.mode === "starting"));
const POLL_MS = 15000;

export function AppDataProvider({ children }) {
  const [raw, setRaw] = useState(null);
  // status: loading | ready | empty | unauth | error
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [serverMessage, setServerMessage] = useState("");
  const [lastSync, setLastSync] = useState(null);

  const [dateRange, setDateRange] = usePersistentState("dateRange", "all");
  const [activityType, setActivityType] = usePersistentState("activityType", "all");
  const [bike, setBike] = usePersistentState("bike", "all");
  const [primaryMetric, setPrimaryMetric] = usePersistentState("primaryMetric", "distance");
  const [excludedSegments, setExcludedSegments] = usePersistentState("excludedSegments", []);
  const [minEfforts, setMinEfforts] = usePersistentState("segmentMinEfforts", 10);

  const [prBackfill, setPrBackfill] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [bikeImages, setBikeImages] = useState({});
  const [bikePhotoPrefs, setBikePhotoPrefsState] = useState({});
  const prefsRef = useRef({});

  const pollTimer = useRef(null);
  const wasActive = useRef(false);
  const mounted = useRef(true);

  /* ----- data loading ----- */
  const applyPayload = useCallback(data => {
    if (data.prBackfill) setPrBackfill(data.prBackfill);
    setServerMessage(data.message || "");
    if (Array.isArray(data.activities)) {
      setRaw(data);
      setStatus("ready");
      setError("");
    } else {
      setStatus("empty");
    }
    setLastSync(new Date());
  }, []);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setStatus("loading");
    try {
      const data = await api.fetchAnalyticsAuto();
      if (!mounted.current) return;
      if (data.error) throw new api.ApiError(data.error);
      applyPayload(data);
    } catch (err) {
      if (!mounted.current || quiet) return;
      if (err.unauthenticated) setStatus("unauth");
      else {
        setError(err.message || "Failed to load data");
        setStatus("error");
      }
    }
  }, [applyPayload]);

  useEffect(() => {
    mounted.current = true;
    load();
    api.fetchBikeImages().then(m => mounted.current && setBikeImages(m));
    api.fetchBikePhotoPrefs().then(p => {
      if (!mounted.current) return;
      prefsRef.current = p;
      setBikePhotoPrefsState(p);
    });
    return () => {
      mounted.current = false;
      clearTimeout(pollTimer.current);
    };
  }, [load]);

  /* ----- PR backfill polling (same behaviour as V1: 15s while active) ----- */
  const pollPrBackfill = useCallback(async () => {
    clearTimeout(pollTimer.current);
    try {
      const s = await api.fetchPrBackfillStatus();
      if (!mounted.current) return;
      setPrBackfill(s);
      if (isBackfillActive(s)) pollTimer.current = setTimeout(pollPrBackfill, POLL_MS);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const active = isBackfillActive(prBackfill);
  useEffect(() => {
    if (active && !wasActive.current) pollPrBackfill();
    if (!active && wasActive.current) load({ quiet: true });
    wasActive.current = active;
  }, [active, pollPrBackfill, load]);

  /* ----- admin actions ----- */
  const pull = useCallback(async kind => {
    const labels = { refresh: "Refresh", resume: "Resume pull", full: "Full pull" };
    setBusy(kind);
    setNotice({ type: "info", text: `${labels[kind]} in progress… this can take a while.` });
    try {
      const data = await api.runPull(kind);
      applyPayload(data);
      setNotice({ type: "success", text: data.message || `${labels[kind]} complete.` });
    } catch (err) {
      if (err.unauthenticated) setStatus("unauth");
      setNotice({ type: "error", text: err.message || `${labels[kind]} failed.` });
    } finally {
      setBusy(null);
    }
  }, [applyPayload]);

  const startBackfill = useCallback(async () => {
    setBusy("start");
    setNotice({ type: "info", text: "Starting PR backfill background job…" });
    try {
      const data = await api.startPrBackfill();
      if (data.prBackfill) setPrBackfill(data.prBackfill);
      setNotice({ type: "success", text: data.message || "PR backfill started." });
      pollPrBackfill();
    } catch (err) {
      setNotice({ type: "error", text: err.message || "Failed to start PR backfill." });
    } finally {
      setBusy(null);
    }
  }, [pollPrBackfill]);

  const stopBackfill = useCallback(async () => {
    setBusy("stop");
    setNotice({ type: "info", text: "Stopping PR backfill…" });
    try {
      const data = await api.stopPrBackfill();
      if (data.prBackfill) setPrBackfill(data.prBackfill);
      setNotice({ type: "success", text: data.message || "PR backfill stop requested." });
      // The job stops after its current batch; keep polling so the status updates.
      pollPrBackfill();
    } catch (err) {
      setNotice({ type: "error", text: err.message || "Failed to stop PR backfill." });
    } finally {
      setBusy(null);
    }
  }, [pollPrBackfill]);

  /* ----- derived data ----- */
  const filters = useMemo(() => ({ dateRange, activityType, bike }), [dateRange, activityType, bike]);
  const filtered = useMemo(() => (raw ? applyGlobalFilters(raw, filters) : null), [raw, filters]);
  const insights = useMemo(() => (filtered ? deriveRideInsights(filtered) : null), [filtered]);
  const excludedSet = useMemo(() => new Set(excludedSegments), [excludedSegments]);

  const activityTypes = useMemo(
    () => Array.from(new Set((raw?.activities || []).map(a => a.sport_type).filter(Boolean))).sort(),
    [raw]
  );
  const bikes = useMemo(
    () => Object.keys(raw?.gearTotals || {})
      .map(gid => ({ gid, name: getGearName(raw.gearDetails || {}, gid) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [raw]
  );

  // Drop persisted filter values that no longer exist in the data.
  useEffect(() => {
    if (!raw) return;
    if (activityType !== "all" && !activityTypes.includes(activityType)) setActivityType("all");
    if (bike !== "all" && !bikes.some(b => b.gid === bike)) setBike("all");
  }, [raw, activityType, bike, activityTypes, bikes, setActivityType, setBike]);

  const filtersActive = dateRange !== "all" || activityType !== "all" || bike !== "all";
  const resetFilters = useCallback(() => {
    setDateRange("all");
    setActivityType("all");
    setBike("all");
  }, [setDateRange, setActivityType, setBike]);

  const setBikePhotoPrefs = useCallback(async (gid, prefs) => {
    const previous = prefsRef.current;
    const next = { ...previous };
    if (prefs && (prefs.cover || Object.keys(prefs.focus || {}).length)) next[gid] = prefs; else delete next[gid];
    prefsRef.current = next;
    setBikePhotoPrefsState(next);
    try {
      await api.saveBikePhotoPrefs(gid, { cover: prefs?.cover || null, focus: prefs?.focus || {} });
      return true;
    } catch (err) {
      if (!mounted.current) return false;
      const reverted = { ...prefsRef.current };
      if (previous[gid]) reverted[gid] = previous[gid]; else delete reverted[gid];
      prefsRef.current = reverted;
      setBikePhotoPrefsState(reverted);
      setNotice({ type: "error", text: `Could not save photo settings: ${err.message}` });
      return false;
    }
  }, []);

  const getCoverPhoto = useCallback(gid => {
    const urls = bikeImages[gid] || [];
    if (!urls.length) return { url: null, focus: null };
    const prefs = bikePhotoPrefs[gid] || {};
    const url = urls.find(u => filenameOf(u) === prefs.cover) || urls[0];
    return { url, focus: prefs.focus?.[filenameOf(url)] || null };
  }, [bikeImages, bikePhotoPrefs]);

  const value = {
    raw, filtered, insights, status, error, serverMessage, lastSync, reload: load,
    filters, setDateRange, setActivityType, setBike, filtersActive, resetFilters, activityTypes, bikes,
    primaryMetric, setPrimaryMetric,
    excludedSegments, excludedSet, minEfforts, setMinEfforts,
    excludeSegment: id => setExcludedSegments(prev => (prev.includes(String(id)) ? prev : [...prev, String(id)])),
    restoreSegment: id => setExcludedSegments(prev => prev.filter(x => x !== String(id))),
    prBackfill, backfillActive: active, busy, notice, setNotice, pull, startBackfill, stopBackfill,
    bikeImages, setBikeImages, bikePhotoPrefs, setBikePhotoPrefs, getCoverPhoto,
    gearName: gid => getGearName(raw?.gearDetails, gid)
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
