import { useCallback, useEffect, useState } from "react";
import { SEGMENT_RANKINGS_ENABLED } from "../lib/features.js";
import { isBackfillActive, useAppData } from "../context/AppData.jsx";
import { comma, formatDateTime } from "../lib/format.js";
import { Card, ConfirmDialog, PageHead } from "../components/ui.jsx";

function Row({ label, children }) {
  return <div className="stat-row"><span className="muted">{label}</span><span className="num">{children}</span></div>;
}

export default function Admin() {
  const { raw, serverMessage, lastSync, prBackfill, busy, notice, pull, startBackfill, stopBackfill, unlockAdmin, geoBackfill, geoActive, startGeoBackfill, stopGeoBackfill, recomputeRoutes, elapsedBackfill, elapsedActive, startElapsedBackfill, stopElapsedBackfill, engagementBackfill, engagementActive, startEngagementBackfill, stopEngagementBackfill, segmentRank, rankActive, startSegmentRanks, stopSegmentRanks } = useAppData();
  const [confirmFull, setConfirmFull] = useState(false);
  const [auth, setAuth] = useState({ state: "checking", message: "" });

  const unlock = useCallback(async () => {
    setAuth({ state: "checking", message: "" });
    try {
      await unlockAdmin();
      setAuth({ state: "ok", message: "" });
    } catch (err) {
      setAuth({ state: "locked", message: err.message || "Could not unlock." });
    }
  }, [unlockAdmin]);

  useEffect(() => { unlock(); }, [unlock]);

  if (auth.state !== "ok") {
    return (
      <div className="content">
        <PageHead title="Data & Admin">This page is password protected.</PageHead>
        {auth.state === "checking"
          ? <p className="muted" role="status">Checking password…</p>
          : (
            <>
              {auth.message && <div className="notice error" role="alert">{auth.message}</div>}
              <div className="toolbar"><button type="button" className="btn primary" onClick={unlock}>Enter password</button></div>
            </>
          )}
      </div>
    );
  }

  const isActive = isBackfillActive(prBackfill);
  const processed = prBackfill ? (prBackfill.processed ?? Math.max(0, (prBackfill.totalEligible || 0) - (prBackfill.remaining || 0))) : 0;
  const total = prBackfill?.totalEligible || 0;
  const pct = total > 0 ? Math.min(100, (processed / total) * 100) : 0;
  const stateLabel = !prBackfill ? "Idle" : prBackfill.completed ? "Complete" : (prBackfill.mode || "Idle");
  const working = Boolean(busy);
  const geoTotal = geoBackfill?.totalRides || 0;
  const geoDone = geoBackfill?.processed || 0;
  const geoPct = geoTotal > 0 ? Math.min(100, (geoDone / geoTotal) * 100) : 0;
  const elapsedTotal = elapsedBackfill?.total || 0;
  const elapsedDone = elapsedBackfill?.withElapsed || 0;
  const elapsedPct = elapsedTotal > 0 ? Math.min(100, (elapsedDone / elapsedTotal) * 100) : 0;
  const elapsedState = !elapsedBackfill ? "Idle" : elapsedBackfill.completed && !elapsedActive ? "Complete" : (elapsedBackfill.mode || "Idle");
  const engagementTotal = engagementBackfill?.total || 0;
  const engagementDone = engagementBackfill?.withEngagement || 0;
  const engagementPct = engagementTotal > 0 ? Math.min(100, (engagementDone / engagementTotal) * 100) : 0;
  const engagementState = !engagementBackfill ? "Idle" : engagementBackfill.mode && engagementBackfill.mode !== "idle" ? engagementBackfill.mode : engagementBackfill.completed ? "Complete" : "Idle";
  const geoState = !geoBackfill ? "Idle" : geoBackfill.completed ? "Complete" : (geoBackfill.mode || "Idle");

  const rankTotal = segmentRank?.totalCandidates || 0;
  const rankDone = segmentRank?.checked || 0;
  const rankPct = rankTotal > 0 ? Math.min(100, (rankDone / rankTotal) * 100) : 0;
  const rankState = !segmentRank ? "Idle" : segmentRank.mode && segmentRank.mode !== "idle" ? segmentRank.mode : segmentRank.completed ? "Complete" : "Idle";

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

      <div className="grid two">
        <Card title="Geo backfill (matched rides)" right={geoActive && <span className="nav-badge pulse">Running</span>}>
          <p className="small muted" style={{ marginTop: 0 }}>
            Re-reads your activity list once to add route GPS summaries to cached rides (about {comma(geoBackfill?.estimatedPages || 0)} API
            calls, 200 activities each — not one per ride). Needed once for existing caches.
          </p>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={geoTotal} aria-valuenow={geoDone} aria-label="Geo backfill progress"><div style={{ width: `${geoPct}%` }} /></div>
          <div style={{ marginTop: 8 }}>
            <Row label="Status">{geoState}</Row>
            <Row label="Rides processed">{comma(geoDone)} / {comma(geoTotal)}</Row>
            <Row label="Rides with GPS data">{comma(geoBackfill?.withGps || 0)}</Row>
            <Row label="Pages fetched">{comma(geoBackfill?.pagesDone || 0)}</Row>
            <Row label="Last run">{geoBackfill?.lastRunAt ? formatDateTime(geoBackfill.lastRunAt) : "—"}</Row>
            <Row label="Next retry">{geoBackfill?.nextRetryAt ? formatDateTime(geoBackfill.nextRetryAt) : "—"}</Row>
          </div>
          <p className="hint">{geoBackfill?.message || "Idle"}</p>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button type="button" className="btn primary" disabled={working || geoActive || geoBackfill?.completed} onClick={startGeoBackfill}>Start geo backfill</button>
            <button type="button" className="btn" disabled={working || !geoActive} onClick={stopGeoBackfill}>Stop</button>
            <button type="button" className="btn" disabled={working || geoActive} onClick={recomputeRoutes}>Recompute routes</button>
          </div>
        </Card>

        <Card title="Elapsed time backfill (Trends)" right={elapsedActive && <span className="nav-badge pulse">Running</span>}>
          <p className="small muted" style={{ marginTop: 0 }}>
            Re-reads your activity list once to add elapsed time to cached activities (about {comma(elapsedBackfill?.estimatedPages || 0)} API
            calls, 200 activities each — not one per activity). Needed once for existing caches; it resumes where it left off.
          </p>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={elapsedTotal} aria-valuenow={elapsedDone} aria-label="Elapsed time backfill progress"><div style={{ width: `${elapsedPct}%` }} /></div>
          <div style={{ marginTop: 8 }}>
            <Row label="Status">{elapsedState}</Row>
            <Row label="Activities with elapsed time">{comma(elapsedDone)} / {comma(elapsedTotal)}</Row>
            <Row label="Pages fetched">{comma(elapsedBackfill?.pagesDone || 0)}</Row>
            <Row label="Last run">{elapsedBackfill?.lastRunAt ? formatDateTime(elapsedBackfill.lastRunAt) : "—"}</Row>
            <Row label="Next retry">{elapsedBackfill?.nextRetryAt ? formatDateTime(elapsedBackfill.nextRetryAt) : "—"}</Row>
            <Row label="Last error">{elapsedBackfill?.lastError || "—"}</Row>
          </div>
          <p className="hint">{elapsedBackfill?.message || "Idle"}</p>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button type="button" className="btn primary" disabled={working || elapsedActive || elapsedBackfill?.completed} onClick={startElapsedBackfill}>{elapsedBackfill?.pagesDone ? "Resume elapsed backfill" : "Start elapsed backfill"}</button>
            <button type="button" className="btn" disabled={working || !elapsedActive} onClick={stopElapsedBackfill}>Stop</button>
          </div>
        </Card>
      </div>

      <div className="grid two">
        <Card title="Engagement backfill (kudos, comments, photos)" right={engagementActive && <span className="nav-badge pulse">Running</span>}>
          <p className="small muted" style={{ marginTop: 0 }}>
            Re-reads your activity list once to add kudos, comment and photo counts (counts only, no photos) to cached activities (about {comma(engagementBackfill?.estimatedPages || 0)} API
            calls, 200 activities each — not one per activity). It resumes where it left off. Refresh recent re-reads only the latest {comma(engagementBackfill?.maxPages || 2)} pages
            to update counts on recent rides. Kudos you have given are not available from Strava.
          </p>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={engagementTotal} aria-valuenow={engagementDone} aria-label="Engagement backfill progress"><div style={{ width: `${engagementPct}%` }} /></div>
          <div style={{ marginTop: 8 }}>
            <Row label="Status">{engagementState}</Row>
            <Row label="Activities with engagement data">{comma(engagementDone)} / {comma(engagementTotal)}</Row>
            <Row label="Pages fetched">{comma(engagementBackfill?.pagesDone || 0)}</Row>
            <Row label="Last run">{engagementBackfill?.lastRunAt ? formatDateTime(engagementBackfill.lastRunAt) : "—"}</Row>
            <Row label="Next retry">{engagementBackfill?.nextRetryAt ? formatDateTime(engagementBackfill.nextRetryAt) : "—"}</Row>
            <Row label="Last error">{engagementBackfill?.lastError || "—"}</Row>
          </div>
          {engagementBackfill?.needsRerun && engagementBackfill?.withEngagement > 0 && (
            <p className="hint" role="alert"><strong>Photo counts were corrected: run Start engagement backfill again</strong> to replace the old (zero) photo counts.</p>
          )}
          <p className="hint">{engagementBackfill?.message || "Idle"}</p>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button type="button" className="btn primary" disabled={working || engagementActive || engagementBackfill?.completed} onClick={() => startEngagementBackfill(false)}>{engagementBackfill?.pagesDone ? "Resume engagement backfill" : "Start engagement backfill"}</button>
            <button type="button" className="btn" disabled={working || engagementActive || !engagementDone} onClick={() => startEngagementBackfill(true)}>Refresh recent</button>
            <button type="button" className="btn" disabled={working || !engagementActive} onClick={stopEngagementBackfill}>Stop</button>
          </div>
        </Card>
      </div>

      {SEGMENT_RANKINGS_ENABLED && <div className="grid two">
        <Card title="Segment rankings (leaderboard backfill)" right={rankActive && <span className="nav-badge pulse">Running</span>}>
          <p className="small muted" style={{ marginTop: 0 }}>
            Looks up the top 3 of each segment where you hold a PR, to find your KOMs, 2nd and 3rd places. Uses one API
            request per candidate segment ({comma(rankTotal)} here). Refresh re-checks ranks older than 7 days or with a newer PR.
          </p>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={rankTotal} aria-valuenow={rankDone} aria-label="Segment rank backfill progress"><div style={{ width: `${rankPct}%` }} /></div>
          <div style={{ marginTop: 8 }}>
            <Row label="Status">{rankState}</Row>
            <Row label="Segments checked">{comma(rankDone)} / {comma(rankTotal)}</Row>
            <Row label="Due for refresh">{comma(segmentRank?.stale || 0)}</Row>
            <Row label="KOMs / 2nd / 3rd">{comma(segmentRank?.counts?.kom || 0)} / {comma(segmentRank?.counts?.second || 0)} / {comma(segmentRank?.counts?.third || 0)}</Row>
            <Row label="Last run">{segmentRank?.lastRunAt ? formatDateTime(segmentRank.lastRunAt) : "—"}</Row>
            <Row label="Next retry">{segmentRank?.nextRetryAt ? formatDateTime(segmentRank.nextRetryAt) : "—"}</Row>
          </div>
          <p className="hint">{segmentRank?.message || "Idle"}</p>
          {segmentRank?.lastError && <div className="notice error" role="alert">{segmentRank.lastError}</div>}
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button type="button" className="btn primary" disabled={working || rankActive || segmentRank?.completed} onClick={() => startSegmentRanks(false)}>
              {segmentRank?.checked ? "Resume segment ranks" : "Start segment ranks"}
            </button>
            <button type="button" className="btn" disabled={working || rankActive || !segmentRank?.checked} onClick={() => startSegmentRanks(true)}>Refresh ranks</button>
            <button type="button" className="btn" disabled={working || !rankActive} onClick={stopSegmentRanks}>Stop</button>
          </div>
        </Card>
      </div>}

      <ConfirmDialog open={confirmFull} title="Run a full pull?" confirmLabel="Run full pull"
        onCancel={() => setConfirmFull(false)} onConfirm={() => { setConfirmFull(false); pull("full"); }}>
        A full pull re-downloads every activity and can use a large part of your Strava API rate limit. If you only need new activities, use Refresh instead.
      </ConfirmDialog>
    </div>
  );
}
