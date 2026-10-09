import { useMemo, useState } from "react";
import { METRICS, buildPeriodGrid } from "../lib/analytics.js";
import { HeatLegend, heatLevelFor } from "./Heatmap.jsx";

const MAX_YEARS = 5;
const NOUN = { week: "week", month: "month", quarter: "quarter", year: "year" };
const TILE_MIN = { week: 40, month: 64, quarter: 80, year: 80 };

/** Intensity tiles for week / month / quarter / year, using the same 4-level heat scale as the day calendar. */
export default function PeriodGrid({ activities, metric, granularity, onSelect }) {
  const m = METRICS[metric] || METRICS.distance;
  const [showAll, setShowAll] = useState(false);
  const { rows, thresholds } = useMemo(() => buildPeriodGrid(activities, metric, granularity), [activities, metric, granularity]);
  const level = heatLevelFor(thresholds);
  const single = granularity === "year";

  const total = single ? rows[0].cells.length : rows.length;
  const visibleRows = single
    ? [{ ...rows[0], cells: showAll ? rows[0].cells : rows[0].cells.slice(-MAX_YEARS) }]
    : (showAll ? rows : rows.slice(0, MAX_YEARS));

  const describe = c => `${c.fullLabel}: ${c.value > 0 ? m.fmt(c.value) : "no activity"}`;

  return (
    <div>
      <div className={`period-grid ${granularity}`} role="group" aria-label={`Activity calendar by ${NOUN[granularity]}, ${m.label.toLowerCase()}`}>
        {visibleRows.map(row => {
          const cols = Math.max(...visibleRows.map(r => r.cells.length));
          return (
            <div key={row.year ?? "all"} className={`period-row ${single ? "single" : ""}`} style={{ "--cols": cols, "--tile-min": `${TILE_MIN[granularity]}px` }}>
              {!single && <span className="period-year">{row.year}</span>}
              {row.cells.map(c => {
                const props = {
                  className: "period-tile", "data-level": level(c.value), "data-future": c.future, title: describe(c)
                };
                const body = (
                  <>
                    <span>{c.label}</span>
                    <span className="tile-value">{c.value > 0 ? m.fmt(c.value) : "–"}</span>
                  </>
                );
                return c.value > 0
                  ? <button key={c.key} type="button" {...props} aria-label={describe(c)} onClick={() => onSelect?.(c.params)}>{body}</button>
                  : <div key={c.key} {...props} role="img" aria-label={describe(c)}>{body}</div>;
              })}
            </div>
          );
        })}
      </div>
      {total > MAX_YEARS && (
        <div className="table-foot">
          <span className="muted small">Showing {Math.min(MAX_YEARS, total)} of {total} years</span>
          <button type="button" className="btn sm" aria-pressed={showAll} onClick={() => setShowAll(v => !v)}>
            {showAll ? "Show recent years" : "Show all years"}
          </button>
        </div>
      )}
      <HeatLegend>Click a {NOUN[granularity]} to see its activities</HeatLegend>
    </div>
  );
}
