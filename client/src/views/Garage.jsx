import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { filenameOf, focusPosition, useAppData } from "../context/AppData.jsx";
import {
  buildBikeTypeStats, buildUnmappedBikes, buildConsistencyStats, buildBikePrSegments,
  buildEverestStats, buildMileageMilestones, buildWeeklyRamp, buildBikeSummaryRows
} from "../lib/analytics.js";
import {
  comma, formatDate, formatDayDifference, formatDuration, formatHms, formatShortDate, formatSpeed, getMondayForIsoWeek, getStravaSegmentUrl
} from "../lib/format.js";
import { useUnits } from "../context/Units.jsx";
import { navigate } from "../lib/router.js";
import { usePersistentState } from "../lib/storage.js";
import { ActivityLink, Card, ChartTip, DataTable, Drawer, Empty, Icon, PageHead, Segmented } from "../components/ui.jsx";
import PhotoGallery from "../components/PhotoGallery.jsx";

const SORTS = [
  { value: "distance-desc", label: "Distance (high to low)" },
  { value: "distance-asc", label: "Distance (low to high)" },
  { value: "rides-desc", label: "Activities (high to low)" },
  { value: "rides-asc", label: "Activities (low to high)" },
  { value: "name-asc", label: "Name (A–Z)" },
  { value: "name-desc", label: "Name (Z–A)" }
];

const typeMetrics = units => [
  { value: "distance", label: units.metric ? "Kilometers" : "Miles" },
  { value: "elevation", label: "Elevation" },
  { value: "count", label: "Rides" },
  { value: "hours", label: "Hours" }
];
const typeMetricValue = (row, metric, units) => (
  metric === "distance" ? units.distance(row.distance)
    : metric === "elevation" ? units.elevation(row.elevation)
      : metric === "hours" ? row.hours
        : row.count
);

const plural = (n, w) => `${comma(n)} ${w}${n === 1 ? "" : "s"}`;
const tooltipProps = { wrapperStyle: { zIndex: 1000, pointerEvents: "none" }, allowEscapeViewBox: { x: true, y: true } };

function EverestTip({ active, payload, label }) {
  const units = useUnits();
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="chart-tip">
      <strong>{label}</strong>
      <div style={{ color: payload[0].color || payload[0].fill }}>{units.fmtElevationValue(row.value, 0)}</div>
      <div>{row.everests.toFixed(1)}x Everests</div>
    </div>
  );
}

