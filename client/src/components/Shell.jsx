import { useCallback, useEffect, useState } from "react";
import { PROFILE } from "../lib/profile.js";
import { THEMES } from "../lib/theme.js";
import { DATE_RANGES, useAppData } from "../context/AppData.jsx";
import { readStored, writeStored } from "../lib/storage.js";
import { UNIT_SYSTEMS } from "../lib/units.js";
import { useUnits } from "../context/Units.jsx";
import { Icon } from "./ui.jsx";

export const NAV = [
  { id: "overview", label: "Overview" },
  { id: "trends", label: "Trends" },
  { id: "patterns", label: "Patterns" },
  { id: "records", label: "Records" },
  { id: "garage", label: "Garage" },
  { id: "activities", label: "Activities" },
  { id: "admin", label: "Data" },
  { id: "mdr", label: "Macrodata Refinement", themeId: "severance" }
];

/** Nav entries available for a theme (entries with a themeId are shown only for that theme). */
export function navFor(themeId) {
  return NAV.filter(n => !n.themeId || n.themeId === themeId);
}

function ProfileLink() {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <a className="profile" href={PROFILE.dashboardUrl} target="_blank" rel="noopener noreferrer"
      aria-label={`Open ${PROFILE.name}'s Strava dashboard (opens in a new tab)`}>
      <span className="avatar" aria-hidden="true">
        {PROFILE.avatarUrl && !imgFailed
          ? <img src={PROFILE.avatarUrl} alt="" onError={() => setImgFailed(true)} />
          : PROFILE.initials}
      </span>
      <span className="profile-text">
        <span className="profile-name">{PROFILE.name}</span>
        <span className="profile-sub">{PROFILE.subtitle}</span>
      </span>
    </a>
  );
}

const NAV_COLLAPSE_QUERY = "(max-width: 1099px)";

/** Collapsed nav state: a saved choice always wins, otherwise auto-collapse on narrow (tablet landscape) viewports. */
export function useNavCollapsed() {
  const [saved, setSaved] = useState(() => {
    const v = readStored("navCollapsed", null);
    return typeof v === "boolean" ? v : null;
  });
  const [narrow, setNarrow] = useState(() => window.matchMedia(NAV_COLLAPSE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(NAV_COLLAPSE_QUERY);
    const onChange = e => setNarrow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const collapsed = saved ?? narrow;
  const toggle = useCallback(() => {
    setSaved(!collapsed);
    writeStored("navCollapsed", !collapsed);
  }, [collapsed]);
  return [collapsed, toggle];
}

export function Sidebar({ current, themeState, collapsed, onToggleNav }) {
  const { themeId, setThemeId, colorMode, toggleColorMode, theme } = themeState;
  const { backfillActive, prBackfill } = useAppData();
  return (
    <aside className="sidebar">
      <button type="button" className="nav-toggle" onClick={onToggleNav} aria-expanded={!collapsed}
        aria-controls="main-nav" aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        title={collapsed ? "Expand navigation" : "Collapse navigation"}>
        <Icon name="menu" />
      </button>
      <ProfileLink />
      <nav className="nav" id="main-nav" aria-label="Main">
        {navFor(theme.id).map(item => (
          <a key={item.id} href={`#/${item.id}`} className="nav-link" aria-label={item.label} title={item.label}
            aria-current={current === item.id ? "page" : undefined}>
            <Icon name={item.id === "admin" ? "admin" : item.id} />
            <span className="nav-label">{item.label}</span>
            {item.id === "admin" && backfillActive && (
              <span className="nav-badge pulse" title={prBackfill?.message || "PR backfill running"}>
                PR<span className="sr-only"> backfill running</span>
              </span>
            )}
          </a>
        ))}
      </nav>
      <div className="sidebar-foot">
        <label className="theme-picker">
          <span>Theme</span>
          <select value={themeId} onChange={e => setThemeId(e.target.value)}>
            {THEMES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        {theme.supportsMode && (
          <button type="button" className="nav-link mode-toggle" onClick={toggleColorMode}
            aria-label={`Switch to ${colorMode === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${colorMode === "dark" ? "light" : "dark"} mode`}>
            <Icon name={colorMode === "light" ? "moon" : "sun"} />
            <span className="btn-label">{colorMode === "dark" ? "Light mode" : "Dark mode"}</span>
          </button>
        )}
      </div>
    </aside>
  );
}

export function FilterBar() {
  const {
    filters, setDateRange, setActivityType, setBike, activityTypes, bikes, filtersActive, resetFilters, filtered, raw
  } = useAppData();
  const { system, setSystem } = useUnits();
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
      <label>Units
        <select value={system} onChange={e => setSystem(e.target.value)} aria-label="Units (imperial or metric)">
          {UNIT_SYSTEMS.map(u => <option key={u.value} value={u.value}>{u.value === "imperial" ? "Imperial (mi, ft)" : "Metric (km, m)"}</option>)}
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
