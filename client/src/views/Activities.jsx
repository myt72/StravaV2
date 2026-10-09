import { useEffect, useMemo, useState } from "react";
import { useAppData } from "../context/AppData.jsx";
import { timeOfDayLabel, weekdayIndex, WEEKDAYS } from "../lib/analytics.js";
import { fetchFeaturedActivities } from "../lib/api.js";
import {
  comma, extractStravaActivityId, feet, formatDate, formatDateTime, formatDuration, getDateKey, getStravaSegmentUrl, isValidHttpUrl, miles
} from "../lib/format.js";
import { Card, Chip, DataTable, Drawer, PageHead } from "../components/ui.jsx";

function FeaturedActivities({ activities, gearName, open }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let live = true;
    fetchFeaturedActivities().then(list => live && setItems(list));
    return () => { live = false; };
  }, []);
  if (!items || !items.length) return null;
  const byId = new Map(activities.map(a => [String(a.id), a]));

  return (
    <Card title="★ Featured activities">
      <div className="grid three">
        {items.map(item => {
          const a = byId.get(String(extractStravaActivityId(item.activityUrl)));
          return (
            <article key={item.activityUrl || item.title} className="card featured-card" style={{ boxShadow: "none" }}>
              <h3>{item.title || "Untitled Activity"}</h3>
              {item.caption && <p className="muted" style={{ margin: "4px 0 8px" }}>{item.caption}</p>}
              {a ? (
                <p className="small num">
                  {comma(miles(a.distance).toFixed(1))} mi · {comma(feet(a.total_elevation_gain).toFixed(0))} ft · {formatDuration(a.moving_time)}<br />
                  {formatDate(a.start_date)} · {a.sport_type || "-"} · {gearName(a.gear_id)}
                </p>
              ) : <p className="muted small">Activity not found in dashboard data</p>}
              <div className="toolbar">
                {a && <button type="button" className="btn sm" onClick={() => open(a.id)}>Details</button>}
                {isValidHttpUrl(item.activityUrl)
                  ? <a className="btn sm" href={item.activityUrl} target="_blank" rel="noopener noreferrer">View on Strava</a>
                  : <span className="muted small">No activity link</span>}
              </div>
            </article>
          );
        })}
      </div>
    </Card>
  );
}

