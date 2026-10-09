import { useMemo, useState } from "react";
import { useAppData } from "../context/AppData.jsx";
import {
  buildSegmentDistanceHighlights, buildSegmentElevationHighlights, buildSegmentSummaryHighlights
} from "../lib/analytics.js";
import {
  comma, feet, formatDate, formatDuration, formatYearsBetween, getStravaSegmentUrl, miles
} from "../lib/format.js";
import { ActivityLink, Card, DataTable, Empty, PageHead } from "../components/ui.jsx";

const TABS = [
  { id: "records", label: "Records" },
  { id: "summary", label: "Segment summary" },
  { id: "distance", label: "By distance" },
  { id: "elevation", label: "By elevation" }
];

function buildRecordCards(h, gearName) {
  const bike = (label, b, value, sub = "") => ({ label, title: b ? b.name : "-", value: value || "-", sub });
  const act = (label, a, value) => ({ label, activity: a, title: a ? (a.name || a.sport_type || "Activity") : "-", value: value || "-", sub: a ? `${formatDate(a.start_date)} • ${gearName(a.gear_id)}` : "" });
  return [
    bike("Most-used bike by miles", h.mostUsedByMiles, h.mostUsedByMiles && `${comma(miles(h.mostUsedByMiles.distance).toFixed(1))} mi`),
    bike("Most-used bike by count", h.mostUsedByCount, h.mostUsedByCount && `${comma(h.mostUsedByCount.count)} activities`),
    bike("Fastest bike", h.fastestBike, h.fastestBike && `${h.fastestBike.avg_speed_mph.toFixed(1)} mph avg`),
    bike("Best climbing bike", h.climbingBike, h.climbingBike && `${comma(feet(h.climbingBike.avg_elevation_per_ride).toFixed(0))} ft/ride`),
    bike("Longest average ride bike", h.longestAverageRideBike, h.longestAverageRideBike && `${comma(miles(h.longestAverageRideBike.avg_distance_per_ride).toFixed(1))} mi/ride`),
    bike("Most total activity time", h.mostTotalTimeBike, h.mostTotalTimeBike && formatDuration(h.mostTotalTimeBike.moving_time)),
    bike("Most recent bike", h.mostRecentBike, h.mostRecentBike && formatDate(h.mostRecentBike.lastRide)),
    bike("Biggest mileage week", h.biggestMileageWeekBike, h.biggestMileageWeekBike && `${comma(miles(h.biggestMileageWeekBike.distance).toFixed(1))} mi`, h.biggestMileageWeekBike?.label),
    bike("Biggest climbing week", h.biggestClimbingWeekBike, h.biggestClimbingWeekBike && `${comma(feet(h.biggestClimbingWeekBike.elevation).toFixed(0))} ft`, h.biggestClimbingWeekBike?.label),
    bike("Longest-used bike", h.longestUsedBike, h.longestUsedBike && formatYearsBetween(h.longestUsedBike.firstRide, h.longestUsedBike.lastRide),
      h.longestUsedBike ? `${formatDate(h.longestUsedBike.firstRide)} – ${formatDate(h.longestUsedBike.lastRide)}` : ""),
    act("Longest single activity", h.longestActivity, h.longestActivity && `${comma(miles(h.longestActivity.distance || 0).toFixed(1))} mi`),
    act("Most elevation in a single activity", h.highestElevationActivity, h.highestElevationActivity && `${comma(feet(h.highestElevationActivity.total_elevation_gain || 0).toFixed(0))} ft`),
    act("Longest activity time", h.longestMovingTimeActivity, h.longestMovingTimeActivity && formatDuration(h.longestMovingTimeActivity.moving_time || 0)),
    act("Fastest ride by avg speed", h.fastestRide, h.fastestRide && `${h.fastestRide.avg_speed_mph.toFixed(1)} mph`),
    act("Steepest ride", h.steepestRide, h.steepestRide && `${comma(h.steepestRide.elevation_per_mile.toFixed(0))} ft/mi`)
  ];
}

function SegmentLink({ row }) {
  return <a href={getStravaSegmentUrl(row.segmentId)} target="_blank" rel="noopener noreferrer">{row.segmentName}</a>;
}

