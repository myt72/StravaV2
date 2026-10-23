import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAppData } from "../context/AppData.jsx";
import {
  METRICS, activityYears, buildGeoCoverage, buildRouteLeaderboard, buildSegmentConsistency, buildSegmentLeaderboard,
  buildLongRideBands, buildMonthHighlights, buildMonthYearMatrix, buildWeeklyDistanceAverages,
  buildSeasonalityIndex, buildTimeOfDayBreakdown, buildWeekdayBreakdown
} from "../lib/analytics.js";
import { comma, fmtFeet, fmtMiles, formatDate, getStravaSegmentUrl, MONTHS } from "../lib/format.js";
import { polylineToSvgPath } from "../lib/polyline.js";
import { navigate } from "../lib/router.js";
import { usePersistentState } from "../lib/storage.js";
import { Card, ChartTip, DataTable, Empty, PageHead, Segmented } from "../components/ui.jsx";

const OPTIONS = [
  { value: "distance", label: "Miles" },
  { value: "moving_time", label: "Hours" },
  { value: "count", label: "Count" }
];

function PatternChart({ data, metric, color, paramKey, label, format, className = "" }) {
  const m = METRICS[metric];
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
const SEGMENT_PERIOD_OPTIONS = [...PERIOD_OPTIONS, { value: "consistency", label: "Consistency" }];
const KIND_OPTIONS = [{ value: "routes", label: "Routes" }, { value: "segments", label: "Segments" }];
const tooltipProps = { wrapperStyle: { zIndex: 1000, pointerEvents: "none" }, allowEscapeViewBox: { x: true, y: true } };

function MonthYearMatrix({ activities, metric }) {
  const { years, rows } = useMemo(() => buildMonthYearMatrix(activities, metric), [activities, metric]);
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
  const highlights = useMemo(() => buildMonthHighlights(activities, metric), [activities, metric]);
  const seasonality = useMemo(() => buildSeasonalityIndex(activities, metric), [activities, metric]);
  const m = METRICS[metric];
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
  const rows = useMemo(() => buildWeeklyDistanceAverages(activities), [activities]);
  if (!rows.length) return null;
  const chartData = rows.map(r => ({ label: String(r.year), value: r.average }));
  return (
    <Card title="Weekly distance average per year">
      <div className="grid two">
        <div className="table-wrap scroll-region tall" role="region" aria-label="Weekly distance average per year" tabIndex={0}>
          <table className="data">
            <caption className="sr-only">Average miles per week by year, newest first</caption>
            <thead><tr><th scope="col">Year</th><th scope="col" className="r">Mi / week</th><th scope="col" className="r">vs prior year</th><th scope="col" className="r">Total mi</th><th scope="col" className="r">Weeks</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.year}>
                <td>{r.year}{r.partial ? " (YTD)" : ""}</td>
                <td className="r num"><strong>{r.average.toFixed(1)}</strong></td>
                <td className="r num">{r.delta == null ? <span className="muted">—</span> : <span className={r.delta >= 0 ? "positive" : "negative"}>{r.delta >= 0 ? "▲ +" : "▼ "}{r.delta.toFixed(1)}</span>}</td>
                <td className="r num">{comma(r.miles.toFixed(0))}</td>
                <td className="r num">{r.weeks}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <PatternChart className="tall" data={chartData} metric="distance" color="var(--chart-1)" label="Weekly distance average per year"
          format={v => `${v.toFixed(1)} mi/wk`} />
      </div>
      <p className="hint">Total miles in the year ÷ weeks in the year: full 52/53 ISO weeks for completed years, weeks elapsed so far (day of year ÷ 7, rounded up) for the current year. Follows the global filters.</p>
    </Card>
  );
}

const LONG_RIDE_BANDS = ["20-25", "25-30", "30-35", "35-40", "40-45", "45-50", "50+"];
const LONG_RIDE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "color-mix(in srgb, var(--chart-1) 55%, var(--chart-4))"];

