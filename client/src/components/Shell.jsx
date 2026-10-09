import { DATE_RANGES, useAppData } from "../context/AppData.jsx";
import { Icon } from "./ui.jsx";

export const NAV = [
  { id: "overview", label: "Overview" },
  { id: "trends", label: "Trends" },
  { id: "patterns", label: "Patterns" },
  { id: "records", label: "Records" },
  { id: "garage", label: "Garage" },
  { id: "activities", label: "Activities" },
  { id: "admin", label: "Data" }
];

export function Sidebar({ current, theme, onToggleTheme }) {
  const { backfillActive, prBackfill } = useAppData();
  return (
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">S</span> Strava V2</div>
      <nav className="nav" aria-label="Main">
        {NAV.map(item => (
          <a key={item.id} href={`#/${item.id}`} className="nav-link" aria-current={current === item.id ? "page" : undefined}>
            <Icon name={item.id === "admin" ? "admin" : item.id} />
            <span>{item.label}</span>
            {item.id === "admin" && backfillActive && (
              <span className="nav-badge pulse" title={prBackfill?.message || "PR backfill running"}>
                PR<span className="sr-only"> backfill running</span>
              </span>
            )}
          </a>
        ))}
      </nav>
      <div className="sidebar-foot">
        <button type="button" className="nav-link" style={{ border: 0, background: "transparent" }} onClick={onToggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
          <Icon name={theme === "dark" ? "sun" : "moon"} />
          <span className="btn-label">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>
      </div>
    </aside>
  );
}

export function FilterBar() {
  const {
    filters, setDateRange, setActivityType, setBike, activityTypes, bikes, filtersActive, resetFilters, filtered, raw
  } = useAppData();
  const disabled = !raw;
  return (
    <div className="filterbar" role="search" aria-label="Global filters">
      <label>Period
        <select value={filters.dateRange} onChange={e => setDateRange(e.target.value)} disabled={disabled}>
          {DATE_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </label>
      <label>Type
        <select value={filters.activityType} onChange={e => setActivityType(e.target.value)} disabled={disabled}>
          <option value="all">All activity types</option>
          {activityTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <label>Bike
        <select value={filters.bike} onChange={e => setBike(e.target.value)} disabled={disabled}>
          <option value="all">All bikes</option>
          {bikes.map(b => <option key={b.gid} value={b.gid}>{b.name}</option>)}
        </select>
      </label>
      {filtersActive && <button type="button" className="btn sm" onClick={resetFilters}>Reset filters</button>}
      <span className="spacer" />
      {filtered && (
        <span className="muted small" aria-live="polite">
          {filtered.activities.length.toLocaleString()} of {raw.activities.length.toLocaleString()} activities
        </span>
      )}
    </div>
  );
}
