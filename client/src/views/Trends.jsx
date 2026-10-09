import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAppData } from "../context/AppData.jsx";
import { METRICS, buildAnnualBreakdowns, buildAnnualSubRows, buildAnnualTotals, buildMonthlyTrend, buildYearOverYear, sumMetric } from "../lib/analytics.js";
import { comma, feet, formatDuration, miles } from "../lib/format.js";
import { navigate } from "../lib/router.js";
import { usePersistentState } from "../lib/storage.js";
import { Card, ChartTip, Chip, DataTable, Empty, PageHead, Segmented } from "../components/ui.jsx";

const OPTIONS = [
  { value: "distance", label: "Distance" },
  { value: "elevation", label: "Elevation" },
  { value: "moving_time", label: "Moving time" },
  { value: "count", label: "Count" }
];
const BREAKDOWN_OPTIONS = [
  { value: "monthly", label: "Month" },
  { value: "weekly", label: "Week" },
  { value: "bike", label: "Bike" }
];
const TOTALS_KEY = "totals";
const LINE_COLORS = ["var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "var(--chart-1)"];

const axisTick = { fontSize: 12 };
const tickFmt = metric => v => (metric === "count" ? comma(v) : comma(Math.round(v)));

export default function Trends() {
  const { filtered, gearName } = useAppData();
  const [metric, setMetric] = usePersistentState("trendsMetric", "distance");
  const [cumulative, setCumulative] = usePersistentState("trendsCumulative", false);
  const [breakdown, setBreakdown] = usePersistentState("annualBreakdownMode", "monthly");
  const [expanded, setExpanded] = usePersistentState("annualExpandedYears", []);
  const [selected, setSelected] = usePersistentState("trendsTypes", []);

  const types = useMemo(() => Object.keys(filtered.activityCounts || {}).sort(), [filtered.activityCounts]);
  const active = selected.filter(t => types.includes(t));
  const activities = useMemo(
    () => (active.length ? filtered.activities.filter(a => active.includes(a.sport_type)) : filtered.activities),
    [filtered.activities, active.join("|")] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const m = METRICS[metric];
  const annual = useMemo(() => buildAnnualBreakdowns(activities), [activities]);
  const years = Object.keys(annual.annual).map(Number).sort((a, b) => a - b);
  const annualData = years.map(y => ({ label: String(y), value: sumMetric(activities.filter(a => new Date(a.start_date).getFullYear() === y), metric) }));
  const monthly = useMemo(() => buildMonthlyTrend(activities, metric), [activities, metric]);
  const yoy = useMemo(() => buildYearOverYear(activities, metric, cumulative), [activities, metric, cumulative]);

  const toggleType = t => setSelected(prev => {
    const cur = prev.filter(x => types.includes(x));
    return cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t];
  });

  const annualRows = years.slice().reverse().map(y => ({ year: y, ...annual.annual[y] }));
  const totalsRow = useMemo(() => ({ isTotals: true, year: TOTALS_KEY, ...buildAnnualTotals(activities) }), [activities]);
  const mode = BREAKDOWN_OPTIONS.some(o => o.value === breakdown) ? breakdown : "monthly";
  const openKeys = useMemo(() => new Set(expanded.map(String)), [expanded]);
  const rowId = r => String(r.year);
  const toggleExpanded = r => setExpanded(prev => {
    const id = rowId(r);
    return prev.map(String).includes(id) ? prev.filter(x => String(x) !== id) : [...prev, id];
  });

  const subRowsByKey = useMemo(() => {
    const byYear = {};
    activities.forEach(a => { (byYear[new Date(a.start_date).getFullYear()] ||= []).push(a); });
    const opts = { segmentData: filtered.segmentData, gearName };
    const out = {};
    openKeys.forEach(id => {
      out[id] = id === TOTALS_KEY
        ? buildAnnualSubRows(activities, mode, { ...opts, combineYears: true })
        : buildAnnualSubRows(byYear[id] || [], mode, opts);
    });
    return out;
  }, [activities, mode, openKeys, filtered.segmentData, gearName]);

  const num = (v, f) => (v == null ? "" : f(v));
  const subLink = (label, params) => (params
    ? <button type="button" className="cell-link" onClick={() => navigate("/activities", params)}>{label}</button>
    : label);
  const childParams = (c, parent) => {
    const base = parent.isTotals ? {} : { year: parent.year };
    if (c.monthKey) return { month: c.monthKey };
    if (c.weekStart) return { week: c.weekStart };
    if (mode === "bike") return { ...base, bike: c.gearId || "none" };
    return null;
  };

  const trendCell = v => (v == null ? <span className="muted">–</span>
    : <span className={v >= 0 ? "positive" : "negative"}>{v >= 0 ? "▲ +" : "▼ "}{v.toFixed(0)}%</span>);
  const columns = [
    { key: "year", label: "Year",
      render: r => (r.isTotals
        ? <button type="button" className="cell-link" onClick={() => navigate("/activities")}>Totals</button>
        : <button type="button" className="cell-link" onClick={() => navigate("/activities", { year: r.year })}>{r.year}</button>),
      renderChild: (c, parent) => <span className="sub-label">{subLink(c.label, childParams(c, parent))}</span> },
    { key: "distance", label: "Distance", align: "r", render: r => `${comma(miles(r.distance).toFixed(1))} mi` },
    { key: "elevation", label: "Elevation", align: "r", render: r => `${comma(feet(r.elevation).toFixed(0))} ft` },
    { key: "count", label: "Activities", align: "r", render: r => comma(r.count) },
    { key: "moving_time", label: "Time", align: "r", render: r => formatDuration(r.moving_time) },
    { key: "activeDaysCount", label: "Active days", align: "r", render: r => num(r.activeDaysCount, comma) },
    { key: "maxStreak", label: "Max streak", align: "r", render: r => num(r.maxStreak, v => `${comma(v)} days`) },
    { key: "maxRideDistance", label: "Max ride", align: "r", render: r => num(r.maxRideDistance, v => `${comma(miles(v).toFixed(1))} mi`) },
    { key: "maxRideElevation", label: "Max climb", align: "r", render: r => num(r.maxRideElevation, v => `${comma(feet(v).toFixed(0))} ft`) },
    ...(mode === "weekly" ? [{ key: "trend", label: "vs prev week", align: "r", sortable: false, render: () => "", renderChild: c => trendCell(c.trend) }] : []),
    ...(mode === "bike" ? [
      { key: "pr_count", label: "PRs", align: "r", sortable: false, render: () => "", renderChild: c => comma(c.pr_count) },
      { key: "avg_speed_mph", label: "Avg speed", align: "r", sortable: false, render: () => "", renderChild: c => num(c.avg_speed_mph, v => `${v.toFixed(1)} mph`) }
    ] : [])
  ];
  const expand = {
    isOpen: r => openKeys.has(rowId(r)),
    toggle: toggleExpanded,
    label: r => `Show ${mode === "bike" ? "bike" : mode} breakdown for ${r.isTotals ? "all years" : r.year}`,
    disabledReason: r => (r.isTotals && mode === "weekly" ? "Weekly breakdown is only available for individual years" : null),
    children: r => subRowsByKey[rowId(r)] || []
  };

  return (
    <div className="content">
      <PageHead title="Trends" right={<Segmented label="Metric" value={metric} options={OPTIONS} onChange={setMetric} />}>
        Annual progression, recent months and year-over-year comparison. Click a bar to see those activities.
      </PageHead>

      <div className="chips" role="group" aria-label="Activity types">
        <Chip active={active.length === 0} onClick={() => setSelected([])}>All types</Chip>
        {types.map(t => <Chip key={t} active={active.includes(t)} onClick={() => toggleType(t)}>{t} ({comma(filtered.activityCounts[t])})</Chip>)}
      </div>

      {!activities.length ? <Empty /> : (
        <>
          <div className="grid two">
            <Card title={`Annual ${m.label.toLowerCase()}`}>
              <div className="chart-box short" role="img" aria-label={`Bar chart of annual ${m.label}`}>
                <ResponsiveContainer>
                  <BarChart data={annualData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                    <XAxis dataKey="label" tick={axisTick} />
                    <YAxis tick={axisTick} tickFormatter={tickFmt(metric)} width={56} />
                    <Tooltip content={<ChartTip format={m.fmt} />} cursor={{ fill: "var(--surface-hover)" }} />
                    <Bar dataKey="value" name={m.label} fill="var(--chart-1)" radius={[4, 4, 0, 0]} cursor="pointer"
                      onClick={d => navigate("/activities", { year: d.label })} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title={`Monthly ${m.label.toLowerCase()} (last ${monthly.length} months)`}>
              <div className="chart-box short" role="img" aria-label={`Bar chart of monthly ${m.label}`}>
                <ResponsiveContainer>
                  <BarChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                    <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
                    <YAxis tick={axisTick} tickFormatter={tickFmt(metric)} width={56} />
                    <Tooltip content={<ChartTip format={m.fmt} />} cursor={{ fill: "var(--surface-hover)" }} />
                    <Bar dataKey="value" name={m.label} fill="var(--chart-2)" radius={[4, 4, 0, 0]} cursor="pointer"
                      onClick={d => navigate("/activities", { month: d.key })} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card title={`Year over year · ${m.label.toLowerCase()}`}
            right={<Segmented label="Line mode" value={cumulative ? "cum" : "month"} onChange={v => setCumulative(v === "cum")}
              options={[{ value: "month", label: "Monthly" }, { value: "cum", label: "Cumulative" }]} />}>
            <div className="chart-box short" role="img" aria-label="Line chart comparing years month by month">
              <ResponsiveContainer>
                <LineChart data={yoy.rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--chart-grid)" />
                  <XAxis dataKey="label" tick={axisTick} />
                  <YAxis tick={axisTick} tickFormatter={tickFmt(metric)} width={56} />
                  <Tooltip formatter={v => (v == null ? "–" : m.fmt(v))} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)" }} />
                  <Legend />
                  {yoy.years.map((y, i) => (
                    <Line key={y} type="monotone" dataKey={y} name={String(y)} stroke={LINE_COLORS[i % LINE_COLORS.length]}
                      strokeWidth={y === yoy.years[yoy.years.length - 1] ? 3 : 1.75} dot={false} connectNulls={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Annual summary"
            right={<Segmented label="Annual breakdown" value={mode} options={BREAKDOWN_OPTIONS} onChange={setBreakdown} />}>
            <DataTable columns={columns} rows={annualRows} pinnedRows={[totalsRow]} expand={expand}
              rowKey={r => r.year} caption="Annual statistics" />
          </Card>
        </>
      )}
    </div>
  );
}
