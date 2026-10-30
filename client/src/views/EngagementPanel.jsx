import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ENGAGEMENT_METRICS, buildEngagementBreakdown, buildEngagementByPeriod, buildEngagementSnapshots,
  buildEngagementTotals, buildTopEngagementActivities
} from "../lib/analytics.js";
import { comma } from "../lib/format.js";
import { useUnits } from "../context/Units.jsx";
import { usePersistentState } from "../lib/storage.js";
import { ActivityLink, Card, ChartTip, DataTable, Segmented } from "../components/ui.jsx";

const METRIC_OPTIONS = Object.entries(ENGAGEMENT_METRICS).map(([value, m]) => ({ value, label: m.label }));
const PERIOD_OPTIONS = [{ value: "month", label: "Month" }, { value: "year", label: "Year" }, { value: "week", label: "Week" }];
const VALUE_OPTIONS = [{ value: "total", label: "Total" }, { value: "per", label: "Per activity" }];
const BREAKDOWN_OPTIONS = [
  { value: "bike", label: "By bike" },
  { value: "sport", label: "By sport" },
  { value: "year", label: "By year" },
  { value: "distanceBand", label: "By distance band" }
];
const MAX_POINTS = { month: 36, week: 52, year: 100 };
const PER_KEY = { kudos: "kudosPerActivity", comments: "commentsPerActivity", photos: "photosPerActivity" };
const tooltipProps = { wrapperStyle: { zIndex: 1000, pointerEvents: "none" }, allowEscapeViewBox: { x: true, y: true } };
const axisTick = { fontSize: 12 };

