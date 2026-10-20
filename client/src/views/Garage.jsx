import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { filenameOf, focusPosition, useAppData } from "../context/AppData.jsx";
import {
  buildBikeTypeStats, buildUnmappedBikes, buildConsistencyStats,
  buildEverestStats, buildMileageMilestones, buildWeeklyRamp, buildBikeSummaryRows
} from "../lib/analytics.js";
import {
  comma, feet, formatDate, formatDayDifference, formatDuration, formatHms, formatShortDate, formatSpeed, getMondayForIsoWeek, miles
} from "../lib/format.js";
import { navigate } from "../lib/router.js";
import { usePersistentState } from "../lib/storage.js";
import { Card, ChartTip, DataTable, Empty, Icon, PageHead } from "../components/ui.jsx";
import PhotoGallery from "../components/PhotoGallery.jsx";

const SORTS = [
  { value: "distance-desc", label: "Distance (high to low)" },
  { value: "distance-asc", label: "Distance (low to high)" },
  { value: "rides-desc", label: "Activities (high to low)" },
  { value: "rides-asc", label: "Activities (low to high)" },
  { value: "name-asc", label: "Name (A–Z)" },
  { value: "name-desc", label: "Name (Z–A)" }
];

const plural = (n, w) => `${comma(n)} ${w}${n === 1 ? "" : "s"}`;
const tooltipProps = { wrapperStyle: { zIndex: 1000, pointerEvents: "none" }, allowEscapeViewBox: { x: true, y: true } };

