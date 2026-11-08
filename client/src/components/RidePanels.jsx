import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useUnits } from "../context/Units.jsx";
import { buildConsistencyStats, buildEverestStats, buildMileageMilestones, buildWeeklyRamp } from "../lib/analytics.js";
import { comma, formatDate } from "../lib/format.js";
import { Card } from "./ui.jsx";

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

export function RidePatternPanels({ activities }) {
  const units = useUnits();
  const rides = useMemo(() => activities.filter(a => a.sport_type === "Ride"), [activities]);
  const consistency = useMemo(() => buildConsistencyStats(rides), [rides]);
  const ramp = useMemo(() => buildWeeklyRamp(rides, "distance", new Date(), units), [rides, units]);
  const rampRows = [...ramp].reverse();
  const rampMax = Math.max(0, ...ramp.map(row => row.value));

  if (!rides.length) return null;
  return (
    <div className="grid two ride-pattern-stats">
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
    </div>
  );
}

export function RideProgressPanels({ activities }) {
  const units = useUnits();
  const rides = useMemo(() => activities.filter(a => a.sport_type === "Ride"), [activities]);
  const everest = useMemo(() => buildEverestStats(rides, units), [rides, units]);
  const milestones = useMemo(() => buildMileageMilestones(rides, new Date(), 90, units), [rides, units]);
  const everestRows = [...everest.years].reverse().map(row => ({ label: String(row.year), value: row.elevation, everests: row.everests }));
  const nextMilestone = milestones.upcomingList[0] || null;
  const laterMilestones = milestones.upcomingList.slice(1);
  const prevTarget = milestones.achieved.length ? milestones.achieved[milestones.achieved.length - 1].target : 0;
  const nextProgress = nextMilestone ? Math.min(1, Math.max(0, (milestones.total - prevTarget) / (nextMilestone.target - prevTarget))) : 0;

  if (!rides.length) return null;
  return (
    <div className="grid two">
      <Card title="Everest challenge" className="fill">
        <div className="record-value num">{everest.lifetime.toFixed(2)} Everests</div>
        <p className="hint">Climbing total across rides matching the current filters and activity types.</p>
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
        <p className="hint">Distance total and milestones across rides matching the current filters and activity types.</p>
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
  );
}
