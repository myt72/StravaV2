import { useEffect, useMemo, useRef, useState } from "react";
import { useAppData } from "../context/AppData.jsx";
import { useUnits } from "../context/Units.jsx";
import { SEGMENT_TYPE_GRADE, bestSegmentAttemptsByBike, bestSegmentAttemptsByYear, buildSegmentAttempts, filterSegmentAttempts, WEEKDAYS } from "../lib/analytics.js";
import { comma, formatDate, formatDurationHms, getStravaSegmentUrl } from "../lib/format.js";
import { polylineToSvgPath } from "../lib/polyline.js";
import { ActivityLink, Card, DataTable, PageHead } from "../components/ui.jsx";

const TYPE_LABELS = { climb: "Climb", descent: "Descent", flat: "Flat / rolling" };
const gradeText = grade => typeof grade === "number" ? `${grade > 0 ? "+" : ""}${grade.toFixed(1)}%` : "—";

function SegmentShape({ polyline, name, size = 48, placeholder = "—" }) {
  const d = polylineToSvgPath(polyline, size, size > 48 ? 8 : 3, size > 48 ? 300 : 60);
  if (!d) return <div className="shape-placeholder muted small" style={{ width: size, height: size }}>{placeholder}</div>;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Shape of ${name}`}>
      <path d={d} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SegmentDetail({ id }) {
  const { raw, gearName } = useAppData();
  const units = useUnits();
  const [bike, setBike] = useState("all");
  const [year, setYear] = useState("all");
  const [weekday, setWeekday] = useState("all");
  const [openGroups, setOpenGroups] = useState(() => new Set());
  useEffect(() => {
    document.getElementById("main-content")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, []);
  const row = useMemo(() => buildSegmentAttempts(raw.segmentData, raw.activities, null, { segmentId: id })[0], [raw.segmentData, raw.activities, id]);
  const attempts = row?.attempts || [];
  const years = [...new Set(attempts.filter(attempt => attempt.date).map(attempt => new Date(attempt.date).getFullYear()))].sort((a, b) => b - a);
  const bikes = [...new Set(attempts.map(attempt => attempt.activity.gear_id).filter(Boolean))]
    .map(gid => ({ gid, name: gearName(gid) })).sort((a, b) => a.name.localeCompare(b.name));
  const hasNoBike = attempts.some(attempt => !attempt.activity.gear_id);
  const visible = filterSegmentAttempts(attempts, { bike, year, weekday });
  const yearlyBests = bestSegmentAttemptsByYear(visible);
  const bikeBests = bestSegmentAttemptsByBike(visible);
  const missing = (raw.activities || []).filter(a => a.sport_type === "Ride" && !Object.hasOwn(raw.segmentData || {}, a.id)).length;
  const bikeLabel = bikeId => bikeId ? gearName(bikeId) : "No bike recorded";
  const fastestOf = rows => Math.min(...rows.map(item => item.attempt?.elapsed ?? Infinity));
  const timeCell = fastest => row => {
    if (!row.attempt) return "—";
    const isBest = row.attempt.elapsed === fastest;
    return isBest ? <strong className="best-time">{formatDurationHms(row.attempt.elapsed)} <span className="best-badge">Best</span></strong> : formatDurationHms(row.attempt.elapsed);
  };
  const triesColumn = { key: "tries", label: "Tries", align: "r", value: row => row.tries, render: row => comma(row.tries), renderChild: () => "" };
  const rankColumn = { key: "rank", label: "Rank", align: "r", sortable: false, render: row => `#${row.rank || 1}` };
  const timeColumn = fastest => ({ key: "elapsed", label: "Time", align: "r", value: row => row.attempt?.elapsed ?? null, render: timeCell(fastest) });
  const effortColumns = [
    { key: "date", label: "Date", value: row => row.attempt?.date ? new Date(row.attempt.date).getTime() : null, render: row => row.attempt?.date ? formatDate(row.attempt.date) : "—" },
    { key: "activity", label: "Activity", wrap: true, value: row => row.attempt?.activity.name || "", render: row => row.attempt ? <ActivityLink activity={row.attempt.activity} /> : "—" }
  ];
  const yearlyColumns = [
    { key: "year", label: "Year", renderChild: () => "" },
    triesColumn,
    rankColumn,
    timeColumn(fastestOf(yearlyBests)),
    { key: "bike", label: "Bike", value: row => gearName(row.attempt.activity.gear_id), render: row => gearName(row.attempt.activity.gear_id) },
    ...effortColumns
  ];
  const bikeColumns = [
    { key: "bike", label: "Bike", value: row => bikeLabel(row.bikeId), render: row => bikeLabel(row.bikeId), renderChild: () => "" },
    triesColumn,
    rankColumn,
    timeColumn(fastestOf(bikeBests)),
    ...effortColumns
  ];
  const groupKey = (type, row) => `${type}:${type === "year" ? row.year : row.bikeId ?? "none"}`;
  const groupExpand = (type, label) => ({
    isOpen: row => openGroups.has(groupKey(type, row)),
    toggle: row => setOpenGroups(prev => {
      const next = new Set(prev);
      const key = groupKey(type, row);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    }),
    label: row => `${openGroups.has(groupKey(type, row)) ? "Hide" : "Show"} top ${row.top.length} efforts for ${label(row)}`,
    disabledReason: row => row.top.length < 2 ? "No additional efforts" : undefined,
    children: row => row.top.slice(1).map((attempt, index) => ({ key: `${row.top.length}:${index}`, year: row.year, bikeId: row.bikeId, attempt, rank: index + 2 }))
  });
  const stored = raw.segmentDetails?.[id];
  const detail = stored && !stored.missing ? stored : null;
  const distance = row?.distance > 0 ? row.distance : (detail?.distance > 0 ? detail.distance : null);
  const gain = row?.elevationGain ?? (detail?.elevation_high != null && detail?.elevation_low != null ? detail.elevation_high - detail.elevation_low : null);
  const change = distance != null && typeof row.grade === "number" ? distance * row.grade / 100 : null;
  const metrics = row ? [
    ["Distance", distance != null ? units.fmtDistance(distance, 2) : "—"],
    ["Elevation gain", gain != null ? units.fmtElevation(gain) : "—", "high − low point"],
    ["Elevation change", change != null ? `${change > 0 ? "+" : "−"}${units.fmtElevation(Math.abs(change))}` : "—", "estimated from distance × avg grade"],
    ["Avg grade", gradeText(row.grade)],
    ["Max grade", gradeText(detail?.maximum_grade)],
    ["Min elevation", detail?.elevation_low != null ? units.fmtElevation(detail.elevation_low) : "—"],
    ["Max elevation", detail?.elevation_high != null ? units.fmtElevation(detail.elevation_high) : "—"],
    ["Type", row.type ? TYPE_LABELS[row.type] : "—"]
  ] : [];
  const columns = [
    { key: "date", label: "Date", value: attempt => attempt.date ? new Date(attempt.date).getTime() : null, render: attempt => attempt.date ? formatDate(attempt.date) : "—" },
    { key: "activity", label: "Activity", wrap: true, value: attempt => attempt.activity.name || "", render: attempt => <ActivityLink activity={attempt.activity} /> },
    { key: "bike", label: "Bike", value: attempt => gearName(attempt.activity.gear_id), render: attempt => gearName(attempt.activity.gear_id) },
    { key: "elapsed", label: "Elapsed time", align: "r", render: attempt => attempt.elapsed == null ? "—" : formatDurationHms(attempt.elapsed) },
    { key: "prRank", label: "PR", align: "r", render: attempt => attempt.prRank ? `#${attempt.prRank}` : "—" }
  ];

  return (
    <div className="content">
      <PageHead title={row ? row.name : "Segment not found"}>
        <a href="#/segments">← Back to segments</a>
        {row && <> · <a href={getStravaSegmentUrl(id)} target="_blank" rel="noopener noreferrer">Open segment on Strava</a></>}
      </PageHead>
      {missing > 0 && <div className="notice" role="status">{comma(missing)} rides have no cached segment data. Attempts may be incomplete; use the PR backfill on the <a href="#/admin">Data page</a>.</div>}
      {row ? <Card title="Attempts">
        <details className="about-data">
          <summary>About this data</summary>
          <p className="hint">Showing cached attempts across all activities, independently of the global filters. Dates use your browser’s local time zone. PR ranks are Strava’s recorded ranks, not ranks within the filtered results. Solo/group classification is not available.</p>
          {!detail && <p className="hint">{stored?.missing ? "Strava no longer returns this segment, so its shape and elevation range are unavailable." : <>Max grade, min/max elevation and the segment shape need the segment detail backfill on the <a href="#/admin">Data page</a>.</>}</p>}
        </details>
        <div className="grid kpis">
          {metrics.map(([label, value, sub]) => <div key={label}><div className="kpi-label">{label}</div><div className="kpi-value num">{value}</div>{sub && <div className="kpi-sub">{sub}</div>}</div>)}
          <div><div className="kpi-label">Shape</div><SegmentShape polyline={detail?.polyline} name={row.name} size={64} placeholder={stored?.missing ? "Unavailable" : "Not fetched"} /></div>
        </div>
        <div className="toolbar segment-filters">
          <label>Bike <select value={bike} onChange={e => setBike(e.target.value)}>
            <option value="all">All bikes</option>
            {bikes.map(item => <option key={item.gid} value={item.gid}>{item.name}</option>)}
            {hasNoBike && <option value="none">No bike recorded</option>}
          </select></label>
          <label>Year <select value={year} onChange={e => setYear(e.target.value)}>
            <option value="all">All years</option>
            {years.map(value => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <label>Day of week <select value={weekday} onChange={e => setWeekday(e.target.value)}>
            <option value="all">All days</option>
            {WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
          </select></label>
          {(bike !== "all" || year !== "all" || weekday !== "all") && <button type="button" className="btn sm" onClick={() => { setBike("all"); setYear("all"); setWeekday("all"); }}>Reset filters</button>}
          <div className="attempt-count small muted num" aria-live="polite">{comma(visible.length)} of {comma(attempts.length)} attempts</div>
        </div>
        <h3>Best efforts by year</h3>
        <p className="hint">Fastest elapsed time per year among the matching attempts; use the arrow to show up to the top 10. Attempts without a valid date or elapsed time are excluded.</p>
        <DataTable columns={yearlyColumns} rows={yearlyBests} rowKey={row => row.year} initialSort={{ key: "year", dir: "desc" }} expand={groupExpand("year", row => row.year)} caption={`Best efforts by year on ${row.name}`} empty="No matching attempts have a valid date and elapsed time." />
        <h3>Best efforts by bike</h3>
        <p className="hint">Fastest elapsed time for each bike among the matching attempts; use the arrow to show up to the top 10. Select all bikes above to compare every bike.</p>
        <DataTable columns={bikeColumns} rows={bikeBests} rowKey={row => row.bikeId == null ? "missing" : `bike:${row.bikeId}`} initialSort={{ key: "elapsed", dir: "asc" }} expand={groupExpand("bike", row => bikeLabel(row.bikeId))} caption={`Best efforts by bike on ${row.name}`} empty="No attempts on this segment match the current filters." />
        <h3>All attempts</h3>
        <DataTable columns={columns} rows={visible} rowKey={attempt => attempt.key} initialSort={{ key: "date", dir: "desc" }} pageSize={50} caption={`Attempts on ${row.name}`} empty="No attempts on this segment match the current filters." />
      </Card> : <p className="muted">No cached attempts found for this segment.</p>}
    </div>
  );
}

export default function Segments({ route }) {
  const { raw, filtered, excludedSet } = useAppData();
  const units = useUnits();
  const [year, setYear] = useState("all");
  const [weekday, setWeekday] = useState("all");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const segmentId = route.segments[1];
  const listRef = useRef(null);
  const lastOpened = useRef({ id: null, scrollY: 0 });
  const wasOpen = useRef(false);
  useEffect(() => {
    if (segmentId) { wasOpen.current = true; return; }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    // Back on the list: centre the segment just viewed, else restore the previous scroll position.
    const { id, scrollY } = lastOpened.current;
    const link = id != null && [...(listRef.current?.querySelectorAll("a[data-segment-id]") || [])].find(a => a.dataset.segmentId === id);
    if (link) link.scrollIntoView({ block: "center" });
    else window.scrollTo(0, scrollY);
  }, [segmentId]);
  const allRows = useMemo(
    () => buildSegmentAttempts(raw.segmentData, filtered.activities, excludedSet),
    [raw.segmentData, filtered.activities, excludedSet]
  );
  const years = useMemo(() => [...new Set(allRows.flatMap(row => row.attempts
    .filter(attempt => attempt.date)
    .map(attempt => new Date(attempt.date).getFullYear())))].sort((a, b) => b - a), [allRows]);
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return buildSegmentAttempts(raw.segmentData, filtered.activities, excludedSet, { year, weekday, type })
      .filter(row => !query || row.name.toLowerCase().includes(query));
  }, [raw.segmentData, filtered.activities, excludedSet, year, weekday, type, search]);
  const missing = filtered.activities.filter(a => a.sport_type === "Ride" && !Object.hasOwn(raw.segmentData || {}, a.id)).length;
  const columns = [
    { key: "name", label: "Segment", wrap: true, render: row => <a href={`#/segments/${encodeURIComponent(row.id)}`} data-segment-id={row.id} onClick={() => { lastOpened.current = { id: row.id, scrollY: window.scrollY }; }}>{row.name}</a> },
    { key: "count", label: "Attempts", align: "r", value: row => row.attempts.length, render: row => comma(row.attempts.length) },
    { key: "distance", label: "Distance", align: "r", render: row => row.distance > 0 ? units.fmtDistance(row.distance, 2) : "—" },
    { key: "grade", label: "Avg grade", align: "r", render: row => gradeText(row.grade) },
    { key: "type", label: "Type", value: row => row.type ? TYPE_LABELS[row.type] : null, render: row => row.type ? TYPE_LABELS[row.type] : "—" },
    { key: "bestTime", label: "Best time", align: "r", render: row => row.bestTime == null ? "—" : formatDurationHms(row.bestTime) },
    { key: "lastDate", label: "Last attempt", value: row => row.lastDate ? new Date(row.lastDate).getTime() : null, render: row => row.lastDate ? formatDate(row.lastDate) : "—" }
  ];
  return (
    <>
    {segmentId && <SegmentDetail key={segmentId} id={segmentId} />}
    <div hidden={!!segmentId} ref={listRef}><div className="content">
      <PageHead title="Segments">Explore cached attempts, ranked from most to fewest. Use the global Bike filter to compare a particular bike.</PageHead>
      {missing > 0 && <div className="notice" role="status">{comma(missing)} filtered rides have no cached segment data. Attempts may be incomplete; use the PR backfill on the <a href="#/admin">Data page</a>.</div>}
      <p className="hint">Cached attempts may be incomplete. Year and weekday use the attempt date in your browser’s local time zone. Excluded segments and the global filters apply. Solo versus group rides cannot be filtered because the cache does not contain a reliable classification.</p>
      <Card title="Segment attempts">
        <div className="toolbar segment-filters">
          <label>Search <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Segment name" /></label>
          <label>Year <select value={year} onChange={e => setYear(e.target.value)}>
            <option value="all">All years</option>
            {year !== "all" && !years.includes(Number(year)) && <option value={year}>{year}</option>}
            {years.map(value => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <label>Day of week <select value={weekday} onChange={e => setWeekday(e.target.value)}>
            <option value="all">All days</option>
            {WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
          </select></label>
          <label>Type <select value={type} onChange={e => setType(e.target.value)}>
            <option value="all">All types</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        </div>
        <p className="small muted">Type uses Strava’s average grade: climb at +{SEGMENT_TYPE_GRADE}% or steeper, descent at −{SEGMENT_TYPE_GRADE}% or steeper, otherwise flat / rolling. Segments cached without a grade show “—” and are hidden when a type is selected.</p>
        <DataTable columns={columns} rows={rows} rowKey={row => row.id} initialSort={{ key: "count", dir: "desc" }} pageSize={50} caption="Segments by attempts" empty="No segment attempts match the current filters." />
      </Card>
    </div></div>
    </>
  );
}
