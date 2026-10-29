import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAppData } from "../context/AppData.jsx";
import {
  getMetrics, longRideBandLabels, activityYears, buildGeoCoverage, buildRouteLeaderboard, buildSegmentConsistency, buildSegmentLeaderboard,
  buildSegmentBikeComparison, buildRouteBikeSpeed, buildSegmentBikeSpeed, getGearName, MIN_RIDES_PER_BIKE,
  buildLongRideBands, buildMonthHighlights, buildMonthYearMatrix, buildWeeklyDistanceAverages,
  buildSeasonalityIndex, buildTimeOfDayBreakdown, buildWeekdayBreakdown
} from "../lib/analytics.js";
import { comma, formatDate, formatDuration, getStravaSegmentUrl, MONTHS } from "../lib/format.js";
import { polylineToSvgPath } from "../lib/polyline.js";
import { navigate } from "../lib/router.js";
import { usePersistentState } from "../lib/storage.js";
import { useUnits } from "../context/Units.jsx";
import { Card, ChartTip, DataTable, Empty, PageHead, Segmented } from "../components/ui.jsx";

const metricOptions = units => [
  { value: "distance", label: units.metric ? "Kilometers" : "Miles" },
  { value: "moving_time", label: "Hours" },
  { value: "count", label: "Count" }
];

