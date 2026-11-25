import { useMemo, useState } from "react";
import { useAppData } from "../context/AppData.jsx";
import { useUnits } from "../context/Units.jsx";
import { buildSegmentAttempts, WEEKDAYS } from "../lib/analytics.js";
import { comma, formatDate, formatDurationHms, getStravaSegmentUrl } from "../lib/format.js";
import { ActivityLink, Card, DataTable, PageHead } from "../components/ui.jsx";

export default function Segments() {
  const { raw, filtered, excludedSet, gearName } = useAppData();
  const units = useUnits();
  const [year, setYear] = useState("all");
  const [weekday, setWeekday] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
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
  const selectedRow = selected && rows.find(row => row.id === selected.id);
  const missing = filtered.activities.filter(a => a.sport_type === "Ride" && !Object.hasOwn(raw.segmentData || {}, a.id)).length;
  const columns = [
    { key: "name", label: "Segment", wrap: true, render: row => <button type="button" className="cell-link" onClick={() => setSelected({ id: row.id, name: row.name })}>{row.name}</button> },
    { key: "count", label: "Attempts", align: "r", value: row => row.attempts.length, render: row => comma(row.attempts.length) },
    { key: "distance", label: "Distance", align: "r", render: row => row.distance > 0 ? units.fmtDistance(row.distance, 2) : "—" },
    { key: "bestTime", label: "Best time", align: "r", render: row => row.bestTime == null ? "—" : formatDurationHms(row.bestTime) },
    { key: "lastDate", label: "Last attempt", value: row => row.lastDate ? new Date(row.lastDate).getTime() : null, render: row => row.lastDate ? formatDate(row.lastDate) : "—" }
  ];
  const attemptColumns = [
    { key: "date", label: "Date", value: row => row.date ? new Date(row.date).getTime() : null, render: row => row.date ? formatDate(row.date) : "—" },
    { key: "activity", label: "Activity", wrap: true, value: row => row.activity.name || "", render: row => <ActivityLink activity={row.activity} /> },
    { key: "bike", label: "Bike", value: row => gearName(row.activity.gear_id), render: row => gearName(row.activity.gear_id) },
    { key: "elapsed", label: "Elapsed time", align: "r", render: row => row.elapsed == null ? "—" : formatDurationHms(row.elapsed) },
    { key: "prRank", label: "PR", align: "r", render: row => row.prRank ? `#${row.prRank}` : "—" }
  ];

  return (
    <div className="content">
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
      {selected && <Card title={`${selected.name} — attempts`} right={<button type="button" className="btn sm" onClick={() => setSelected(null)}>Close</button>}>
        <p className="hint"><a href={getStravaSegmentUrl(selected.id)} target="_blank" rel="noopener noreferrer">Open segment on Strava</a>. Attempts follow all current filters; PR ranks are Strava’s recorded ranks, not ranks within the filtered results.</p>
        <DataTable columns={attemptColumns} rows={selectedRow?.attempts || []} rowKey={row => row.key} initialSort={{ key: "date", dir: "desc" }} pageSize={50} caption={`Attempts on ${selected.name}`} empty="No attempts on this segment match the current filters." />
      </Card>}
    </div>
  );
}