function ActivityDrawer({ activity, efforts, gearName, onClose }) {
  return (
    <Drawer title={activity.name || activity.sport_type || "Activity"} onClose={onClose}>
      <dl className="dl">
        <dt>Date</dt><dd>{formatDateTime(activity.start_date)}</dd>
        <dt>Type</dt><dd>{activity.sport_type || "-"}</dd>
        <dt>Bike</dt><dd>{gearName(activity.gear_id)}</dd>
        <dt>Distance</dt><dd className="num">{comma(miles(activity.distance).toFixed(2))} mi</dd>
        <dt>Moving time</dt><dd className="num">{formatDuration(activity.moving_time)}</dd>
        <dt>Elevation</dt><dd className="num">{comma(feet(activity.total_elevation_gain).toFixed(0))} ft</dd>
        {activity.distance > 0 && activity.moving_time > 0 && (
          <><dt>Avg speed</dt><dd className="num">{(miles(activity.distance) / (activity.moving_time / 3600)).toFixed(1)} mph</dd></>
        )}
      </dl>
      {isValidHttpUrl(activity.url) && (
        <a className="btn primary" href={activity.url} target="_blank" rel="noopener noreferrer">View on Strava</a>
      )}
      {efforts.length > 0 && (
        <div>
          <h3 style={{ marginBottom: 6 }}>Segment efforts ({efforts.length})</h3>
          <ul className="list small">
            {efforts.map((e, i) => (
              <li key={`${e.segment_id}-${i}`} style={{ padding: "6px 0" }}>
                <a href={getStravaSegmentUrl(e.segment_id)} target="_blank" rel="noopener noreferrer">{e.segment_name || e.name || `Segment ${e.segment_id}`}</a>
                {e.pr_rank === 1 && <strong className="positive"> · PR</strong>}
                {e.elapsed_time > 0 && <span className="muted"> · {formatDuration(e.elapsed_time)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Drawer>
  );
}

export default function Activities({ route }) {
  const { filtered, raw, gearName } = useAppData();
  const { params, replaceParams } = route;
  const [search, setSearch] = useState(params.q || "");

  const filterKeys = ["date", "month", "year", "dow", "tod"];
  const labels = { date: "Day", month: "Month", year: "Year", dow: "Weekday", tod: "Time of day" };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return filtered.activities.filter(a => {
      const d = new Date(a.start_date);
      if (params.date && getDateKey(a.start_date) !== params.date) return false;
      if (params.month && getDateKey(a.start_date).slice(0, 7) !== params.month) return false;
      if (params.year && String(d.getFullYear()) !== String(params.year)) return false;
      if (params.dow && WEEKDAYS[weekdayIndex(d)] !== params.dow) return false;
      if (params.tod && timeOfDayLabel(d) !== params.tod) return false;
      if (!q) return true;
      return [a.name, a.sport_type, gearName(a.gear_id)].some(v => String(v || "").toLowerCase().includes(q));
    });
  }, [filtered.activities, params.date, params.month, params.year, params.dow, params.tod, search, gearName]);

  const selected = params.id ? raw.activities.find(a => String(a.id) === String(params.id)) : null;
  const open = id => replaceParams({ ...params, id });
  const close = () => { const { id, ...rest } = params; replaceParams(rest); };
  const dropFilter = key => { const { [key]: _x, ...rest } = params; replaceParams(rest); };

  const columns = [
    { key: "name", label: "Name", wrap: true, value: a => (a.name || "").toLowerCase(), render: a => (
      <button type="button" className="cell-link" onClick={e => { e.stopPropagation(); open(a.id); }}>{a.name || a.sport_type || "Activity"}</button>) },
    { key: "sport_type", label: "Type", value: a => a.sport_type || "" },
    { key: "start_date", label: "Date", value: a => new Date(a.start_date).getTime(), render: a => formatDate(a.start_date) },
    { key: "distance", label: "Distance", align: "r", value: a => a.distance || 0, render: a => `${comma(miles(a.distance).toFixed(1))} mi` },
    { key: "moving_time", label: "Time", align: "r", value: a => a.moving_time || 0, render: a => formatDuration(a.moving_time) },
    { key: "total_elevation_gain", label: "Elevation", align: "r", value: a => a.total_elevation_gain || 0, render: a => `${comma(feet(a.total_elevation_gain).toFixed(0))} ft` },
    { key: "gear_id", label: "Bike", value: a => gearName(a.gear_id), render: a => gearName(a.gear_id) }
  ];

  const activeFilters = filterKeys.filter(k => params[k]);

  return (
    <div className="content">
      <PageHead title="Activities">{comma(rows.length)} of {comma(filtered.activities.length)} activities in the current view.</PageHead>

      <FeaturedActivities activities={raw.activities} gearName={gearName} open={open} />

      <div className="toolbar">
        <input type="search" placeholder="Search name, type or bike…" aria-label="Search activities" value={search}
          onChange={e => setSearch(e.target.value)} style={{ minWidth: 260 }} />
        {activeFilters.length > 0 && (
          <div className="chips" aria-label="Active drill-down filters">
            {activeFilters.map(k => <Chip key={k} active removable onClick={() => dropFilter(k)}>{labels[k]}: {params[k]}</Chip>)}
          </div>
        )}
      </div>

      <DataTable columns={columns} rows={rows} rowKey={a => a.id} initialSort={{ key: "start_date", dir: "desc" }}
        pageSize={50} onRowClick={a => open(a.id)} caption="Activities" empty="No activities match." />

      {selected && (
        <ActivityDrawer activity={selected} gearName={gearName} onClose={close}
          efforts={Array.isArray(raw.segmentData?.[selected.id]) ? raw.segmentData[selected.id] : []} />
      )}
    </div>
  );
}
