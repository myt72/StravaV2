import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAppData } from "../context/AppData.jsx";
import { METRICS, buildTimeOfDayBreakdown, buildWeekdayBreakdown } from "../lib/analytics.js";
import { comma } from "../lib/format.js";
import { navigate } from "../lib/router.js";
import { usePersistentState } from "../lib/storage.js";
import { Card, ChartTip, Empty, PageHead, Segmented } from "../components/ui.jsx";

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
          <Tooltip content={<ChartTip format={m.fmt} />} cursor={{ fill: "var(--surface-hover)" }} />
          <Bar dataKey="value" name={m.label} fill={color} radius={[4, 4, 0, 0]} cursor="pointer"
            onClick={d => navigate("/activities", { [paramKey]: d.label })} />
        </BarChart>
      </ResponsiveContainer>
    </div>
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
        </>
      )}
    </div>
  );
}