function PatternChart({ data, metric, color, paramKey, label, format, className = "" }) {
  const m = getMetrics(useUnits())[metric];
  return (
    <div className={`chart-box ${className}`.trim()} role="img" aria-label={label}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} width={48} tickFormatter={v => comma(Math.round(v))} />
          <Tooltip wrapperStyle={{ zIndex: 1000, pointerEvents: "none" }} allowEscapeViewBox={{ x: true, y: true }} content={<ChartTip format={format || m.fmt} />} cursor={{ fill: "var(--surface-hover)" }} />
          <Bar dataKey="value" name={m.label} fill={color} radius={[4, 4, 0, 0]} cursor={paramKey ? "pointer" : "default"}
            onClick={paramKey ? d => navigate("/activities", { [paramKey]: d.label }) : undefined} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const LIMIT_OPTIONS = [10, 20, 50].map(n => ({ value: n, label: String(n) }));
const PERIOD_OPTIONS = [{ value: "all", label: "All time" }, { value: "year", label: "Year" }, { value: "month", label: "Month" }];
const ROUTE_PERIOD_OPTIONS = [...PERIOD_OPTIONS, { value: "bikeSpeed", label: "Bike speed" }];
const SEGMENT_PERIOD_OPTIONS = [...PERIOD_OPTIONS, { value: "consistency", label: "Consistency" }, { value: "bike", label: "By bike" }, { value: "bikeSpeed", label: "Bike speed" }];
const MAX_BIKE_COLUMNS = 6;
const SPEED_MODE_OPTIONS = [{ value: "average", label: "Average" }, { value: "fastest", label: "Fastest" }];
const NEEDS_TWO_BIKES = "Needs rides on at least two bikes over the same route or segment.";
const KIND_OPTIONS = [{ value: "routes", label: "Routes" }, { value: "segments", label: "Segments" }];
const tooltipProps = { wrapperStyle: { zIndex: 1000, pointerEvents: "none" }, allowEscapeViewBox: { x: true, y: true } };

function MonthYearMatrix({ activities, metric }) {
  const units = useUnits();
  const METRICS = getMetrics(units);
  const { years, rows } = useMemo(() => buildMonthYearMatrix(activities, metric, units), [activities, metric, units]);
  const maximum = Math.max(0, ...rows.flatMap(row => years.map(year => row[year] || 0)));
  if (!years.length) return null;
  const columns = `repeat(${years.length + 1}, minmax(64px, 1fr))`;
  return (
    <div className="pattern-matrix-scroll">
      <div className="pattern-matrix" role="table" aria-label="Activity by month and year" style={{ "--matrix-columns": columns }}>
        <div className="pattern-matrix-row" role="row">
          <span role="columnheader">Month</span>
          {years.map(year => <span role="columnheader" key={year}>{year}</span>)}
        </div>
        {rows.map(row => (
          <div className="pattern-matrix-row" role="row" key={row.month}>
            <span role="rowheader">{row.label}</span>
            {years.map(year => {
              const value = row[year] || 0;
              const intensity = maximum ? value / maximum : 0;
              const label = `${row.label} ${year}: ${METRICS[metric].fmt(value)}`;
              return (
                <button type="button" role="cell" key={year} title={label} aria-label={label}
                  style={{ background: `color-mix(in srgb, var(--chart-1) ${Math.round(12 + intensity * 72)}%, var(--surface))` }}
                  onClick={() => navigate("/activities", { month: `${year}-${String(row.month + 1).padStart(2, "0")}` })}>
                  {value ? METRICS[metric].fmt(value) : "—"}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthPatterns({ activities, metric }) {
  const units = useUnits();
  const highlights = useMemo(() => buildMonthHighlights(activities, metric, units), [activities, metric, units]);
  const seasonality = useMemo(() => buildSeasonalityIndex(activities, metric, units), [activities, metric, units]);
  const m = getMetrics(units)[metric];
  const rolling = highlights.rolling;
  const bestLabel = row => row ? MONTHS[row.month - 1] : "—";
  return (
    <>
      <div className="patterns-split">
        <Card title="Monthly highlights" className="patterns-highlights">
          {highlights.highlights.length ? (
            <div className="table-wrap scroll-region" role="region" aria-label="Best and lowest months by year" tabIndex={0}>
              <table className="data">
                <caption className="sr-only">Best and lowest activity months by year</caption>
                <thead><tr><th scope="col">Year</th><th scope="col">Best month</th><th scope="col">Lowest month</th></tr></thead>
                <tbody>{highlights.highlights.map(row => (
                  <tr key={row.year}>
                    <td>{row.year}</td>
                    <td>{bestLabel(row.best)} · {m.fmt(row.best.value)}</td>
                    <td>{bestLabel(row.worst)} · {m.fmt(row.worst.value)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="muted">No monthly activity to summarize.</p>}
        </Card>
        <div className="patterns-stack">
          <Card title="Seasonality">
            <PatternChart className="compact" data={seasonality} metric="count" color="var(--chart-4)" label="Monthly seasonality index" format={value => `${value.toFixed(1)}%`} />
            <p className="hint">Average share of each year’s {m.label.toLowerCase()} that falls in each month.</p>
          </Card>
          {rolling.length > 0 && (
            <Card title="Rolling 12-month totals">
              <div className="chart-box compact" role="img" aria-label={`Rolling 12-month ${m.label.toLowerCase()}`}>
                <ResponsiveContainer>
                  <BarChart data={rolling} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 12 }} width={48} tickFormatter={value => comma(Math.round(value))} />
                    <Tooltip {...tooltipProps} content={<ChartTip format={m.fmt} />} cursor={{ fill: "var(--surface-hover)" }} />
                    <Bar dataKey="value" name={m.label} fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function WeeklyAverages({ activities }) {
  const units = useUnits();
  const rows = useMemo(() => buildWeeklyDistanceAverages(activities, new Date(), units), [activities, units]);
  if (!rows.length) return null;
  const chartData = rows.map(r => ({ label: String(r.year), value: r.average }));
  return (
    <Card title="Weekly distance average per year">
      <div className="grid two">
        <div className="table-wrap scroll-region tall" role="region" aria-label="Weekly distance average per year" tabIndex={0}>
          <table className="data">
            <caption className="sr-only">Average distance per week by year, newest first</caption>
            <thead><tr><th scope="col">Year</th><th scope="col" className="r">{units.distUnit} / week</th><th scope="col" className="r">vs prior year</th><th scope="col" className="r">Total {units.distUnit}</th><th scope="col" className="r">Weeks</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.year}>
                <td>{r.year}{r.partial ? " (YTD)" : ""}</td>
                <td className="r num"><strong>{r.average.toFixed(1)}</strong></td>
                <td className="r num">{r.delta == null ? <span className="muted">—</span> : <span className={r.delta >= 0 ? "positive" : "negative"}>{r.delta >= 0 ? "▲ +" : "▼ "}{r.delta.toFixed(1)}</span>}</td>
                <td className="r num">{comma(r.total.toFixed(0))}</td>
                <td className="r num">{r.weeks}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <PatternChart className="tall" data={chartData} metric="distance" color="var(--chart-1)" label="Weekly distance average per year"
          format={v => `${v.toFixed(1)} ${units.distUnit}/wk`} />
      </div>
      <p className="hint">Total distance in the year ÷ weeks in the year: full 52/53 ISO weeks for completed years, weeks elapsed so far (day of year ÷ 7, rounded up) for the current year. Follows the global filters.</p>
    </Card>
  );
}

const LONG_RIDE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "color-mix(in srgb, var(--chart-1) 55%, var(--chart-4))"];

function LongRidesByYear({ activities }) {
  const units = useUnits();
  const LONG_RIDE_BANDS = longRideBandLabels(units);
  const rows = useMemo(() => buildLongRideBands(activities, new Date(), units), [activities, units]);
  if (!rows.length) return null;
  return (
    <Card title="Long rides by year">
      <div className="grid two">
        <div className="table-wrap scroll-region tall" role="region" aria-label="Long rides by distance band and year" tabIndex={0}>
          <table className="data">
            <caption className="sr-only">Long rides by exclusive distance band and year, newest first</caption>
            <thead><tr><th scope="col">Year</th>{LONG_RIDE_BANDS.map(band => <th scope="col" className="r" key={band}>{band} {units.distUnit}</th>)}<th scope="col" className="r">Total</th></tr></thead>
            <tbody>{rows.map(row => (
              <tr key={row.year}>
                <td>{row.year}{row.partial ? " (YTD)" : ""}</td>
                {LONG_RIDE_BANDS.map(band => (
                  <td className="r num" key={band}>{row.bands[band] ? comma(row.bands[band]) : <span className="muted" aria-label={`No rides ${band} ${units.metric ? "kilometers" : "miles"}`}>—</span>}</td>
                ))}
                <td className="r num">{comma(row.total)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="chart-box tall" role="img" aria-label="Grouped bar chart of long rides by exclusive distance band and year">
          <ResponsiveContainer>
            <BarChart data={rows.map(row => ({ ...row, label: `${row.year}${row.partial ? " (YTD)" : ""}` }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={48} tickFormatter={value => comma(Math.round(value))} />
              <Tooltip {...tooltipProps} content={<ChartTip format={value => comma(value)} />} cursor={{ fill: "var(--surface-hover)" }} />
              <Legend />
              {LONG_RIDE_BANDS.map((band, i) => <Bar key={band} dataKey={`bands.${band}`} name={`${band} ${units.distUnit}`} fill={LONG_RIDE_COLORS[i]} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="hint">Bands are exclusive: each ride is counted once. Rides under {LONG_RIDE_BANDS[0].split("-")[0]} {units.distUnit} are not counted. Follows the global filters.</p>
    </Card>
  );
}

function RouteThumb({ polyline, name }) {
  const d = polylineToSvgPath(polyline);
  if (!d) return <span className="muted small" aria-hidden="true">—</span>;
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" role="img" aria-label={`Shape of ${name}`}>
      <path d={d} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MatchedRides() {
  const { raw, filtered, excludedSet, status } = useAppData();
  const units = useUnits();
  const [limit, setLimit] = usePersistentState("matchedLimit", 20);
  const [savedPeriod, setPeriod] = usePersistentState("matchedPeriod", "all");
  const [year, setYear] = usePersistentState("matchedYear", null);
  const [month, setMonth] = usePersistentState("matchedMonth", new Date().getMonth() + 1);
  const [savedKind, setKind] = usePersistentState("matchedKind", "routes");
  const [savedSpeedMode, setSpeedMode] = usePersistentState("matchedSpeedMode", "average");
  const speedMode = savedSpeedMode === "fastest" ? "fastest" : "average";
  const [open, setOpen] = useState(() => new Set());

  // The card follows the global activity-type filter; segments only exist for rides.
  const hasRides = useMemo(() => filtered.activities.some(a => a.sport_type === "Ride"), [filtered.activities]);
  const hasFoot = useMemo(() => filtered.activities.some(a => a.sport_type === "Walk" || a.sport_type === "Hike"), [filtered.activities]);
  const kind = hasRides ? savedKind : "routes";
  const noun = hasFoot && !hasRides ? "Walked" : hasFoot ? "Done" : "Ridden";

  const consistency = kind === "segments" && savedPeriod === "consistency";
  const bikeCmp = kind === "segments" && savedPeriod === "bike";
  const bikeSpeed = savedPeriod === "bikeSpeed";
  const special = consistency || bikeCmp || bikeSpeed;
  const period = kind === "routes" && (savedPeriod === "consistency" || savedPeriod === "bike") ? "all" : savedPeriod;
  const years = useMemo(() => activityYears(filtered.activities), [filtered.activities]);
  const activeYear = years.includes(year) ? year : years[0] ?? null;
  const opts = useMemo(() => ({
    limit,
    year: period === "all" || special ? null : activeYear,
    month: period === "month" ? month : null
  }), [limit, period, special, activeYear, month]);

  const coverage = useMemo(() => buildGeoCoverage(raw?.activities), [raw]);
  const consistencyRows = useMemo(() => (
    consistency ? buildSegmentConsistency(raw?.segmentData, filtered.activities, excludedSet, { limit }) : []
  ), [consistency, raw, filtered.activities, excludedSet, limit]);
  const consistencyColumns = [
    { key: "rank", label: "#", sortable: false, render: r => consistencyRows.indexOf(r) + 1 },
    { key: "name", label: "Segment", wrap: true, render: r => <a href={getStravaSegmentUrl(r.segmentId)} target="_blank" rel="noopener noreferrer">{r.name}</a> },
    ...years.map(y => ({
      key: `y${y}`, label: String(y), align: "r", value: r => r.counts[y] || 0,
      render: r => (r.counts[y] ? comma(r.counts[y]) : <span className="muted" aria-label="No efforts">—</span>)
    })),
    { key: "yearsActive", label: "Years active", align: "r", render: r => comma(r.yearsActive) },
    { key: "total", label: "Total", align: "r", render: r => comma(r.total) }
  ];
  const gearLabel = gid => getGearName(raw?.gearDetails, gid);
  const bikeCmpData = useMemo(() => (
    bikeCmp ? buildSegmentBikeComparison(raw?.segmentData, filtered.activities, excludedSet, { limit }) : null
  ), [bikeCmp, raw, filtered.activities, excludedSet, limit]);
  const speedData = useMemo(() => {
    if (!bikeSpeed) return null;
    return kind === "routes"
      ? buildRouteBikeSpeed(raw?.routeClusters, filtered.activities, { limit, mode: speedMode })
      : buildSegmentBikeSpeed(raw?.segmentData, filtered.activities, excludedSet, { limit, mode: speedMode });
  }, [bikeSpeed, kind, raw, filtered.activities, excludedSet, limit, speedMode]);
  const none = () => null;
  const bikeCmpColumns = (() => {
    if (!bikeCmpData) return [];
    const shown = bikeCmpData.bikes.slice(0, MAX_BIKE_COLUMNS);
    return [
      { key: "name", label: "Segment", wrap: true, render: r => <a href={getStravaSegmentUrl(r.segmentId)} target="_blank" rel="noopener noreferrer">{r.name}</a> },
      ...shown.map(gid => ({
        key: `b${gid}`, label: gearLabel(gid), align: "r", value: r => r.bikes[gid]?.best ?? null,
        render: r => {
          const b = r.bikes[gid];
          if (!b) return <span className="muted" aria-label="No efforts">—</span>;
          return (
            <span title={`${b.count} effort${b.count === 1 ? "" : "s"}`}>
              <strong style={r.bestBike === gid ? { color: "var(--chart-1)" } : undefined}>{formatDuration(b.best)}</strong>
              <br /><span className="muted small">{comma(b.count)} effort{b.count === 1 ? "" : "s"}</span>
            </span>
          );
        }
      })),
      { key: "bestBike", label: "Best bike", value: r => gearLabel(r.bestBike), render: r => gearLabel(r.bestBike) },
      { key: "gap", label: "Gap", align: "r", value: r => r.gapSeconds, render: r => `${formatDuration(r.gapSeconds)} (${r.gapPct.toFixed(1)}%)` },
      { key: "total", label: "Efforts", align: "r", render: r => comma(r.total) }
    ];
  })();
  const speedColumns = (() => {
    if (!speedData) return [];
    const fastestMode = speedMode === "fastest";
    const hi = { color: "var(--chart-1)" };
    const nameLink = r => (kind === "segments" ? <a href={getStravaSegmentUrl(r.segmentId)} target="_blank" rel="noopener noreferrer">{r.name}</a> : r.name);
    const unranked = b => !b.ranked && !fastestMode;
    return [
      { key: "name", label: kind === "routes" ? "Route" : "Segment", wrap: true, render: nameLink, renderChild: c => (
        <span className={unranked(c) ? "muted" : undefined}>{gearLabel(c.gid)}
          {unranked(c) && <span className="small" title={`Fewer than ${MIN_RIDES_PER_BIKE} rides: not ranked`}> n={c.rides}</span>}
        </span>
      ) },
      { key: "bikes", label: "Bikes", align: "r", value: r => r.bikeCount, render: r => comma(r.bikeCount), renderChild: none },
      { key: "fastest", label: fastestMode ? "Fastest bike (single ride)" : "Fastest bike (average)", value: r => gearLabel(r.fastestBike), render: r => gearLabel(r.fastestBike), renderChild: none },
      { key: "diff", label: "Difference", align: "r", value: r => r.diffPct, render: r => `+${r.diffPct.toFixed(1)}%`,
        renderChild: (c, r) => (c.ranked && c.gid !== r.fastestBike ? <span className="muted">{`${((c.speed / r.bikes[r.fastestBike].speed - 1) * 100).toFixed(1)}%`}</span> : null) },
      { key: "avg", label: fastestMode ? "Avg speed" : "Avg speed ★", align: "r", sortable: false, render: none,
        renderChild: c => <span className="num" style={!fastestMode && c.ranked && c.gid === c.fastest ? hi : undefined}>{!fastestMode ? <strong>{units.fmtSpeed(c.avgSpeed)}</strong> : units.fmtSpeed(c.avgSpeed)}</span> },
      { key: "best", label: fastestMode ? "Fastest speed ★" : "Fastest speed", align: "r", sortable: false, render: none,
        renderChild: c => <span className="num">{fastestMode ? <strong>{units.fmtSpeed(c.bestSpeed)}</strong> : units.fmtSpeed(c.bestSpeed)}</span> },
      { key: "rides", label: "Rides", align: "r", value: r => r.total, render: r => comma(r.total), renderChild: c => comma(c.rides) },
      { key: "bestDate", label: "Fastest on", sortable: false, render: none, renderChild: c => (c.bestDate ? formatDate(c.bestDate) : "—") }
    ];
  })();
  const rows = useMemo(() => (
    kind === "routes"
      ? buildRouteLeaderboard(raw?.routeClusters, filtered.activities, opts)
      : buildSegmentLeaderboard(raw?.segmentData, filtered.activities, excludedSet, opts)
  ), [kind, raw, filtered.activities, excludedSet, opts]);
  const toggle = key => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const columns = [
    { key: "rank", label: "#", sortable: false, render: r => rows.indexOf(r) + 1, renderChild: none },
    {
      key: "name", label: kind === "routes" ? "Route" : "Segment", wrap: true,
      ...(kind === "segments" ? { render: r => <a href={getStravaSegmentUrl(r.segmentId)} target="_blank" rel="noopener noreferrer">{r.name}</a> } : {}),
      renderChild: c => (
        <a href={c.activity.url} target="_blank" rel="noopener noreferrer">{c.activity.name || "Activity"}</a>
      )
    },
    ...(kind === "routes" ? [{ key: "thumb", label: "Shape", sortable: false, render: r => <RouteThumb polyline={r.polyline} name={r.name} />, renderChild: none }] : []),
    { key: "count", label: "Rides", align: "r", render: r => comma(r.count), renderChild: none },
    { key: "firstRidden", label: `First ${noun.toLowerCase()}`, value: r => new Date(r.firstRidden).getTime(), render: r => formatDate(r.firstRidden), renderChild: c => formatDate(c.activity.start_date) },
    { key: "lastRidden", label: `Last ${noun.toLowerCase()}`, value: r => new Date(r.lastRidden).getTime(), render: r => formatDate(r.lastRidden), renderChild: none },
    { key: "distance", label: "Distance", align: "r", render: r => (r.distance ? units.fmtDistance(r.distance) : "—"), renderChild: c => units.fmtDistance(c.activity.distance) },
    { key: "elevation", label: "Elevation", align: "r", render: r => (r.elevation ? units.fmtElevation(r.elevation) : "—"), renderChild: c => units.fmtElevation(c.activity.total_elevation_gain) }
  ];

  return (
    <Card title="Matched rides" right={
      <div className="toolbar">
        {hasRides && <Segmented label="Leaderboard type" value={kind} options={KIND_OPTIONS} onChange={setKind} />}
        <Segmented label="Rows" value={limit} options={LIMIT_OPTIONS} onChange={setLimit} />
        <Segmented label="Period" value={period} options={kind === "segments" ? SEGMENT_PERIOD_OPTIONS : ROUTE_PERIOD_OPTIONS} onChange={setPeriod} />
        {!special && period !== "all" && (
          <select aria-label="Year" value={activeYear ?? ""} onChange={e => setYear(Number(e.target.value))}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
        {!special && period === "month" && (
          <select aria-label="Month" value={month} onChange={e => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        )}
      </div>
    }>
      {kind === "routes" && coverage.pending > 0 && (
        <div className="notice" role="status" style={{ marginBottom: 12 }}>
          {comma(coverage.total - coverage.pending)} of {comma(coverage.total)} rides have been checked for GPS data
          ({comma(coverage.withGps)} with a route). Route matching is incomplete until the geo backfill finishes.{" "}
          <button type="button" className="cell-link" onClick={() => navigate("/admin")}>Open Data &amp; Admin</button>
        </div>
      )}
      {status === "loading" ? <p className="muted" role="status">Loading…</p> : bikeCmp ? (
        <>
          {bikeCmpData.rows.length > 0 && (
            <div className="table-wrap" style={{ marginBottom: 12 }}>
              <table className="data" aria-label="Segments won by bike: segments where each bike holds the best time, out of the shared segments that bike has ridden">
                <thead>
                  <tr>{bikeCmpData.bikes.map(gid => <th key={gid} scope="col" className="r">{gearLabel(gid)}</th>)}</tr>
                </thead>
                <tbody>
                  <tr>
                    {bikeCmpData.bikes.map(gid => (
                      <td key={gid} className="r num">
                        <strong>{comma(bikeCmpData.wins[gid] || 0)}</strong> of {comma(bikeCmpData.sharedCounts[gid])} segments won
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
              <p className="hint">Wins count shared segments where the bike holds the best time; the total is the shared segments that bike has ridden.</p>
            </div>
          )}
          <DataTable columns={bikeCmpColumns} rows={bikeCmpData.rows} rowKey={r => r.key} caption="Best segment time by bike"
            initialSort={{ key: "total", dir: "desc" }} empty={NEEDS_TWO_BIKES} />
        </>
      ) : bikeSpeed ? (
        <>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <Segmented label="Speed basis" value={speedMode} options={SPEED_MODE_OPTIONS} onChange={setSpeedMode} />
          </div>
          {speedData.index.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <h3 className="small" style={{ margin: "0 0 4px" }}>Bike speed index</h3>
              <ol aria-label="Bike speed index ranking" style={{ margin: 0, paddingLeft: 20 }}>
                {speedData.index.map(b => (
                  <li key={b.gid}>
                    {gearLabel(b.gid)}: <strong className="num">{b.index >= 0 ? "+" : ""}{b.index.toFixed(1)}%</strong>
                    <span className="muted small"> vs course average · {comma(b.courses)} course{b.courses === 1 ? "" : "s"} · {comma(b.rides)} rides</span>
                  </li>
                ))}
              </ol>
              <p className="hint">Average of each bike’s % difference from the course-average speed (on the selected basis), across routes/segments ridden on multiple bikes only.</p>
            </div>
          )}
          <DataTable columns={speedColumns} rows={speedData.rows} rowKey={r => r.key}
            caption={`${speedMode === "fastest" ? "Fastest" : "Average"} speed by bike on the same ${kind === "routes" ? "routes" : "segments"}`}
            initialSort={{ key: "rides", dir: "desc" }} empty={NEEDS_TWO_BIKES}
            expand={{
              position: "start",
              isOpen: r => open.has(`speed:${r.key}`),
              toggle: r => toggle(`speed:${r.key}`),
              label: r => `Show ${r.bikeCount} bike${r.bikeCount === 1 ? "" : "s"} for ${r.name}`,
              children: r => r.bikeList.map(b => ({ ...b, key: b.gid, fastest: r.fastestBike }))
            }} />
        </>
      ) : consistency ? (
        <DataTable columns={consistencyColumns} rows={consistencyRows} rowKey={r => r.key} caption="Segment consistency by year"
          empty="No segments with efforts in multiple years." />
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={r => r.key} caption="Matched rides leaderboard"
          empty={kind === "routes" ? "No matched routes for this period yet." : "No segment efforts for this period."}
          expand={{
            isOpen: r => open.has(r.key),
            toggle: r => toggle(r.key),
            label: r => `Show ${r.count} rides for ${r.name}`,
            children: r => r.rides.map(a => ({ key: a.id, activity: a }))
          }} />
      )}
      <p className="hint">
        Routes are matched from GPS summaries (start/finish, Hausdorff, DTW, overlap and, for rides, shared segments); reversed rides count as a different route.
        Rides, and Walks + Hikes, are matched separately. Counts follow the global filters above, including the activity type. Expand a row to see its rides.
        {bikeCmp && " By bike shows your fastest time per bike on segments ridden on 2+ bikes (up to six bikes shown). Wind, group rides and e-bikes affect fairness; bikes with few efforts are less reliable."}
        {bikeSpeed && ` Bike speed compares bikes on the same ${kind === "routes" ? "route" : "segment"}; expand a row to see only the bikes that rode it. Average = total distance / total time; Fastest = the single fastest ${kind === "routes" ? "ride" : "effort"}. The toggle sets the ranking basis (★), fastest bike, difference and index. Average needs ${MIN_RIDES_PER_BIKE}+ rides per bike (others are listed as n= but not ranked); Fastest needs one. Wind, group rides, e-bikes and few shared rides can skew results.`}
        {consistency && " Consistency ranks segments ridden in 2+ years by years with efforts, then the most even yearly counts (lowest coefficient of variation), then total efforts."}
      </p>
    </Card>
  );
}

export default function Patterns() {
  const { filtered } = useAppData();
  const units = useUnits();
  const [metric, setMetric] = usePersistentState("patternMetric", "distance");
  const weekday = useMemo(() => buildWeekdayBreakdown(filtered.activities, metric, units), [filtered.activities, metric, units]);
  const tod = useMemo(() => buildTimeOfDayBreakdown(filtered.activities, metric, units), [filtered.activities, metric, units]);

  const counts = Object.entries(filtered.activityCounts || {}).sort((a, b) => b[1] - a[1]);
  const total = counts.reduce((s, [, c]) => s + c, 0);

  return (
    <div className="content">
      <PageHead title="Patterns" right={<Segmented label="Metric" value={metric} options={metricOptions(units)} onChange={setMetric} />}>
        When you ride. Click a bar to list those activities. Times use your browser’s local time zone.
      </PageHead>
      {!filtered.activities.length ? <Empty /> : (
        <>
          <Card title="Month by year">
            <MonthYearMatrix activities={filtered.activities} metric={metric} />
          </Card>
          <WeeklyAverages activities={filtered.activities} />
          <LongRidesByYear activities={filtered.activities} />
          <div className="grid two">
            <Card title="Day of week"><PatternChart data={weekday} metric={metric} color="var(--chart-1)" paramKey="dow" className="dow" label="Bar chart by day of week" /></Card>
            <Card title="Time of day">
              <PatternChart data={tod} metric={metric} color="var(--chart-3)" paramKey="tod" className="dow" label="Bar chart by time of day" />
              <p className="hint">Early AM 0–6 · Morning 6–12 · Afternoon 12–17 · Evening 17–21 · Night 21–24</p>
            </Card>
          </div>
          <MonthPatterns activities={filtered.activities} metric={metric} />
          <Card title="Activity types">
            <div className="grid three">
              {counts.map(([type, count]) => {
                const pct = total ? (count / total) * 100 : 0;
                return (
                  <div key={type}>
                    <div className="stat-row" style={{ border: 0, padding: "2px 0" }}>
                      <span>{type}</span><span className="num muted small">{comma(count)} • {pct.toFixed(1)}%</span>
                    </div>
                    <div className="progress" role="img" aria-label={`${type}: ${pct.toFixed(1)}%`}><div style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </Card>
          <MatchedRides />
        </>
      )}
    </div>
  );
}