function GarageAnalytics({ activities }) {
  const units = useUnits();
  const TYPE_METRICS = typeMetrics(units);
  const rides = useMemo(() => activities.filter(a => a.sport_type === "Ride"), [activities]);
  const bikeTypes = useMemo(() => buildBikeTypeStats(rides, units), [rides, units]);
  const unmapped = useMemo(() => buildUnmappedBikes(rides), [rides]);
  const consistency = useMemo(() => buildConsistencyStats(rides), [rides]);
  const ramp = useMemo(() => buildWeeklyRamp(rides, "distance", new Date(), units), [rides, units]);
  const everest = useMemo(() => buildEverestStats(rides, units), [rides, units]);
  const milestones = useMemo(() => buildMileageMilestones(rides, new Date(), 90, units), [rides, units]);

  const [typeMetric, setTypeMetric] = usePersistentState("bikeTypeMetric", "distance");
  const typeMax = Math.max(0, ...bikeTypes.map(row => typeMetricValue(row, typeMetric, units)));
  const everestRows = [...everest.years].reverse().map(row => ({ label: String(row.year), value: row.elevation, everests: row.everests }));
  const rampRows = [...ramp].reverse();
  const nextMilestone = milestones.upcomingList[0] || null;
  const laterMilestones = milestones.upcomingList.slice(1);
  const prevTarget = milestones.achieved.length ? milestones.achieved[milestones.achieved.length - 1].target : 0;
  const nextProgress = nextMilestone ? Math.min(1, Math.max(0, (milestones.total - prevTarget) / (nextMilestone.target - prevTarget))) : 0;
  const rampMax = Math.max(0, ...ramp.map(row => row.value));

  if (!rides.length) return null;
  return (
    <>
      <Card title="Bike type comparison" right={<Segmented label="Bar metric" value={typeMetric} options={TYPE_METRICS} onChange={setTypeMetric} />}>
        {bikeTypes.length ? (
          <div className="table-wrap">
            <table className="data type-table">
              <caption className="sr-only">Ride totals by bike type</caption>
              <thead><tr>
                <th scope="col">Type</th><th scope="col" className="r">Rides</th><th scope="col" className="r">{units.metric ? "Kilometers" : "Miles"}</th>
                <th scope="col" className="r">Elevation ({units.elevUnit})</th><th scope="col" className="r">Avg ride ({units.distUnit})</th>
                <th scope="col" className="r">{units.elevUnit} / {units.distUnit}</th><th scope="col" className="r">Avg {units.speedUnit}</th>
                <th scope="col">{TYPE_METRICS.find(o => o.value === typeMetric).label}</th>
              </tr></thead>
              <tbody>{bikeTypes.map(row => {
                const value = typeMetricValue(row, typeMetric, units);
                return (
                  <tr key={row.type}>
                    <th scope="row" style={{ position: "static" }}>{row.type}</th>
                    <td className="r num">{comma(row.count)}</td>
                    <td className="r num">{comma(units.distance(row.distance).toFixed(1))}</td>
                    <td className="r num">{comma(units.elevation(row.elevation).toFixed(0))}</td>
                    <td className="r num">{row.avgRide.toFixed(1)}</td>
                    <td className="r num">{row.elevationPerDistance.toFixed(0)}</td>
                    <td className="r num">{row.avgSpeed > 0 ? row.avgSpeed.toFixed(1) : "—"}</td>
                    <td className="bar-cell">
                      <div className="bar-track" role="img" aria-label={`${row.type}: ${comma(value.toFixed(typeMetric === "count" ? 0 : 1))} ${TYPE_METRICS.find(o => o.value === typeMetric).label.toLowerCase()}`}>
                        <div className="bar-fill" style={{ width: `${typeMax ? (value / typeMax) * 100 : 0}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : <p className="muted">No bike type data for the current filters.</p>}
        {unmapped.length > 0 && (
          <p className="hint">
            {plural(unmapped.length, "bike")} {unmapped.length === 1 ? "has" : "have"} no type. Add {unmapped.length === 1 ? "it" : "them"} to bike_types in config.local.js (then restart the server):{" "}
            {unmapped.map(b => `${b.gear_id}${b.name && b.name !== b.gear_id ? ` (${b.name})` : ""}`).join(", ")}
          </p>
        )}
      </Card>

      <div className="grid two garage-stats">
        <Card title="Ride consistency" className="fill">
          <div className="stat-row"><span>Longest ride streak</span><span className="num">{comma(consistency.longestDayStreak)} days</span></div>
          <div className="stat-row"><span>Longest qualifying-week streak</span><span className="num">{comma(consistency.longestWeekStreak)} weeks</span></div>
          <p className="hint">Qualifying weeks have at least {consistency.threshold} rides.</p>
          {consistency.years.length > 0 && (
            <div className="week-list scroll-region grow" role="region" aria-label="Qualifying weeks by year, newest first" tabIndex={0}>
              <div className="stat-row scroll-head"><strong>Year</strong><strong>Qualifying weeks</strong></div>
              {[...consistency.years].reverse().map(row => <div className="stat-row" key={row.year}>
                <span>{row.year}</span><span className="num">{comma(row.weeksMeetingThreshold)} qualifying weeks</span>
              </div>)}
            </div>
          )}
        </Card>
        <Card title="Weekly mileage ramp" className="fill">
          <div className="scroll-region grow" role="region" aria-label="Weekly ride mileage, newest week first" tabIndex={0}>
            <div className="ramp-row head"><span>Week of</span><span aria-hidden="true" /><span className="r">{units.metric ? "Km" : "Miles"}</span><span className="r">Change</span></div>
            {rampRows.map(row => (
              <div className={`ramp-row num${row.warning ? " warn" : ""}`} key={row.key}>
                <span>{row.label}, {row.key.slice(0, 4)}</span>
                <div className="bar-track" aria-hidden="true"><div className="bar-fill" style={{ width: `${rampMax ? (row.value / rampMax) * 100 : 0}%` }} /></div>
                <span className="r">{row.value.toFixed(1)}</span>
                <span className={`r${row.warning ? " negative" : ""}`}>{row.change == null ? "—" : `${row.change > 0 ? "+" : ""}${row.change.toFixed(0)}%`}</span>
              </div>
            ))}
          </div>
          <p className="hint">Red weeks increased more than 10% over the previous week.</p>
        </Card>

        <Card title="Everest challenge" className="fill">
          <div className="record-value num">{everest.lifetime.toFixed(2)} Everests</div>
          <p className="hint">Lifetime climbing across the current filtered rides.</p>
          <div className="chart-box short" role="img" aria-label="Annual climbing by year">
            <ResponsiveContainer>
              <BarChart data={everestRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={48} tickFormatter={value => comma(Math.round(value))} />
                <Tooltip {...tooltipProps} content={<EverestTip />} cursor={false} />
                <Bar dataKey="value" name="Climbing" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Mileage milestones" className="fill">
          <div className="record-value num">{units.fmtDistanceValue(milestones.total, 1)}</div>
          <p className="hint">Lifetime mileage across the current filtered rides.</p>
          {nextMilestone && (
            <div className="milestone-next">
              <div className="stat-row">
                <span>Next: <strong className="num">{comma(nextMilestone.target)} {units.distUnit}</strong></span>
                <span className="num">{nextMilestone.date ? `${formatDate(nextMilestone.date)} (projected)` : "not projected"}</span>
              </div>
              <div className="bar-track" role="progressbar" aria-label={`Progress to ${comma(nextMilestone.target)} ${units.metric ? "kilometers" : "miles"}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(nextProgress * 100)}>
                <div className="bar-fill" style={{ width: `${nextProgress * 100}%` }} />
              </div>
              <div className="hint num">{units.fmtDistanceValue(nextMilestone.target - milestones.total, 1)} to go</div>
            </div>
          )}
          <div className="milestone-grid scroll-region grow" role="region" aria-label="Mileage milestones, passed and projected" tabIndex={0}>
            {milestones.achieved.map(item => (
              <div className="milestone-tile done" key={`${item.target}-${item.date}`}>
                <span className="num">{comma(item.target)} {units.distUnit}</span><span className="num">{formatDate(item.date)}</span>
              </div>
            ))}
            {laterMilestones.map(item => (
              <div className="milestone-tile" key={`next-${item.target}`}>
                <span className="num">{comma(item.target)} {units.distUnit}</span>
                <span className="num">{item.date ? `${formatDate(item.date)} (projected)` : "not projected"}</span>
              </div>
            ))}
          </div>
          <p className="hint">Projections use the {milestones.upcomingList[0]?.pace || "90-day average"} pace.</p>
        </Card>
      </div>
    </>
  );
}

function useBikes() {
  const { filtered } = useAppData();
  const [pinned, setPinned] = usePersistentState("pinnedBikes", []);
  const [selected, setSelected] = usePersistentState("compareBikes", []);
  const [manualRetired, setManualRetired] = usePersistentState("retiredBikes", []);
  const details = filtered.gearDetails || {};
  // Strava gear details carry a boolean `retired`; only fall back to a manual toggle if no bike has that field.
  const hasRetiredField = Object.values(details).some(d => typeof d?.retired === "boolean");
  const rows = useMemo(() => Object.keys(filtered.bikeYearStats || {}).map(gid => ({
    gid,
    name: details[gid]?.name || gid,
    isRetired: hasRetiredField ? details[gid]?.retired === true : manualRetired.includes(gid),
    total: filtered.gearTotals[gid],
    bikeYearStats: filtered.bikeYearStats[gid],
    years: Object.keys(filtered.bikeYearStats[gid]).sort((a, b) => b - a),
    isPinned: pinned.includes(gid)
  })).filter(r => r.total), [filtered, pinned, details, hasRetiredField, manualRetired]);
  const toggle = (list, set) => id => set(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  return { rows, canToggleRetired: !hasRetiredField, toggleRetired: toggle(manualRetired, setManualRetired), pinned, togglePin: toggle(pinned, setPinned), selected, toggleSelected: toggle(selected, setSelected), setSelected };
}

function BikeStats({ total, gid, name }) {
  const units = useUnits();
  const speed = formatSpeed(total.avg_speed_mph, "Ride", units);
  return (
    <div className="metrics num">
      <span>{units.fmtDistance(total.distance)}</span>
      <span>{units.fmtElevation(total.elevation)}</span>
      <span>
        <a href={`#/activities?bike=${encodeURIComponent(gid)}`} aria-label={`View ${plural(total.count, "activity").replace("activitys", "activities")} for ${name}`}>
          {plural(total.count, "activity").replace("activitys", "activities")}
        </a>
      </span>
      <span>{formatDuration(total.moving_time)}</span>
      <span>{plural(total.pr_count || 0, "PR")}</span>
      {speed && <span>{speed}</span>}
    </div>
  );
}

function Thumb({ gid, alt }) {
  const { getCoverPhoto } = useAppData();
  const { url, focus } = getCoverPhoto(gid);
  return (
    <div className="bike-thumb">
      {url ? <img src={url} alt={alt} loading="lazy" style={{ objectPosition: focusPosition(focus) }} /> : <Icon name="bike" size={40} className="" />}
    </div>
  );
}

function PrSegmentsDrawer({ bike, onClose }) {
  const { raw, filtered, excludedSet } = useAppData();
  const segments = useMemo(
    () => buildBikePrSegments(raw?.segmentData, filtered.activities, bike.gid, excludedSet),
    [raw, filtered.activities, bike.gid, excludedSet]
  );
  const total = segments.reduce((n, r) => n + r.count, 0);
  return (
    <Drawer title={`PR segments: ${bike.name}`} onClose={onClose} wide>
      {segments.length ? (
        <div className="table-wrap">
          <table className="data">
            <caption className="sr-only">Segments where {bike.name} has a PR</caption>
            <thead><tr>
              <th scope="col">Segment</th><th scope="col" className="r">PR efforts</th><th scope="col" className="r">Best time</th>
              <th scope="col">Latest PR</th><th scope="col">Activity</th>
            </tr></thead>
            <tbody>{segments.map(r => (
              <tr key={r.segmentId}>
                <td className="wrap"><a href={getStravaSegmentUrl(r.segmentId)} target="_blank" rel="noopener noreferrer">{r.name}</a></td>
                <td className="r num">{comma(r.count)}</td>
                <td className="r num">{r.bestTime ? formatHms(r.bestTime) : "—"}</td>
                <td>{formatDate(r.latestDate)}</td>
                <td className="wrap"><ActivityLink activity={r.latestActivity} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="muted">No PR segment efforts are cached for this bike with the current filters and excluded segments.</p>}
      <p className="hint">
        {comma(segments.length)} segments, {comma(total)} PR efforts (rank 1), following the global filters and excluded segments.
        {" "}<a href={`#/activities?bike=${encodeURIComponent(bike.gid)}`} onClick={onClose}>View this bike’s activities</a>
      </p>
    </Drawer>
  );
}

function BikeSummary({ bikes }) {
  const units = useUnits();
  const [sort, setSort] = useState({ key: "distance", dir: "desc" });
  const [retiredOpen, setRetiredOpen] = usePersistentState("bikeSummaryRetiredOpen", false);
  const [prBike, setPrBike] = useState(null);
  const { rows, total } = useMemo(() => buildBikeSummaryRows(
    Object.fromEntries(bikes.rows.map(r => [r.gid, r.total])),
    Object.fromEntries(bikes.rows.map(r => [r.gid, { name: r.name }])),
    gid => bikes.rows.find(r => r.gid === gid)?.isRetired,
    units
  ), [bikes.rows, units]);
  if (!rows.length) return null;
  const f1 = n => comma(n.toFixed(1));
  const f0 = n => comma(n.toFixed(0));
  const speed = n => (n > 0 ? n.toFixed(1) : "-"); // avgSpeed is already in the display unit
  const columns = [
    { key: "name", label: "Name", render: r => r.name },
    { key: "count", label: "Count", align: "r", render: r => r.gid
      ? <a href={`#/activities?bike=${encodeURIComponent(r.gid)}`} aria-label={`View ${comma(r.count)} activities for ${r.name}`}>{comma(r.count)}</a>
      : comma(r.count) },
    { key: "distance", label: `Total distance (${units.distUnit})`, align: "r", render: r => f1(r.distance) },
    { key: "avgDistance", label: `Avg distance (${units.distUnit})`, align: "r", render: r => f1(r.avgDistance) },
    { key: "elevation", label: `Total elevation (${units.elevUnit})`, align: "r", render: r => f0(r.elevation) },
    { key: "avgElevation", label: `Avg elevation (${units.elevUnit})`, align: "r", render: r => f0(r.avgElevation) },
    { key: "time", label: "Total time", align: "r", render: r => formatHms(r.time) },
    { key: "avgTime", label: "Avg time", align: "r", render: r => formatHms(r.avgTime) },
    { key: "avgSpeed", label: `Avg speed (${units.speedUnit})`, align: "r", render: r => speed(r.avgSpeed) },
    // PR counts open the list of PR segments for that bike (segmentData joined with the bike's activities).
    { key: "prs", label: "PRs", align: "r", render: r => r.gid && r.prs > 0
      ? <button type="button" className="cell-link" aria-haspopup="dialog" aria-label={`Show ${comma(r.prs)} PR segments for ${r.name}`} onClick={() => setPrBike(r)}>{comma(r.prs)}</button>
      : comma(r.prs) }
  ];
  const active = rows.filter(r => !r.retired);
  const retired = rows.filter(r => r.retired);
  const tableProps = { columns, rowKey: r => r.gid || "total", sort, onSortChange: setSort };
  return (
    <Card title="All bikes">
      <h3 className="subhead">Active bikes ({active.length})</h3>
      <DataTable {...tableProps} rows={active} caption="Active bikes summary" empty="No active bikes."
        pinnedRows={[{ ...total, name: `Total (all ${rows.length} bikes)` }]} />
      {retired.length > 0 && (
        <>
          <h3 className="subhead">
            <button type="button" className="cell-link" aria-expanded={retiredOpen} aria-controls="all-bikes-retired" onClick={() => setRetiredOpen(o => !o)}>
              {retiredOpen ? "▾" : "▸"} Retired bikes ({retired.length})
            </button>
          </h3>
          {retiredOpen && <div id="all-bikes-retired"><DataTable {...tableProps} rows={retired} caption="Retired bikes summary" /></div>}
        </>
      )}
      {prBike && <PrSegmentsDrawer bike={prBike} onClose={() => setPrBike(null)} />}
    </Card>
  );
}

function GarageList({ bikes, activities }) {
  const [search, setSearch] = usePersistentState("bikeSearch", "");
  const [sort, setSort] = usePersistentState("bikeSort", "distance-desc");

  const [retiredOpen, setRetiredOpen] = useState(true);

  const rows = useMemo(() => {
    const q = search.toLowerCase().trim();
    const [field, direction] = sort.split("-");
    const dir = direction === "asc" ? 1 : -1;
    return bikes.rows.filter(r => r.name.toLowerCase().includes(q)).sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      if (field === "name") return a.name.localeCompare(b.name) * dir;
      if (field === "rides") return (a.total.count - b.total.count) * dir;
      return (a.total.distance - b.total.distance) * dir;
    });
  }, [bikes.rows, search, sort]);

  const current = rows.filter(r => !r.isRetired);
  const retired = rows.filter(r => r.isRetired);

  const renderCard = r => (
    <Card key={r.gid} className="bike-card">
      <button type="button" style={{ all: "unset", cursor: "pointer", display: "block" }} onClick={() => navigate(`/garage/${r.gid}`)} aria-label={`Open ${r.name}`}>
        <Thumb gid={r.gid} alt="" />
      </button>
      <a className="bike-title" href={`#/garage/${encodeURIComponent(r.gid)}`}>{r.name}</a>
      <BikeStats total={r.total} gid={r.gid} name={r.name} />
      <div className="card-actions">
        <label className="check"><input type="checkbox" checked={bikes.selected.includes(r.gid)} onChange={() => bikes.toggleSelected(r.gid)} /> Compare</label>
        <button type="button" className="btn sm" aria-pressed={r.isPinned} onClick={() => bikes.togglePin(r.gid)}>{r.isPinned ? "Pinned" : "Pin"}</button>
        {bikes.canToggleRetired && (
          <button type="button" className="btn sm" onClick={() => bikes.toggleRetired(r.gid)}>{r.isRetired ? "Unretire" : "Retire"}</button>
        )}
      </div>
    </Card>
  );

  const selectedCount = bikes.selected.filter(id => bikes.rows.some(r => r.gid === id)).length;

  return (
    <div className="content">
      <PageHead title="Garage"
        right={selectedCount
          ? <a className="btn" href="#/garage/compare">Compare bikes ({selectedCount})</a>
          : <button type="button" className="btn" disabled>Compare bikes (0)</button>}>
        Pick a bike for its yearly history and photos, or tick “Compare” on several bikes.
      </PageHead>
      <GarageAnalytics activities={activities} />
      <BikeSummary bikes={bikes} />
      <div className="toolbar">
        <input type="search" placeholder="Search bikes…" aria-label="Search bikes" value={search} onChange={e => setSearch(e.target.value)} />
        <label className="toolbar">Sort
          <select value={sort} onChange={e => setSort(e.target.value)}>
            {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      </div>
      {!rows.length ? <Empty>No bikes match the current filters.</Empty> : (
        <>
          {current.length > 0 && (
            <section className="garage-section" aria-labelledby="garage-current">
              <h2 id="garage-current" className="garage-heading">Current ({current.length})</h2>
              <div className="grid garage-grid">{current.map(renderCard)}</div>
            </section>
          )}
          {retired.length > 0 && (
            <section className="garage-section" aria-labelledby="garage-retired">
              <h2 id="garage-retired" className="garage-heading">
                <button type="button" className="cell-link" aria-expanded={retiredOpen} aria-controls="garage-retired-grid" onClick={() => setRetiredOpen(o => !o)}>
                  {retiredOpen ? "▾" : "▸"} Retired ({retired.length})
                </button>
              </h2>
              {retiredOpen && <div id="garage-retired-grid" className="grid garage-grid">{retired.map(renderCard)}</div>}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function YearRow({ gid, year, y }) {
  const units = useUnits();
  const [open, setOpen] = useState(false);
  const weeks = useMemo(() => Object.entries(y.weeks || {}).map(([key, value]) => {
    const n = Number(key);
    const iso = !Number.isNaN(n) && n > 0 ? getMondayForIsoWeek(Number(year), n) : null;
    const label = value.week_start ? formatDate(value.week_start) : iso ? formatShortDate(iso) : value.label || key;
    const sortDate = value.week_start ? new Date(value.week_start).getTime() : iso ? iso.getTime() : n || 0;
    return { ...value, label, sortDate };
  }).sort((a, b) => b.sortDate - a.sortDate), [y, year]);
  const speed = formatSpeed(y.avg_speed_mph, "Ride", units);

  return (
    <>
      <tr>
        <td>{year}</td>
        <td className="r num">{units.fmtDistance(y.distance)}</td>
        <td className="r num">{units.fmtElevation(y.elevation)}</td>
        <td className="r num">{comma(y.count)}</td>
        <td className="r num">{formatDuration(y.moving_time)}</td>
        <td className="r num">{comma(y.pr_count || 0)}</td>
        <td className="r num">{speed ? speed.replace("avg ", "") : "—"}</td>
        <td className="expand-cell">
          <button type="button" className="expand-btn" aria-expanded={open} aria-controls={`weeks-${gid}-${year}`}
            aria-label={`Show weekly breakdown for ${year}`} title={`Show weekly breakdown for ${year}`} onClick={() => setOpen(o => !o)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </td>
      </tr>
      {open && (
        <tr id={`weeks-${gid}-${year}`}>
          <td colSpan={8}>
            <div className="week-list">
              {weeks.length ? weeks.map(w => (
                <div className="week-row num" key={w.sortDate + w.label}>
                  <span>{w.label}</span>
                  <span>{units.fmtDistance(w.distance)}</span>
                  <span>{units.fmtElevation(w.elevation)}</span>
                  <span>{comma(w.count)} act.</span>
                  <span>{formatDuration(w.moving_time)}</span>
                  {w.trend ? <span className={w.trend > 0 ? "positive" : "negative"}>{w.trend > 0 ? "▲" : "▼"} {Math.abs(w.trend * 100).toFixed(0)}%</span> : null}
                </div>
              )) : <span className="muted">No weekly data</span>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function BikeDetail({ bike, bikes }) {
  const units = useUnits();
  const { insights, bikeImages, setBikeImages, bikePhotoPrefs, getCoverPhoto } = useAppData();
  const [galleryAt, setGalleryAt] = useState(null);
  const urls = bikeImages[bike.gid] || [];
  const cover = getCoverPhoto(bike.gid);
  const ins = insights.perBike[bike.gid] || {};
  const chart = [...bike.years].reverse().map(y => ({ label: y, value: units.distance(bike.bikeYearStats[y].distance) }));

  const onImagesChange = (gid, images) => setBikeImages(prev => {
    const next = { ...prev };
    if (images.length) next[gid] = images; else delete next[gid];
    return next;
  });

  const insightCards = [
    ["Biggest mileage week", ins.biggestMileageWeek ? units.fmtDistance(ins.biggestMileageWeek.distance) : "-", ins.biggestMileageWeek?.label],
    ["Biggest climbing week", ins.biggestClimbingWeek ? units.fmtElevation(ins.biggestClimbingWeek.elevation) : "-", ins.biggestClimbingWeek?.label],
    ["Most active week", ins.mostActiveWeek ? `${comma(ins.mostActiveWeek.count)} rides` : "-", ins.mostActiveWeek?.label],
    ["Share of ride mileage", `${((ins.distanceShare || 0) * 100).toFixed(1)}%`, units.metric ? "Of all Ride kilometers" : "Of all Ride miles"],
    ["Share of ride count", `${((ins.countShare || 0) * 100).toFixed(1)}%`, "Of all Ride activities"],
    ["First / last ride", formatDate(ins.firstRide), `${formatDate(ins.lastRide)} · ${formatDayDifference(ins.firstRide, ins.lastRide)}`]
  ];

  return (
    <div className="content">
      <a className="crumb" href="#/garage">← All bikes</a>
      <PageHead title={bike.name}
        right={(
          <div className="toolbar">
            <label className="check"><input type="checkbox" checked={bikes.selected.includes(bike.gid)} onChange={() => bikes.toggleSelected(bike.gid)} /> Compare</label>
            <button type="button" className="btn sm" aria-pressed={bike.isPinned} onClick={() => bikes.togglePin(bike.gid)}>{bike.isPinned ? "Pinned" : "Pin"}</button>
          </div>
        )} />
      <BikeStats total={bike.total} gid={bike.gid} name={bike.name} />

      <div className="grid three">
        {insightCards.map(([label, value, sub]) => (
          <Card key={label}>
            <div className="record-label">{label}</div>
            <div className="record-value num">{value}</div>
            {sub && <div className="record-sub">{sub}</div>}
          </Card>
        ))}
      </div>

      <div className="grid two">
        <Card title={`${units.metric ? "Kilometers" : "Miles"} per year`}>
          <div className="chart-box short" role="img" aria-label={`${units.metric ? "Kilometers" : "Miles"} per year for ${bike.name}`}>
            <ResponsiveContainer>
              <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={48} tickFormatter={v => comma(Math.round(v))} />
                <Tooltip wrapperStyle={{ zIndex: 1000, pointerEvents: "none" }} allowEscapeViewBox={{ x: true, y: true }} content={<ChartTip format={v => units.fmtDistanceValue(v, 1)} />} cursor={{ fill: "var(--surface-hover)" }} />
                <Bar dataKey="value" name="Distance" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title={`Photos (${urls.length})`}
          right={<button type="button" className="btn sm primary" onClick={() => setGalleryAt(0)}>{urls.length ? "Open gallery" : "Add photos"}</button>}>
          {urls.length ? (
            <div className="photo-grid">
              {urls.slice(0, 6).map((u, i) => (
                <button key={u} type="button" aria-label={`Open photo ${i + 1} of ${urls.length}`} onClick={() => setGalleryAt(i)}><img src={u} alt="" loading="lazy" style={{ objectPosition: focusPosition(bikePhotoPrefs[bike.gid]?.focus?.[filenameOf(u)]) }} />{u === cover.url && urls.length > 1 && <span className="cover-badge">★ Cover</span>}</button>
              ))}
            </div>
          ) : <p className="muted">No photos yet.</p>}
        </Card>
      </div>

      <Card title="History by year">
        <div className="table-wrap">
          <table className="data">
            <caption className="sr-only">Yearly statistics for {bike.name}. Select a year to show its weekly breakdown.</caption>
            <thead><tr>
              <th scope="col">Year</th><th scope="col" className="r">Distance</th><th scope="col" className="r">Elevation</th>
              <th scope="col" className="r">Activities</th><th scope="col" className="r">Time</th><th scope="col" className="r">PRs</th><th scope="col" className="r">Avg speed</th><th scope="col" className="expand-cell"><span className="sr-only">Expand</span></th>
            </tr></thead>
            <tbody>{bike.years.map(y => <YearRow key={y} gid={bike.gid} year={y} y={bike.bikeYearStats[y]} />)}</tbody>
          </table>
        </div>
      </Card>

      {galleryAt !== null && (
        <PhotoGallery gid={bike.gid} name={bike.name} urls={urls} startIndex={galleryAt}
          onImagesChange={onImagesChange} onClose={() => setGalleryAt(null)} />
      )}
    </div>
  );
}

function Compare({ bikes }) {
  const units = useUnits();
  const picked = bikes.selected.map(id => bikes.rows.find(r => r.gid === id)).filter(Boolean);
  const metrics = [
    ["Distance", t => units.fmtDistance(t.distance)],
    ["Elevation", t => units.fmtElevation(t.elevation)],
    ["Activities", t => comma(t.count)],
    ["Time", t => formatDuration(t.moving_time || 0)],
    ["PRs", t => `${comma(t.pr_count || 0)} PRs`],
    ["Avg speed", t => (t.avg_speed_mph ? units.fmtSpeed(t.avg_speed_mph) : "—")]
  ];
  return (
    <div className="content">
      <a className="crumb" href="#/garage">← All bikes</a>
      <PageHead title="Compare bikes" right={picked.length ? <button type="button" className="btn" onClick={() => bikes.setSelected([])}>Clear comparison</button> : null}>
        Side-by-side totals for the current filters.
      </PageHead>
      {!picked.length ? <Empty>No bikes selected. Tick “Compare” on bike cards in the Garage.</Empty> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th scope="col">Metric</th>{picked.map(b => (
              <th scope="col" key={b.gid}><a href={`#/garage/${encodeURIComponent(b.gid)}`}>{b.name}</a>{" "}
                <button type="button" className="btn sm ghost" aria-label={`Remove ${b.name} from comparison`} onClick={() => bikes.toggleSelected(b.gid)}>✕</button></th>
            ))}</tr></thead>
            <tbody>{metrics.map(([label, fn]) => (
              <tr key={label}><th scope="row" style={{ position: "static" }}>{label}</th>{picked.map(b => <td key={b.gid} className="num">{fn(b.total)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Garage({ route }) {
  const bikes = useBikes();
  const { filtered } = useAppData();
  const sub = route.segments[1];
  if (sub === "compare") return <Compare bikes={bikes} />;
  if (sub) {
    const bike = bikes.rows.find(r => r.gid === sub);
    if (!bike) {
      return (
        <div className="content">
          <a className="crumb" href="#/garage">← All bikes</a>
          <Empty>That bike has no activities in the current filters.</Empty>
        </div>
      );
    }
    return <BikeDetail bike={bike} bikes={bikes} />;
  }
  return <GarageList bikes={bikes} activities={filtered.activities} />;
}
