import { useMemo } from "react";
import { useAppData } from "../context/AppData.jsx";
import { METRICS, buildHeadline, buildKpis, buildRecentPeriodStats, buildYearComparison } from "../lib/analytics.js";
import { comma, feet, formatDate, formatDateRange, formatDuration, miles } from "../lib/format.js";
import { navigate } from "../lib/router.js";
import { ActivityLink, Card, Empty, PageHead, Segmented } from "../components/ui.jsx";
import Heatmap from "../components/Heatmap.jsx";

export const METRIC_OPTIONS = [
  { value: "distance", label: "Distance" },
  { value: "moving_time", label: "Time" },
  { value: "elevation", label: "Elevation" },
  { value: "count", label: "Activities" }
];

const Delta = ({ value }) => (
  value == null ? <span className="muted">n/a</span> :
  <span className={value >= 0 ? "positive" : "negative"}>{value >= 0 ? "▲ +" : "▼ "}{value.toFixed(0)}%</span>
);

export default function Overview() {
  const { filtered, insights, primaryMetric, setPrimaryMetric, gearName } = useAppData();
  const activities = filtered.activities;

  const kpis = useMemo(() => buildKpis(activities, filtered.gearTotals), [activities, filtered.gearTotals]);
  const recent = useMemo(() => buildRecentPeriodStats(activities), [activities]);
  const yoy = useMemo(() => buildYearComparison(activities), [activities]);
  const headline = useMemo(() => buildHeadline(filtered, insights, primaryMetric), [filtered, insights, primaryMetric]);
  const latest = useMemo(
    () => [...activities].sort((a, b) => new Date(b.start_date) - new Date(a.start_date)).slice(0, 8),
    [activities]
  );

  const cards = [
    { id: "count", label: "Activities", value: comma(kpis.count) },
    { id: "distance", label: "Distance", value: `${comma(miles(kpis.distance).toFixed(1))} mi` },
    { id: "moving_time", label: "Moving time", value: formatDuration(kpis.movingTime) },
    { id: "elevation", label: "Elevation", value: `${comma(feet(kpis.elevation).toFixed(0))} ft` }
  ];

  if (!activities.length) {
    return <div className="content"><PageHead title="Overview" /><Empty>No activities match the current filters.</Empty></div>;
  }

  return (
    <div className="content">
      <PageHead title="Overview"
        right={(
          <div className="toolbar"><span className="muted small">Primary metric</span>
            <Segmented label="Primary metric" value={primaryMetric} options={METRIC_OPTIONS} onChange={setPrimaryMetric} />
          </div>
        )}>
        {comma(activities.length)} activities across {Object.keys(filtered.gearTotals).length} bike profiles in the current view.
      </PageHead>

      <p className="headline">{headline}</p>

      <div className="grid kpis">
        {cards.map(c => (
          <div key={c.id} className={`card kpi ${primaryMetric === c.id ? "primary" : ""}`}>
            <div className="kpi-label">{c.label}</div>
            <div className="kpi-value num">{c.value}</div>
            {primaryMetric === c.id && <div className="kpi-sub">Primary metric</div>}
          </div>
        ))}
      </div>

      <div className="grid three">
        <Card title={`${yoy.thisYear} vs ${yoy.lastYear} (same period)`}>
          {yoy.rows.map(r => (
            <div className="stat-row" key={r.metric}>
              <span>{METRICS[r.metric].label}</span>
              <span className="num"><strong>{METRICS[r.metric].fmt(r.current)}</strong> <span className="muted small">vs {METRICS[r.metric].fmt(r.previous)}</span> <Delta value={r.delta} /></span>
            </div>
          ))}
        </Card>
        <Card title="Last 30 days">
          <div className="stat-row"><span>Distance</span><span className="num"><strong>{comma(miles(recent.distance).toFixed(1))} mi</strong> <Delta value={recent.distanceDelta} /></span></div>
          <div className="stat-row"><span>Moving time</span><span className="num"><strong>{formatDuration(recent.time)}</strong> <Delta value={recent.timeDelta} /></span></div>
          <div className="stat-row"><span>Elevation</span><span className="num"><strong>{comma(feet(recent.elevation).toFixed(0))} ft</strong> <Delta value={recent.elevationDelta} /></span></div>
          <p className="hint">Change vs the prior 30 days.</p>
        </Card>
        <Card title="Streaks & context">
          <div className="stat-row"><span>Longest ride streak</span><span className="num"><strong>{comma(kpis.longestRideStreak.length)} days</strong></span></div>
          <p className="hint" style={{ marginTop: 0 }}>{formatDateRange(kpis.longestRideStreak.start, kpis.longestRideStreak.end)}</p>
          <div className="stat-row"><span>Longest activity streak</span><span className="num"><strong>{comma(kpis.longestActivityStreak.length)} days</strong></span></div>
          <p className="hint" style={{ marginTop: 0 }}>{(kpis.longestActivityStreak.length / 7).toFixed(1)} weeks · {formatDateRange(kpis.longestActivityStreak.start, kpis.longestActivityStreak.end)}</p>
          <div className="stat-row"><span>Longest off-bike streak</span><span className="num"><strong>{comma(kpis.longestOffBikeStreak.length)} days</strong></span></div>
          <p className="hint" style={{ marginTop: 0 }}>{formatDateRange(kpis.longestOffBikeStreak.start, kpis.longestOffBikeStreak.end)}</p>
        </Card>
      </div>

      <Card title={`Activity calendar · ${METRICS[primaryMetric].label.toLowerCase()}`}>
        <Heatmap activities={activities} metric={primaryMetric} onSelectDay={date => navigate("/activities", { date })} />
      </Card>

      <Card title="Recent activities" right={<a className="btn sm" href="#/activities">All activities</a>}>
        <ul className="list">
          {latest.map(a => (
            <li key={a.id}>
              <div className="list-btn" style={{ cursor: "default" }}>
                <span><ActivityLink activity={a} /><br /><span className="muted small">{formatDate(a.start_date)} · {a.sport_type} · {gearName(a.gear_id)}</span></span>
                <span className="num small" style={{ textAlign: "right" }}>
                  {comma(miles(a.distance).toFixed(1))} mi · {comma(feet(a.total_elevation_gain).toFixed(0))} ft · {formatDuration(a.moving_time)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