function LongRidesByYear({ activities }) {
  const rows = useMemo(() => buildLongRideBands(activities), [activities]);
  if (!rows.length) return null;
  return (
    <Card title="Long rides by year">
      <div className="grid two">
        <div className="table-wrap scroll-region tall" role="region" aria-label="Long rides by distance band and year" tabIndex={0}>
          <table className="data">
            <caption className="sr-only">Long rides by exclusive distance band and year, newest first</caption>
            <thead><tr><th scope="col">Year</th>{LONG_RIDE_BANDS.map(band => <th scope="col" className="r" key={band}>{band} mi</th>)}<th scope="col" className="r">Total</th></tr></thead>
            <tbody>{rows.map(row => (
              <tr key={row.year}>
                <td>{row.year}{row.partial ? " (YTD)" : ""}</td>
                {LONG_RIDE_BANDS.map(band => (
                  <td className="r num" key={band}>{row.bands[band] ? comma(row.bands[band]) : <span className="muted" aria-label={`No rides ${band} miles`}>—</span>}</td>
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
              {LONG_RIDE_BANDS.map((band, i) => <Bar key={band} dataKey={`bands.${band}`} name={`${band} mi`} fill={LONG_RIDE_COLORS[i]} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="hint">Bands are exclusive: each ride is counted once. Rides under 20 mi are not counted. Follows the global filters.</p>
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
  const [limit, setLimit] = usePersistentState("matchedLimit", 20);
  const [savedPeriod, setPeriod] = usePersistentState("matchedPeriod", "all");
  const [year, setYear] = usePersistentState("matchedYear", null);
  const [month, setMonth] = usePersistentState("matchedMonth", new Date().getMonth() + 1);
  const [savedKind, setKind] = usePersistentState("matchedKind", "routes");
  const [open, setOpen] = useState(() => new Set());

  // The card follows the global activity-type filter; segments only exist for rides.
  const hasRides = useMemo(() => filtered.activities.some(a => a.sport_type === "Ride"), [filtered.activities]);
  const hasFoot = useMemo(() => filtered.activities.some(a => a.sport_type === "Walk" || a.sport_type === "Hike"), [filtered.activities]);
  const kind = hasRides ? savedKind : "routes";
  const noun = hasFoot && !hasRides ? "Walked" : hasFoot ? "Done" : "Ridden";

  const consistency = kind === "segments" && savedPeriod === "consistency";
  const period = kind === "routes" && savedPeriod === "consistency" ? "all" : savedPeriod;
  const years = useMemo(() => activityYears(filtered.activities), [filtered.activities]);
  const activeYear = years.includes(year) ? year : years[0] ?? null;
  const opts = useMemo(() => ({
    limit,
    year: period === "all" || consistency ? null : activeYear,
    month: period === "month" ? month : null
  }), [limit, period, consistency, activeYear, month]);

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

  const none = () => null;
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
    { key: "distance", label: "Distance", align: "r", render: r => (r.distance ? fmtMiles(r.distance) : "—"), renderChild: c => fmtMiles(c.activity.distance) },
    { key: "elevation", label: "Elevation", align: "r", render: r => (r.elevation ? fmtFeet(r.elevation) : "—"), renderChild: c => fmtFeet(c.activity.total_elevation_gain) }
  ];

  return (
    <Card title="Matched rides" right={
      <div className="toolbar">
        {hasRides && <Segmented label="Leaderboard type" value={kind} options={KIND_OPTIONS} onChange={setKind} />}
        <Segmented label="Rows" value={limit} options={LIMIT_OPTIONS} onChange={setLimit} />
        <Segmented label="Period" value={period} options={kind === "segments" ? SEGMENT_PERIOD_OPTIONS : PERIOD_OPTIONS} onChange={setPeriod} />
        {!consistency && period !== "all" && (
          <select aria-label="Year" value={activeYear ?? ""} onChange={e => setYear(Number(e.target.value))}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
        {!consistency && period === "month" && (
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
      {status === "loading" ? <p className="muted" role="status">Loading…</p> : consistency ? (
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
        {consistency && " Consistency ranks segments ridden in 2+ years by years with efforts, then the most even yearly counts (lowest coefficient of variation), then total efforts."}
      </p>
    </Card>
  );
}

export default function Patterns() {
  const { filtered } = useAppData();
  const [metric, setMetric] = usePersistentState("patternMetric", "distance");
  const weekday = useMemo(() => buildWeekdayBreakdown(filtered.activities, metric), [filtered.activities, metric]);
  const tod = useMemo(() => buildTimeOfDayBreakdown(filtered.activities, metric), [filtered.activities, metric]);

  const counts = Object.entries(filtered.activityCounts || {}).sort((a, b) => b[1] - a[1]);
  const total = counts.reduce((s, [, c]) => s + c, 0);

  return (
    <div className="content">
      <PageHead title="Patterns" right={<Segmented label="Metric" value={metric} options={OPTIONS} onChange={setMetric} />}>
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