function GarageAnalytics({ activities }) {
  const rides = useMemo(() => activities.filter(a => a.sport_type === "Ride"), [activities]);
  const bikeTypes = useMemo(() => buildBikeTypeStats(rides), [rides]);
  const unmapped = useMemo(() => buildUnmappedBikes(rides), [rides]);
  const consistency = useMemo(() => buildConsistencyStats(rides), [rides]);
  const ramp = useMemo(() => buildWeeklyRamp(rides), [rides]);
  const everest = useMemo(() => buildEverestStats(rides), [rides]);
  const milestones = useMemo(() => buildMileageMilestones(rides), [rides]);

  const typeRows = bikeTypes.map(row => ({ label: row.type, value: miles(row.distance) }));
  const everestRows = [...everest.years].reverse().map(row => ({ label: String(row.year), value: row.elevation }));
  const mileageFmt = value => `${comma(value.toFixed(1))} mi`;

  if (!rides.length) return null;
  return (
    <>
      <Card title="Bike type comparison">
        {typeRows.length ? (
          <div className="chart-box short" role="img" aria-label="Ride miles by bike type">
            <ResponsiveContainer>
              <BarChart data={typeRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={48} tickFormatter={value => comma(Math.round(value))} />
                <Tooltip {...tooltipProps} content={<ChartTip format={mileageFmt} />} cursor={{ fill: "var(--surface-hover)" }} />
                <Bar dataKey="value" name="Distance" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <p className="muted">No bike type data for the current filters.</p>}
        {unmapped.length > 0 && (
          <p className="hint">
            {plural(unmapped.length, "bike")} {unmapped.length === 1 ? "has" : "have"} no type. Add {unmapped.length === 1 ? "it" : "them"} to bike_types in config.local.js (then restart the server):{" "}
            {unmapped.map(b => `${b.gear_id}${b.name && b.name !== b.gear_id ? ` (${b.name})` : ""}`).join(", ")}
          </p>
        )}
      </Card>

      <div className="grid two">
        <Card title="Ride consistency">
          <div className="stat-row"><span>Longest ride streak</span><span className="num">{comma(consistency.longestDayStreak)} days</span></div>
          <div className="stat-row"><span>Longest qualifying-week streak</span><span className="num">{comma(consistency.longestWeekStreak)} weeks</span></div>
          <p className="hint">Qualifying weeks have at least {consistency.threshold} rides.</p>
          {consistency.years.length > 0 && <div className="week-list">
            {[...consistency.years].reverse().map(row => <div className="stat-row" key={row.year}>
              <span>{row.year}</span><span className="num">{comma(row.weeksMeetingThreshold)} qualifying weeks</span>
            </div>)}
          </div>}
        </Card>
        <Card title="Weekly mileage ramp">
          <div className="chart-box short" role="img" aria-label="Weekly ride mileage">
            <ResponsiveContainer>
              <BarChart data={ramp} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 12 }} width={48} tickFormatter={value => comma(Math.round(value))} />
                <Tooltip {...tooltipProps} content={<ChartTip format={mileageFmt} />} />
                <Bar dataKey="value" name="Distance" fill="var(--chart-2)">
                  {ramp.map(row => <Cell key={row.key} fill={row.warning ? "var(--negative)" : "var(--chart-2)"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="hint">Red weeks increased more than 10% over the previous week.</p>
        </Card>
      </div>

      <div className="grid two">
        <Card title="Everest challenge">
          <div className="record-value num">{everest.lifetime.toFixed(2)} Everests</div>
          <p className="hint">Lifetime climbing across the current filtered rides.</p>
          <div className="chart-box short" role="img" aria-label="Annual climbing by year">
            <ResponsiveContainer>
              <BarChart data={everestRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={48} tickFormatter={value => comma(Math.round(feet(value)))} />
                <Tooltip {...tooltipProps} content={<ChartTip format={value => `${comma(feet(value).toFixed(0))} ft`} />} />
                <Bar dataKey="value" name="Climbing" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Mileage milestones">
          <div className="record-value num">{comma(milestones.total.toFixed(1))} mi</div>
          <p className="hint">Lifetime mileage across the current filtered rides.</p>
          <div className="milestone-list">
            {milestones.achieved.map(item => (
              <div className="stat-row" key={`${item.target}-${item.date}`}>
                <span>{comma(item.target)} mi</span><span className="num">{formatDate(item.date)}</span>
              </div>
            ))}
            {milestones.upcomingList.map(item => (
              <div className="stat-row" key={`next-${item.target}`}>
                <span>{comma(item.target)} mi</span>
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
  const speed = formatSpeed(total.avg_speed_mph, "Ride");
  return (
    <div className="metrics num">
      <span>{comma(miles(total.distance).toFixed(1))} mi</span>
      <span>{comma(feet(total.elevation).toFixed(0))} ft</span>
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

function BikeSummary({ bikes }) {
  const { rows, total } = useMemo(() => buildBikeSummaryRows(
    Object.fromEntries(bikes.rows.map(r => [r.gid, r.total])),
    Object.fromEntries(bikes.rows.map(r => [r.gid, { name: r.name }])),
    gid => bikes.rows.find(r => r.gid === gid)?.isRetired
  ), [bikes.rows]);
  if (!rows.length) return null;
  const f1 = n => comma(n.toFixed(1));
  const f0 = n => comma(n.toFixed(0));
  const speed = n => (n > 0 ? n.toFixed(1) : "-");
  const columns = [
    { key: "name", label: "Name", render: r => r.gid ? <>{r.name}{r.retired && <span className="muted"> (retired)</span>}</> : r.name },
    { key: "count", label: "Count", align: "r", render: r => r.gid
      ? <a href={`#/activities?bike=${encodeURIComponent(r.gid)}`} aria-label={`View ${comma(r.count)} activities for ${r.name}`}>{comma(r.count)}</a>
      : comma(r.count) },
    { key: "distance", label: "Total distance (mi)", align: "r", render: r => f1(r.distance) },
    { key: "avgDistance", label: "Avg distance (mi)", align: "r", render: r => f1(r.avgDistance) },
    { key: "elevation", label: "Total elevation (ft)", align: "r", render: r => f0(r.elevation) },
    { key: "avgElevation", label: "Avg elevation (ft)", align: "r", render: r => f0(r.avgElevation) },
    { key: "time", label: "Total time", align: "r", render: r => formatHms(r.time) },
    { key: "avgTime", label: "Avg time", align: "r", render: r => formatHms(r.avgTime) },
    { key: "avgSpeed", label: "Avg speed (mph)", align: "r", render: r => speed(r.avgSpeed) },
    // No segments view can be filtered by bike, so PR counts link to that bike's Activities.
    { key: "prs", label: "PRs", align: "r", render: r => r.gid
      ? <a href={`#/activities?bike=${encodeURIComponent(r.gid)}`} aria-label={`View activities for ${r.name} (${comma(r.prs)} PRs)`}>{comma(r.prs)}</a>
      : comma(r.prs) }
  ];
  return (
    <Card title="All bikes">
      <DataTable columns={columns} rows={rows} rowKey={r => r.gid || "total"} initialSort={{ key: "distance", dir: "desc" }}
        caption="All bikes summary" pinnedRows={[{ ...total, name: "Total" }]} />
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
  const [open, setOpen] = useState(false);
  const weeks = useMemo(() => Object.entries(y.weeks || {}).map(([key, value]) => {
    const n = Number(key);
    const iso = !Number.isNaN(n) && n > 0 ? getMondayForIsoWeek(Number(year), n) : null;
    const label = value.week_start ? formatDate(value.week_start) : iso ? formatShortDate(iso) : value.label || key;
    const sortDate = value.week_start ? new Date(value.week_start).getTime() : iso ? iso.getTime() : n || 0;
    return { ...value, label, sortDate };
  }).sort((a, b) => b.sortDate - a.sortDate), [y, year]);
  const speed = formatSpeed(y.avg_speed_mph, "Ride");

  return (
    <>
      <tr>
        <td><button type="button" className="cell-link" aria-expanded={open} aria-controls={`weeks-${gid}-${year}`} onClick={() => setOpen(o => !o)}>{open ? "▾" : "▸"} {year}</button></td>
        <td className="r num">{comma(miles(y.distance).toFixed(1))} mi</td>
        <td className="r num">{comma(feet(y.elevation).toFixed(0))} ft</td>
        <td className="r num">{comma(y.count)}</td>
        <td className="r num">{formatDuration(y.moving_time)}</td>
        <td className="r num">{comma(y.pr_count || 0)}</td>
        <td className="r num">{speed ? speed.replace("avg ", "") : "—"}</td>
      </tr>
      {open && (
        <tr id={`weeks-${gid}-${year}`}>
          <td colSpan={7}>
            <div className="week-list">
              {weeks.length ? weeks.map(w => (
                <div className="week-row num" key={w.sortDate + w.label}>
                  <span>{w.label}</span>
                  <span>{comma(miles(w.distance).toFixed(1))} mi</span>
                  <span>{comma(feet(w.elevation).toFixed(0))} ft</span>
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
  const { insights, bikeImages, setBikeImages, bikePhotoPrefs, getCoverPhoto } = useAppData();
  const [galleryAt, setGalleryAt] = useState(null);
  const urls = bikeImages[bike.gid] || [];
  const cover = getCoverPhoto(bike.gid);
  const ins = insights.perBike[bike.gid] || {};
  const chart = [...bike.years].reverse().map(y => ({ label: y, value: miles(bike.bikeYearStats[y].distance) }));

  const onImagesChange = (gid, images) => setBikeImages(prev => {
    const next = { ...prev };
    if (images.length) next[gid] = images; else delete next[gid];
    return next;
  });

  const insightCards = [
    ["Biggest mileage week", ins.biggestMileageWeek ? `${comma(miles(ins.biggestMileageWeek.distance).toFixed(1))} mi` : "-", ins.biggestMileageWeek?.label],
    ["Biggest climbing week", ins.biggestClimbingWeek ? `${comma(feet(ins.biggestClimbingWeek.elevation).toFixed(0))} ft` : "-", ins.biggestClimbingWeek?.label],
    ["Most active week", ins.mostActiveWeek ? `${comma(ins.mostActiveWeek.count)} rides` : "-", ins.mostActiveWeek?.label],
    ["Share of ride mileage", `${((ins.distanceShare || 0) * 100).toFixed(1)}%`, "Of all Ride miles"],
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
        <Card title="Miles per year">
          <div className="chart-box short" role="img" aria-label={`Miles per year for ${bike.name}`}>
            <ResponsiveContainer>
              <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={48} tickFormatter={v => comma(Math.round(v))} />
                <Tooltip wrapperStyle={{ zIndex: 1000, pointerEvents: "none" }} allowEscapeViewBox={{ x: true, y: true }} content={<ChartTip format={v => `${comma(v.toFixed(1))} mi`} />} cursor={{ fill: "var(--surface-hover)" }} />
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
              <th scope="col" className="r">Activities</th><th scope="col" className="r">Time</th><th scope="col" className="r">PRs</th><th scope="col" className="r">Avg speed</th>
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
  const picked = bikes.selected.map(id => bikes.rows.find(r => r.gid === id)).filter(Boolean);
  const metrics = [
    ["Distance", t => `${comma(miles(t.distance).toFixed(1))} mi`],
    ["Elevation", t => `${comma(feet(t.elevation).toFixed(0))} ft`],
    ["Activities", t => comma(t.count)],
    ["Time", t => formatDuration(t.moving_time || 0)],
    ["PRs", t => `${comma(t.pr_count || 0)} PRs`],
    ["Avg speed", t => (t.avg_speed_mph ? `${t.avg_speed_mph.toFixed(1)} mph` : "—")]
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
