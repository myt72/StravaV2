import { useMemo, useState } from "react";
import { buildBikeTimeline } from "../lib/analytics.js";
import { comma, formatDate } from "../lib/format.js";
import { useUnits } from "../context/Units.jsx";
import { Card, Empty, Segmented } from "./ui.jsx";

const STATUS_OPTIONS = [
  { value: "all", label: "All bikes" },
  { value: "current", label: "Current" },
  { value: "retired", label: "Retired" }
];

export default function BikeTimeline({ activities, bikes }) {
  const units = useUnits();
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const history = useMemo(() => {
    const byId = new Map(bikes.map(bike => [bike.gid, bike]));
    return buildBikeTimeline(activities).flatMap((entry, index) => {
      const bike = byId.get(entry.gid);
      return bike ? [{ ...entry, name: bike.name, isRetired: bike.isRetired, color: `var(--chart-${index % 6 + 1})` }] : [];
    });
  }, [activities, bikes]);
  const visible = history.filter(bike => status === "all" || (status === "retired" ? bike.isRetired : !bike.isRetired));
  const selected = visible.find(bike => bike.gid === selectedId) || visible[0];
  const firstYear = history.length ? Math.floor(Math.min(...history.map(bike => bike.months[0].month)) / 12) : 0;
  const lastYear = history.length ? Math.floor(Math.max(...history.map(bike => bike.months[bike.months.length - 1].month)) / 12) : 0;
  const yearCount = lastYear - firstYear + 1;
  const firstMonth = firstYear * 12;
  const totalMonths = yearCount * 12;
  const position = month => `${(month - firstMonth) / totalMonths * 100}%`;
  const monthWidth = `${100 / totalMonths}%`;

  return (
    <Card className="bike-timeline" aria-labelledby="bike-timeline-title">
      <div className="bike-timeline-header">
        <div>
          <div className="bike-timeline-eyebrow">YOUR RIDING STORY</div>
          <h2 id="bike-timeline-title">Bikes through time</h2>
          <p className="muted small">A timeline of your recorded activities, from first to last ride on each bike.</p>
        </div>
        <Segmented label="Show bikes by status" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
      </div>
      <p className="bike-timeline-legend"><span aria-hidden="true" /> Bright marks show months with activity; the faded line connects first and last activity. Dates do not indicate ownership.</p>
      {!visible.length ? <Empty>No bike history for this selection and the current filters.</Empty> : (
        <>
          <div className="bike-timeline-scroll" tabIndex={0} role="region" aria-label="Bike history timeline, scroll horizontally for more years">
            <div className="bike-timeline-chart" style={{ "--timeline-width": `${yearCount * 96}px`, "--timeline-years": yearCount }}>
              <div className="bike-timeline-axis">
                <span className="bike-timeline-axis-label">BIKE / STATUS</span>
                <div className="bike-timeline-years">
                  {Array.from({ length: yearCount }, (_, i) => <span key={i}>{firstYear + i}</span>)}
                </div>
              </div>
              {visible.map(bike => {
                const start = bike.months[0].month;
                const end = bike.months[bike.months.length - 1].month;
                return (
                  <button type="button" className="bike-timeline-row" key={bike.gid}
                    aria-pressed={selected.gid === bike.gid}
                    aria-label={`${bike.name}, ${bike.isRetired ? "retired" : "current"}, ${formatDate(bike.first)} to ${formatDate(bike.last)}. Show details.`}
                    onClick={() => setSelectedId(bike.gid)} style={{ "--bike-color": bike.color }}>
                    <span className="bike-timeline-name"><strong>{bike.name}</strong><small>{bike.isRetired ? "Retired" : "Current"}</small></span>
                    <span className="bike-timeline-track" aria-hidden="true">
                      <span className="bike-timeline-range" style={{ left: position(start), width: `${(end - start + 1) / totalMonths * 100}%` }} />
                      {bike.months.map(({ month }) => <span key={month} className="bike-timeline-month" style={{ left: position(month), width: monthWidth }} />)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="bike-timeline-detail" aria-live="polite">
            <div className="bike-timeline-detail-name" style={{ "--bike-color": selected.color }}>
              <span className="bike-timeline-dot" aria-hidden="true" />
              <div><strong>{selected.name}</strong><div className="muted small">{selected.isRetired ? "Retired" : "Current"} · {comma(selected.months.length)} active {selected.months.length === 1 ? "month" : "months"}</div></div>
            </div>
            <div><span className="bike-timeline-detail-label">FIRST ACTIVITY</span><strong>{formatDate(selected.first)}</strong></div>
            <div><span className="bike-timeline-detail-label">LAST ACTIVITY</span><strong>{formatDate(selected.last)}</strong></div>
            <div><span className="bike-timeline-detail-label">ACTIVITIES</span><strong>{comma(selected.count)}</strong></div>
            <div><span className="bike-timeline-detail-label">DISTANCE</span><strong>{units.fmtDistance(selected.distance)}</strong></div>
            <a className="btn sm" href={`#/garage/${encodeURIComponent(selected.gid)}`}>View bike</a>
          </div>
        </>
      )}
      <p className="bike-timeline-footnote">Based on activities matching the global filters. Select a bike to explore its history.</p>
    </Card>
  );
}
