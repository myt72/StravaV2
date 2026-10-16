// Segment rankings (KOM / 2nd / 3rd) need Strava's GET /segments/{id}/leaderboard,
// which Strava answers with 403 Forbidden for this app. Set to true to bring the
// Records panel, the Admin backfill card and the rank polling back.
export const SEGMENT_RANKINGS_ENABLED = false;