const avg = v => (v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

export default function EngagementPanel({ activities, gearName, snapshots }) {
  const units = useUnits();
  const [metric, setMetric] = usePersistentState("engagementMetric", "kudos");
  const [period, setPeriod] = usePersistentState("engagementPeriod", "month");
  const [valueMode, setValueMode] = usePersistentState("engagementValueMode", "total");
  const [breakdownBy, setBreakdownBy] = usePersistentState("engagementBreakdown", "bike");

  const metricKey = ENGAGEMENT_METRICS[metric] ? metric : "kudos";
  const periodKey = PERIOD_OPTIONS.some(o => o.value === period) ? period : "month";
  const breakdownKey = BREAKDOWN_OPTIONS.some(o => o.value === breakdownBy) ? breakdownBy : "bike";
  const perActivity = valueMode === "per";
  const label = ENGAGEMENT_METRICS[metricKey].label;

  const totals = useMemo(() => buildEngagementTotals(activities), [activities]);
  const periods = useMemo(() => buildEngagementByPeriod(activities, { period: periodKey }), [activities, periodKey]);
  const breakdown = useMemo(() => buildEngagementBreakdown(activities, { by: breakdownKey, gearName, units }), [activities, breakdownKey, gearName, units]);
  const top = useMemo(() => buildTopEngagementActivities(activities, { metric: metricKey, limit: 10 }), [activities, metricKey]);
  const series = useMemo(() => buildEngagementSnapshots(snapshots), [snapshots]);

  const chartData = useMemo(
    () => periods.slice(0, MAX_POINTS[periodKey]).reverse()
      .map(p => ({ label: p.label, value: perActivity ? p[PER_KEY[metricKey]] : p[metricKey] })),
    [periods, periodKey, metricKey, perActivity]
  );

  const noData = totals.withData === 0;
  const partial = !noData && totals.withoutData > 0;

  const tiles = [
    { id: "kudos", label: "Total kudos", value: comma(totals.kudos) },
    { id: "comments", label: "Total comments", value: comma(totals.comments) },
    { id: "photos", label: "Total photos", value: comma(totals.photos) },
    { id: "avg", label: "Kudos per activity", value: avg(totals.avgKudos) },
    { id: "data", label: "Activities with data", value: `${comma(totals.withData)} of ${comma(totals.activities)}`, sub: "have engagement data" }
  ];

  const periodColumns = [
    { key: "label", label: "Period", value: r => r.key, render: r => r.label },
    { key: "activities", label: "Activities", align: "r", render: r => comma(r.activities) },
    { key: "kudos", label: "Kudos", align: "r", render: r => comma(r.kudos) },
    { key: "kudosPerActivity", label: "Kudos/activity", align: "r", render: r => avg(r.kudosPerActivity) },
    { key: "comments", label: "Comments", align: "r", render: r => comma(r.comments) },
    { key: "photos", label: "Photos", align: "r", render: r => comma(r.photos) }
  ];
  const breakdownColumns = [
    { key: "label", label: breakdownKey === "bike" ? "Bike" : breakdownKey === "sport" ? "Sport" : breakdownKey === "year" ? "Year" : "Distance", render: r => r.label },
    { key: "activities", label: "Activities", align: "r", render: r => comma(r.activities) },
    { key: "kudos", label: "Kudos", align: "r", render: r => comma(r.kudos) },
    { key: "kudosPerActivity", label: "Kudos/ride", align: "r", render: r => avg(r.kudosPerActivity) },
    { key: "comments", label: "Comments", align: "r", render: r => comma(r.comments) },
    { key: "photos", label: "Photos", align: "r", render: r => comma(r.photos) }
  ];

  return (
    <Card title="Engagement" aria-label="Engagement: kudos, comments and photo counts"
      right={<Segmented label="Engagement metric" value={metricKey} options={METRIC_OPTIONS} onChange={setMetric} />}>
      {noData && (
        <div className="notice" role="status">
          No engagement data yet. Run the Engagement backfill on the <a href="#/admin">Data page</a> to load kudos, comment and photo counts.
        </div>
      )}
      {partial && (
        <div className="notice" role="status">
          {comma(totals.withData)} of {comma(totals.activities)} activities have engagement data. Run or resume the Engagement backfill on the <a href="#/admin">Data page</a> to fill in the rest.
        </div>
      )}
      <p className="hint">
        Counts are the current totals attributed to the activity date, not the date each kudos was given. Kudos you have given are not available from Strava. Photo counts are counts of all photos on the activity (Strava + Instagram), counts only.
      </p>

      <div className="grid engagement-kpis" role="group" aria-label="Engagement totals" style={{ marginTop: 12 }}>
        {tiles.map(t => (
          <div className="card kpi" key={t.id}>
            <div className="kpi-label">{t.label}</div>
            <div className="kpi-value">{t.value}</div>
            {t.sub && <div className="kpi-sub">{t.sub}</div>}
          </div>
        ))}
      </div>

      {!noData && (
        <>
          <div className="card-head" style={{ marginTop: 16 }}>
            <h2>{label} by activity date</h2>
            <div className="toolbar">
              <Segmented label="Engagement period" value={periodKey} options={PERIOD_OPTIONS} onChange={setPeriod} />
              <Segmented label="Engagement value" value={perActivity ? "per" : "total"} options={VALUE_OPTIONS} onChange={setValueMode} />
            </div>
          </div>
          <div className="chart-box short" role="img"
            aria-label={`Bar chart of ${perActivity ? `${label.toLowerCase()} per activity` : `total ${label.toLowerCase()}`} by ${periodKey}, most recent ${chartData.length} periods`}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
                <YAxis tick={axisTick} width={48} />
                <Tooltip {...tooltipProps} content={<ChartTip format={v => (perActivity ? avg(v) : comma(v))} />} cursor={{ fill: "var(--surface-hover)" }} />
                <Bar dataKey="value" name={perActivity ? `${label} per activity` : label} fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <DataTable columns={periodColumns} rows={periods} rowKey={r => r.key} pageSize={24} caption={`Engagement by ${periodKey}, newest first`} />

          <div className="card-head" style={{ marginTop: 16 }}>
            <h2>Breakdown</h2>
            <Segmented label="Engagement breakdown" value={breakdownKey} options={BREAKDOWN_OPTIONS} onChange={setBreakdownBy} />
          </div>
          <DataTable columns={breakdownColumns} rows={breakdown} rowKey={r => r.key} caption={`Engagement ${BREAKDOWN_OPTIONS.find(o => o.value === breakdownKey).label.toLowerCase()}`} />

          <h2 style={{ marginTop: 16 }}>Top 10 activities by {label.toLowerCase()}</h2>
          {top.length === 0 ? <p className="muted">No activities with {label.toLowerCase()} yet.</p> : (
            <ol className="engagement-top" aria-label={`Top activities by ${label.toLowerCase()}`}>
              {top.map(r => (
                <li key={r.activity.id} className="stat-row">
                  <span><ActivityLink activity={r.activity} /> <span className="muted small">{new Date(r.activity.start_date).toLocaleDateString()}</span></span>
                  <span className="num"><strong>{comma(r.value)}</strong> {label.toLowerCase()}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      {series.length >= 2 && (
        <>
          <h2 style={{ marginTop: 16 }}>Followers and following</h2>
          <div className="chart-box short" role="img" aria-label="Line chart of followers and following over time">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--chart-grid)" />
                <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
                <YAxis tick={axisTick} width={48} />
                <Tooltip {...tooltipProps} content={<ChartTip format={comma} />} />
                <Legend />
                <Line type="monotone" dataKey="followers" name="Followers" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="following" name="Following" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="hint">Recorded once per day from the day this feature was deployed.</p>
        </>
      )}
    </Card>
  );
}
