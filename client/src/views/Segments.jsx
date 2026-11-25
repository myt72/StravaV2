import { useEffect, useMemo, useState } from "react";
import { useAppData } from "../context/AppData.jsx";
import { useUnits } from "../context/Units.jsx";
import { bestSegmentAttemptsByBike, bestSegmentAttemptsByYear, buildSegmentAttempts, filterSegmentAttempts, WEEKDAYS } from "../lib/analytics.js";
import { comma, formatDate, formatDurationHms, getStravaSegmentUrl } from "../lib/format.js";
import { ActivityLink, Card, DataTable, PageHead } from "../components/ui.jsx";

function SegmentDetail({ id }) {
  const { raw, gearName } = useAppData();
  const [bike, setBike] = useState("all");
  const [year, setYear] = useState("all");
  const [weekday, setWeekday] = useState("all");
  useEffect(() => { document.getElementById("main-content")?.focus(); }, []);
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
  const yearlyColumns = [
    { key: "year", label: "Year" },
    { key: "elapsed", label: "Best time", align: "r", value: row => row.attempt.elapsed, render: row => formatDurationHms(row.attempt.elapsed) },
    { key: "bike", label: "Bike", value: row => gearName(row.attempt.activity.gear_id), render: row => gearName(row.attempt.activity.gear_id) },
    { key: "date", label: "Date", value: row => new Date(row.attempt.date).getTime(), render: row => formatDate(row.attempt.date) },
    { key: "activity", label: "Activity", wrap: true, value: row => row.attempt.activity.name || "", render: row => <ActivityLink activity={row.attempt.activity} /> }
  ];
  const bikeColumns = [
    { key: "bike", label: "Bike", value: row => row.bikeId ? gearName(row.bikeId) : "No bike recorded", render: row => row.bikeId ? gearName(row.bikeId) : "No bike recorded" },
    { key: "elapsed", label: "Best time", align: "r", value: row => row.attempt?.elapsed ?? null, render: row => row.attempt ? formatDurationHms(row.attempt.elapsed) : "—" },
    { key: "date", label: "Date", value: row => row.attempt?.date ? new Date(row.attempt.date).getTime() : null, render: row => row.attempt?.date ? formatDate(row.attempt.date) : "—" },
    { key: "activity", label: "Activity", wrap: true, value: row => row.attempt?.activity.name || "", render: row => row.attempt ? <ActivityLink activity={row.attempt.activity} /> : "—" }
  ];
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
        <p className="hint">Showing cached attempts across all activities, independently of the global filters. Dates use your browser’s local time zone. PR ranks are Strava’s recorded ranks, not ranks within the filtered results. Solo/group classification is not available.</p>
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
        </div>
        <p className="small muted" aria-live="polite">{comma(visible.length)} of {comma(attempts.length)} attempts</p>
        <h3>Best effort by year</h3>
        <p className="hint">Fastest elapsed time per year among the matching attempts. Attempts without a valid date or elapsed time are excluded.</p>
        <DataTable columns={yearlyColumns} rows={yearlyBests} rowKey={row => row.year} initialSort={{ key: "year", dir: "desc" }} caption={`Best efforts by year on ${row.name}`} empty="No matching attempts have a valid date and elapsed time." />
        <h3>Best effort by bike</h3>
        <p className="hint">Fastest elapsed time for each bike among the matching attempts. Select all bikes above to compare every bike.</p>
        <DataTable columns={bikeColumns} rows={bikeBests} rowKey={row => row.bikeId == null ? "missing" : `bike:${row.bikeId}`} initialSort={{ key: "elapsed", dir: "asc" }} caption={`Best efforts by bike on ${row.name}`} empty="No attempts on this segment match the current filters." />
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
  const segmentId = route.segments[1];
  const allRows = useMemo(
    () => buildSegmentAttempts(raw.segmentData, filtered.activities, excludedSet),
    [raw.segmentData, filtered.activities, excludedSet]
  );
  const years = useMemo(() => [...new Set(allRows.flatMap(row => row.attempts
    .filter(attempt => attempt.date)
    .map(attempt => new Date(attempt.date).getFullYear())))].sort((a, b) => b - a), [allRows]);
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return buildSegmentAttempts(raw.segmentData, filtered.activities, excludedSet, { year, weekday })
      .filter(row => !query || row.name.toLowerCase().includes(query));
  }, [raw.segmentData, filtered.activities, excludedSet, year, weekday, search]);
  const missing = filtered.activities.filter(a => a.sport_type === "Ride" && !Object.hasOwn(raw.segmentData || {}, a.id)).length;
  const columns = [
    { key: "name", label: "Segment", wrap: true, render: row => <a href={`#/segments/${encodeURIComponent(row.id)}`}>{row.name}</a> },
    { key: "count", label: "Attempts", align: "r", value: row => row.attempts.length, render: row => comma(row.attempts.length) },
    { key: "distance", label: "Distance", align: "r", render: row => row.distance > 0 ? units.fmtDistance(row.distance, 2) : "—" },
    { key: "bestTime", label: "Best time", align: "r", render: row => row.bestTime == null ? "—" : formatDurationHms(row.bestTime) },
    { key: "lastDate", label: "Last attempt", value: row => row.lastDate ? new Date(row.lastDate).getTime() : null, render: row => row.lastDate ? formatDate(row.lastDate) : "—" }
  ];
  return (
    <>
    {segmentId && <SegmentDetail key={segmentId} id={segmentId} />}
    <div hidden={!!segmentId}><div className="content">
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
        </div>
        <DataTable columns={columns} rows={rows} rowKey={row => row.id} initialSort={{ key: "count", dir: "desc" }} pageSize={50} caption="Segments by attempts" empty="No segment attempts match the current filters." />
      </Card>
    </div></div>
    </>
  );
}
