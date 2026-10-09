import { useMemo, useRef, useState } from "react";
import { METRICS } from "../lib/analytics.js";
import { MONTHS, formatDate, getDateKey } from "../lib/format.js";

const WEEKS = 53;

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** GitHub-style calendar. Arrow keys move between days, Enter opens that day. */
export default function Heatmap({ activities, metric, onSelectDay }) {
  const m = METRICS[metric] || METRICS.distance;
  const [focus, setFocus] = useState(null);
  const wrapRef = useRef(null);

  const { cells, monthLabels, thresholds } = useMemo(() => {
    const byDay = {};
    activities.forEach(a => {
      const k = getDateKey(a.start_date);
      byDay[k] = (byDay[k] || 0) + m.value(a);
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const mondayOffset = (today.getDay() + 6) % 7;
    const start = new Date(today);
    start.setDate(today.getDate() - mondayOffset - (WEEKS - 1) * 7);

    const list = [];
    for (let i = 0; i < WEEKS * 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = getDateKey(d);
      list.push({ key, date: d, value: byDay[key] || 0, future: d > today });
    }

    const nonZero = list.filter(c => c.value > 0).map(c => c.value).sort((a, b) => a - b);
    const labels = [];
    let lastMonth = -1;
    for (let w = 0; w < WEEKS; w++) {
      const month = list[w * 7].date.getMonth();
      labels.push(month !== lastMonth ? MONTHS[month] : "");
      lastMonth = month;
    }
    return {
      cells: list,
      monthLabels: labels,
      thresholds: [quantile(nonZero, 0.25), quantile(nonZero, 0.5), quantile(nonZero, 0.75)]
    };
  }, [activities, m]);

  const level = v => {
    if (v <= 0) return 0;
    if (v <= thresholds[0]) return 1;
    if (v <= thresholds[1]) return 2;
    if (v <= thresholds[2]) return 3;
    return 4;
  };

  const lastIndex = cells.reduce((acc, c, i) => (c.future ? acc : i), 0);
  const cur = focus ?? lastIndex;

  const onKeyDown = e => {
    const moves = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    if (e.key in moves) {
      e.preventDefault();
      const next = Math.min(lastIndex, Math.max(0, cur + moves[e.key]));
      setFocus(next);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (cells[cur]?.value > 0) onSelectDay?.(cells[cur].key);
    }
  };

  const describe = c => `${formatDate(c.date)}: ${c.value > 0 ? m.fmt(c.value) : "no activity"}`;
  const active = cells[cur];

  return (
    <div>
      <div className="heatmap">
        <div className="heat-months" aria-hidden="true">
          {monthLabels.map((l, i) => <span key={i}>{l}</span>)}
        </div>
        <div
          ref={wrapRef}
          className="heatmap-grid heatmap-wrap"
          role="group"
          tabIndex={0}
          aria-label={`Activity calendar by ${m.label.toLowerCase()}. Use arrow keys to move between days and Enter to open a day.`}
          aria-activedescendant={`heat-${cells[cur]?.key}`}
          onKeyDown={onKeyDown}
          onBlur={() => setFocus(null)}
        >
          {cells.map((c, i) => (
            <div
              key={c.key}
              id={`heat-${c.key}`}
              role="img"
              aria-label={describe(c)}
              title={describe(c)}
              className={`heat-cell ${i === cur && focus !== null ? "focused" : ""}`}
              data-level={level(c.value)}
              data-future={c.future}
              style={{ cursor: c.value > 0 ? "pointer" : "default" }}
              onClick={() => c.value > 0 && onSelectDay?.(c.key)}
            />
          ))}
        </div>
      </div>
      <div className="heat-legend">
        <span aria-live="polite" style={{ marginRight: "auto" }}>{focus !== null && active ? describe(active) : "Click a day to see its activities"}</span>
        Less
        {[0, 1, 2, 3, 4].map(l => <span key={l} className="heat-cell" data-level={l} />)}
        More
      </div>
    </div>
  );
}
