import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAppData } from "../context/AppData.jsx";
import {
  METRICS, activityYears, buildGeoCoverage, buildRouteLeaderboard, buildSegmentLeaderboard,
  buildTimeOfDayBreakdown, buildWeekdayBreakdown
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

function PatternChart({ data, metric, color, paramKey, label }) {
  const m = METRICS[metric];
  return (
    <div className="chart-box" role="img" aria-label={label}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} width={48} tickFormatter={v => comma(Math.round(v))} />
          <Tooltip wrapperStyle={{ zIndex: 1000, pointerEvents: "none" }} allowEscapeViewBox={{ x: true, y: true }} content={<ChartTip format={m.fmt} />} cursor={{ fill: "var(--surface-hover)" }} />
          <Bar dataKey="value" name={m.label} fill={color} radius={[4, 4, 0, 0]} cursor="pointer"
            onClick={d => navigate("/activities", { [paramKey]: d.label })} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const LIMIT_OPTIONS = [10, 20, 50].map(n => ({ value: n, label: String(n) }));
const PERIOD_OPTIONS = [{ value: "all", label: "All time" }, { value: "year", label: "Year" }, { value: "month", label: "Month" }];
const KIND_OPTIONS = [{ value: "routes", label: "Routes" }, { value: "segments", label: "Segments" }];

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
  const [period, setPeriod] = usePersistentState("matchedPeriod", "all");
  const [year, setYear] = usePersistentState("matchedYear", null);
  const [month, setMonth] = usePersistentState("matchedMonth", new Date().getMonth() + 1);
  const [savedKind, setKind] = usePersistentState("matchedKind", "routes");
  const [open, setOpen] = useState(() => new Set());

  // The card follows the global activity-type filter; segments only exist for rides.
  const hasRides = useMemo(() => filtered.activities.some(a => a.sport_type === "Ride"), [filtered.activities]);
  const hasFoot = useMemo(() => filtered.activities.some(a => a.sport_type === "Walk" || a.sport_type === "Hike"), [filtered.activities]);
  const kind = hasRides ? savedKind : "routes";
  const noun = hasFoot && !hasRides ? "Walked" : hasFoot ? "Done" : "Ridden";

  const years = useMemo(() => activityYears(filtered.activities), [filtered.activities]);
  const activeYear = years.includes(year) ? year : years[0] ?? null;
  const opts = useMemo(() => ({
    limit,
    year: period === "all" ? null : activeYear,
    month: period === "month" ? month : null
  }), [limit, period, activeYear, month]);

  const coverage = useMemo(() => buildGeoCoverage(raw?.activities), [raw]);
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
        <Segmented label="Period" value={period} options={PERIOD_OPTIONS} onChange={setPeriod} />
        {period !== "all" && (
          <select aria-label="Year" value={activeYear ?? ""} onChange={e => setYear(Number(e.target.value))}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
        {period === "month" && (
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
      {status === "loading" ? <p className="muted" role="status">Loading…</p> : (
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
          <div className="grid two">
            <Card title="Day of week"><PatternChart data={weekday} metric={metric} color="var(--chart-1)" paramKey="dow" label="Bar chart by day of week" /></Card>
            <Card title="Time of day">
              <PatternChart data={tod} metric={metric} color="var(--chart-3)" paramKey="tod" label="Bar chart by time of day" />
              <p className="hint">Early AM 0–6 · Morning 6–12 · Afternoon 12–17 · Evening 17–21 · Night 21–24</p>
            </Card>
          </div>
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
