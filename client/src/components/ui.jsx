import { useEffect, useMemo, useRef, useState } from "react";
import { navigate } from "../lib/router.js";
import { rankYearValues } from "../lib/analytics.js";
import { ordinal } from "../lib/format.js";

/* ---------- icons ---------- */
const paths = {
  overview: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
  trends: "M3 17l6-6 4 4 8-8M15 7h6v6",
  patterns: "M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  records: "M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3",
  garage: "M5 17a3 3 0 100-.01M19 17a3 3 0 100-.01M5 17l5-9h5l4 9M10 8l3 5h6",
  activities: "M4 6h16M4 12h16M4 18h10",
  admin: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
  sun: "M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z",
  camera: "M4 7h3l2-2h6l2 2h3v12H4zM12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z",
  bike: "M5 17a3 3 0 100-.01M19 17a3 3 0 100-.01M5 17l5-9h5l4 9M10 8l3 5h6"
};

export function Icon({ name, className = "nav-icon", size }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

/* ---------- feedback ---------- */
export function Skeleton({ height = 20, width = "100%", style }) {
  return <div className="skeleton" style={{ height, width, ...style }} aria-hidden="true" />;
}

export function ViewSkeleton() {
  return (
    <div className="content" role="status" aria-live="polite" aria-label="Loading data">
      <Skeleton height={28} width="30%" />
      <div className="grid kpis">
        {[0, 1, 2, 3].map(i => <Skeleton key={i} height={96} />)}
      </div>
      <div className="grid two">
        <Skeleton height={280} />
        <Skeleton height={280} />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function StateMessage({ title, children, actions }) {
  return (
    <div className="card state" role="alert">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {actions && <div className="toolbar">{actions}</div>}
    </div>
  );
}

export function Empty({ children = "No data for the current filters." }) {
  return <p className="muted" style={{ padding: "16px 0" }}>{children}</p>;
}

/* ---------- layout ---------- */
export function PageHead({ title, children, right }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {right}
    </div>
  );
}

export function Card({ title, right, children, className = "", ...rest }) {
  return (
    <section className={`card ${className}`} {...rest}>
      {(title || right) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

/* ---------- inputs ---------- */
export function Segmented({ label, value, options, onChange }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ active, onClick, children, removable }) {
  return (
    <button type="button" className={`chip ${removable ? "removable" : ""}`} aria-pressed={active} onClick={onClick}>
      {children}
    </button>
  );
}

export function ActivityLink({ activity, children }) {
  return (
    <button type="button" className="cell-link" onClick={() => navigate("/activities", { id: activity.id })}>
      {children || activity.name || activity.sport_type || "Activity"}
    </button>
  );
}

/* ---------- table ---------- */
/**
 * columns: { key, label, render?, renderChild?, value?, align?, wrap?, sortable? }
 * pinnedRows: rows always rendered first, never sorted.
 * expand (optional): { isOpen(row), toggle(row), label(row), disabledReason?(row), children(row) -> child rows }
 *   adds a trailing arrow column; open rows render children directly beneath them (cells use renderChild when present).
 */
export function DataTable({ columns, rows, rowKey, initialSort, onRowClick, pageSize, empty, caption, pinnedRows, expand }) {
  const [sort, setSort] = useState(initialSort || null);
  const [limit, setLimit] = useState(pageSize || Infinity);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find(c => c.key === sort.key);
    if (!col) return rows;
    const get = col.value || (r => r[col.key]);
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = get(a), bv = get(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }, [rows, sort, columns]);

  useEffect(() => setLimit(pageSize || Infinity), [rows.length, pageSize]);

  const toggleSort = col => {
    setSort(prev => prev?.key === col.key
      ? { key: col.key, dir: prev.dir === "asc" ? "desc" : "asc" }
      : { key: col.key, dir: col.align === "r" ? "desc" : "asc" });
  };

  if (!rows.length && !pinnedRows?.length) return <Empty>{empty}</Empty>;
  const visible = sorted.slice(0, limit);

  const renderRow = (row, { pinned = false } = {}) => {
    const open = expand?.isOpen(row);
    const disabledReason = expand?.disabledReason?.(row);
    const key = rowKey(row);
    return [
      <tr key={key} className={`${onRowClick && !pinned ? "clickable" : ""} ${pinned ? "pinned" : ""}`.trim()}
        onClick={onRowClick && !pinned ? () => onRowClick(row) : undefined}>
        {columns.map(c => (
          <td key={c.key} className={`${c.align === "r" ? "r num" : ""} ${c.wrap ? "wrap" : ""}`}>
            {c.render ? c.render(row) : row[c.key]}
          </td>
        ))}
        {expand && (
          <td className="expand-cell">
            <button type="button" className="expand-btn" aria-expanded={!!open} aria-label={expand.label(row)}
              title={disabledReason || expand.label(row)} disabled={!!disabledReason}
              onClick={e => { e.stopPropagation(); expand.toggle(row); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </td>
        )}
      </tr>,
      ...(open && !disabledReason ? expand.children(row) : []).map(child => (
        <tr key={`${key}/${child.key}`} className="child-row">
          {columns.map(c => (
            <td key={c.key} className={`${c.align === "r" ? "r num" : ""} ${c.wrap ? "wrap" : ""}`}>
              {c.renderChild ? c.renderChild(child, row) : c.render ? c.render(child) : child[c.key]}
            </td>
          ))}
          {expand && <td className="expand-cell" />}
        </tr>
      ))
    ];
  };

  return (
    <>
      <div className="table-wrap">
        <table className="data">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map(c => (
                <th key={c.key} className={c.align === "r" ? "r" : ""} scope="col"
                  aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                  {c.sortable === false ? c.label : (
                    <button type="button" onClick={() => toggleSort(c)}>
                      {c.label}
                      <span aria-hidden="true">{sort?.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
                    </button>
                  )}
                </th>
              ))}
              {expand && <th scope="col" className="expand-cell"><span className="sr-only">Expand</span></th>}
            </tr>
          </thead>
          <tbody>
            {pinnedRows?.map(row => renderRow(row, { pinned: true }))}
            {visible.map(row => renderRow(row))}
          </tbody>
        </table>
      </div>
      {sorted.length > visible.length && (
        <div className="table-foot">
          <span className="muted small">Showing {visible.length.toLocaleString()} of {sorted.length.toLocaleString()}</span>
          <button type="button" className="btn sm" onClick={() => setLimit(l => l + (pageSize || 50))}>Show more</button>
        </div>
      )}
    </>
  );
}

/* ---------- overlays ---------- */
export function ConfirmDialog({ open, title, children, confirmLabel = "Confirm", onConfirm, onCancel }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={e => { e.preventDefault(); onCancel(); }} aria-labelledby="confirm-title">
      <div className="dialog-body">
        <h2 id="confirm-title">{title}</h2>
        <div>{children}</div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel} autoFocus>Cancel</button>
          <button type="button" className="btn danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </dialog>
  );
}

export function Drawer({ title, onClose, children }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const onKey = e => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="drawer-head">
          <h2>{title}</h2>
          <button type="button" className="btn sm" onClick={onClose} aria-label="Close details">Close</button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

export function ChartTip({ active, payload, label, format }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <strong>{label}</strong>
      {payload.filter(p => p.value != null).map(p => (
        <div key={p.dataKey} style={{ color: p.color || p.fill }}>
          {payload.length > 1 ? `${p.name}: ` : ""}{format ? format(p.value) : p.value}
        </div>
      ))}
    </div>
  );
}

/** Year-over-year tooltip: every year at the hovered position ranked, with difference and % vs the leader. */
export function YoyTip({ active, payload, label, metricLabel, format, years, colors }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload || {};
  const { ranked, missing } = rankYearValues(Object.fromEntries(years.map(y => [y, row[y] ?? null])));
  const latest = years[years.length - 1];
  const byYear = [...ranked].sort((a, b) => b.year - a.year);
  const swatch = y => <span className="yoy-swatch" style={{ background: colors[years.indexOf(y) % colors.length] }} aria-hidden="true" />;
  return (
    <div className="chart-tip yoy-tip">
      <div className="yoy-head"><strong>{label}</strong><span className="muted">{metricLabel}</span></div>
      <table>
        <thead>
          <tr><th>Year</th><th>Rank</th><th className="r">Value</th><th className="r">vs 1st</th><th className="r">%</th></tr>
        </thead>
        <tbody>
          {byYear.map(r => (
            <tr key={r.year} className={r.year === latest ? "latest" : ""}>
              <td>{swatch(r.year)}{r.year}</td>
              <td className={`rank-cell ${r.rank === 1 ? "rank-leader" : ""}`}>{ordinal(r.rank)}</td>
              <td className="r">{format(r.value)}</td>
              <td className="r">{r.rank === 1 ? "—" : `-${format(Math.abs(r.diff))}`}</td>
              <td className={`r ${r.rank === 1 || r.pct == null ? "" : "negative"}`}>{r.rank === 1 || r.pct == null ? "—" : `${r.pct.toFixed(1)}%`}</td>
            </tr>
          ))}
          {missing.map(y => (
            <tr key={y} className={`muted ${y === latest ? "latest" : ""}`}><td>{swatch(y)}{y}</td><td className="rank-cell">—</td><td colSpan={3}>no data</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