export default function Records() {
  const { filtered, insights, gearName, excludedSet, excludedSegments, excludeSegment, restoreSegment, minEfforts, setMinEfforts } = useAppData();
  const [tab, setTab] = useState("records");
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const match = (...parts) => !q || parts.some(p => String(p || "").toLowerCase().includes(q));

  const min = Math.max(1, Math.floor(Number(minEfforts) || 10));
  const summary = useMemo(() => buildSegmentSummaryHighlights(filtered, excludedSet), [filtered, excludedSet]);
  const distance = useMemo(() => buildSegmentDistanceHighlights(filtered, excludedSet), [filtered, excludedSet]);
  const elevation = useMemo(() => buildSegmentElevationHighlights(filtered, excludedSet, min), [filtered, excludedSet, min]);

  const records = buildRecordCards(insights.highlights, gearName).filter(r => match(r.label, r.title, r.sub));

  const segmentColumns = (extra = []) => [
    { key: "label", label: "Bucket" },
    { key: "segmentName", label: "Segment", wrap: true, render: r => <SegmentLink row={r} /> },
    ...extra,
    { key: "attempts", label: "Efforts", align: "r", render: r => comma(r.attempts) },
    { key: "prCount", label: "PRs", align: "r", render: r => comma(r.prCount || 0) },
    { key: "lastRidden", label: "Last ridden", value: r => new Date(r.lastRidden).getTime(), render: r => formatDate(r.lastRidden) },
    { key: "activity", label: "Last activity", sortable: false, wrap: true, render: r => r.latestActivity && <ActivityLink activity={r.latestActivity} /> },
    { key: "x", label: "", sortable: false, render: r => <button type="button" className="btn sm" onClick={() => excludeSegment(r.segmentId)}>Exclude</button> }
  ];
  const distanceColumns = segmentColumns([
    { key: "distanceMiles", label: "Length", align: "r", render: r => `${r.distanceMiles.toFixed(1)} mi` },
    { key: "elevationFeet", label: "Gain", align: "r", render: r => `${comma(Math.round(r.elevationFeet))} ft` }
  ]);
  const elevationColumns = segmentColumns([
    { key: "elevationFeet", label: "Gain", align: "r", render: r => `${comma(Math.round(r.elevationFeet))} ft` },
    { key: "distanceMiles", label: "Length", align: "r", render: r => `${r.distanceMiles.toFixed(1)} mi` }
  ]);

  const rowsOf = items => items.filter(i => !i.empty && match(i.segmentName, i.label));
  const emptyBuckets = items => items.filter(i => i.empty);

  const summaryRows = [
    summary.mostAttempted && { label: "Most attempted", ...summary.mostAttempted },
    summary.mostPrs && { label: "Most PRs", ...summary.mostPrs }
  ].filter(Boolean).filter(r => match(r.segmentName, r.label));

  return (
    <div className="content">
      <PageHead title="Records & Segments">
        Personal bests across the current filters, and the segments you ride most.
      </PageHead>

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Records sections" style={{ flex: 1 }}>
          {TABS.map(t => (
            <button key={t.id} type="button" role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <input type="search" placeholder="Search…" aria-label="Search this section" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {excludedSegments.length > 0 && tab !== "records" && (
        <div className="notice">
          <span className="small muted">Excluded segments (click to restore): </span>
          <span className="chips" style={{ display: "inline-flex" }}>
            {excludedSegments.map(id => (
              <button key={id} type="button" className="chip removable" aria-label={`Restore segment ${id}`} onClick={() => restoreSegment(id)}>{id}</button>
            ))}
          </span>
        </div>
      )}

      {tab === "records" && (
        records.length ? (
          <div className="grid three">
            {records.map(r => (
              <Card key={r.label}>
                <div className="record-label">{r.label}</div>
                <div className="record-title">{r.activity ? <ActivityLink activity={r.activity} /> : r.title}</div>
                <div className="record-value num">{r.value}</div>
                {r.sub && <div className="record-sub">{r.sub}</div>}
              </Card>
            ))}
          </div>
        ) : <Empty>No records match.</Empty>
      )}

      {tab === "summary" && (
        <>
          <div className="grid kpis">
            <Card><div className="kpi-label">Tracked segments</div><div className="kpi-value num">{comma(summary.totalSegments)}</div></Card>
            <Card><div className="kpi-label">Efforts</div><div className="kpi-value num">{comma(summary.totalEfforts)}</div></Card>
            <Card><div className="kpi-label">PRs</div><div className="kpi-value num">{comma(summary.totalPrs)}</div><div className="kpi-sub">across current filtered activities</div></Card>
          </div>
          <DataTable rows={summaryRows} rowKey={r => r.label} empty="No segment data available in the current view."
            columns={[
              { key: "label", label: "Highlight" },
              { key: "segmentName", label: "Segment", wrap: true, render: r => <SegmentLink row={r} /> },
              { key: "attempts", label: "Efforts", align: "r", render: r => comma(r.attempts) },
              { key: "prCount", label: "PRs", align: "r", render: r => comma(r.prCount) },
              { key: "lastRidden", label: "Last ridden", value: r => new Date(r.lastRidden).getTime(), render: r => formatDate(r.lastRidden) },
              { key: "activity", label: "Last activity", sortable: false, wrap: true, render: r => <ActivityLink activity={r.latestActivity} /> },
              { key: "x", label: "", sortable: false, render: r => <button type="button" className="btn sm" onClick={() => excludeSegment(r.segmentId)}>Exclude</button> }
            ]} />
        </>
      )}

      {tab === "distance" && (
        <>
          <DataTable rows={rowsOf(distance)} rowKey={r => r.label} columns={distanceColumns} empty="No qualifying segments match." />
          {emptyBuckets(distance).length > 0 && <p className="hint">No qualifying segments in: {emptyBuckets(distance).map(b => b.label).join(", ")}.</p>}
        </>
      )}

      {tab === "elevation" && (
        <>
          <div className="toolbar">
            <label className="toolbar">Minimum efforts
              <input type="number" min="1" step="1" value={minEfforts} style={{ width: 80 }}
                onChange={e => setMinEfforts(e.target.value === "" ? "" : Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                onBlur={() => setMinEfforts(min)} />
            </label>
            <span className="muted small" aria-live="polite">
              Most-ridden climbs of 300 ft+ per elevation bucket. {comma(elevation.belowMinimum)} segment{elevation.belowMinimum === 1 ? " is" : "s are"} hidden for having fewer than {comma(min)} efforts.
            </span>
          </div>
          <DataTable rows={rowsOf(elevation.items)} rowKey={r => r.label} columns={elevationColumns} empty="No segments meet the minimum effort count." />
          {emptyBuckets(elevation.items).length > 0 && <p className="hint">No segment meets the {comma(min)}-effort minimum in: {emptyBuckets(elevation.items).map(b => b.label).join(", ")}.</p>}
        </>
      )}
    </div>
  );
}
