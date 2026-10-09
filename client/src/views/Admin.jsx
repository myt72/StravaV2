import { useState } from "react";
import { isBackfillActive, useAppData } from "../context/AppData.jsx";
import { comma, formatDateTime } from "../lib/format.js";
import { Card, ConfirmDialog, PageHead } from "../components/ui.jsx";

function Row({ label, children }) {
  return <div className="stat-row"><span className="muted">{label}</span><span className="num">{children}</span></div>;
}

export default function Admin() {
  const { raw, serverMessage, lastSync, prBackfill, busy, notice, pull, startBackfill, stopBackfill } = useAppData();
  const [confirmFull, setConfirmFull] = useState(false);

  const isActive = isBackfillActive(prBackfill);
  const processed = prBackfill ? (prBackfill.processed ?? Math.max(0, (prBackfill.totalEligible || 0) - (prBackfill.remaining || 0))) : 0;
  const total = prBackfill?.totalEligible || 0;
  const pct = total > 0 ? Math.min(100, (processed / total) * 100) : 0;
  const stateLabel = !prBackfill ? "Idle" : prBackfill.completed ? "Complete" : (prBackfill.mode || "Idle");
  const working = Boolean(busy);

  return (
    <div className="content">
      <PageHead title="Data & Admin">Refresh your data from Strava and manage the PR / segment backfill. These actions use your Strava rate limit.</PageHead>

      {notice && <div className={`notice ${notice.type}`} role="status" aria-live="polite">{notice.text}</div>}

      <div className="grid two">
        <Card title="Pull data from Strava">
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <button type="button" className="btn primary" disabled={working} onClick={() => pull("refresh")}>
              {busy === "refresh" ? "Refreshing…" : "Refresh"}
            </button>
            <button type="button" className="btn" disabled={working} onClick={() => pull("resume")}>
              {busy === "resume" ? "Resuming…" : "Resume pull"}
            </button>
            <button type="button" className="btn danger" disabled={working} onClick={() => setConfirmFull(true)}>
              {busy === "full" ? "Pulling…" : "Full pull"}
            </button>
          </div>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li><strong>Refresh</strong> — only new activities plus PR data.</li>
            <li><strong>Resume pull</strong> — fills gaps from an interrupted pull.</li>
            <li><strong>Full pull</strong> — re-downloads everything; expensive on the rate limit.</li>
          </ul>
          <div style={{ marginTop: 12 }}>
            <Row label="Last sync (this browser)">{lastSync ? lastSync.toLocaleString() : "—"}</Row>
            <Row label="Activities loaded">{raw ? comma(raw.activities.length) : "—"}</Row>
            <Row label="Server message">{serverMessage || "—"}</Row>
          </div>
        </Card>

        <Card title="PR backfill" right={isActive && <span className="nav-badge pulse">Running</span>}>
          {!prBackfill ? <p className="muted">No PR backfill activity yet.</p> : (
            <>
              <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={processed} aria-label="PR backfill progress"><div style={{ width: `${pct}%` }} /></div>
              <div style={{ marginTop: 8 }}>
                <Row label="Status">{stateLabel}</Row>
                <Row label="Progress">{comma(processed)} / {comma(total)}</Row>
                <Row label="Remaining">{comma(prBackfill.remaining || 0)}</Row>
                <Row label="Fetched this run">{comma(prBackfill.fetchedThisRun || 0)}</Row>
                <Row label="Last run">{prBackfill.lastRunAt ? formatDateTime(prBackfill.lastRunAt) : "—"}</Row>
                <Row label="Next retry">{prBackfill.nextRetryAt ? formatDateTime(prBackfill.nextRetryAt) : "—"}</Row>
              </div>
              <p className="hint">{prBackfill.message || "Idle"}</p>
            </>
          )}
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button type="button" className="btn primary" disabled={working || isActive} onClick={startBackfill}>Start PR backfill</button>
            <button type="button" className="btn" disabled={working || !isActive} onClick={stopBackfill}>Stop</button>
          </div>
          {isActive && <p className="hint">Status refreshes every 15 seconds while the job is active.</p>}
        </Card>
      </div>

      <ConfirmDialog open={confirmFull} title="Run a full pull?" confirmLabel="Run full pull"
        onCancel={() => setConfirmFull(false)} onConfirm={() => { setConfirmFull(false); pull("full"); }}>
        A full pull re-downloads every activity and can use a large part of your Strava API rate limit. If you only need new activities, use Refresh instead.
      </ConfirmDialog>
    </div>
  );
}
