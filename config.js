// Settings are read from (in priority order):
//   1. Environment variables: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, PORT
//   2. config.local.js (gitignored - copy config.local.example.js to create it)
// Never put the client secret in this file.

let local = {};
try {
  local = require("./config.local");
} catch (err) {
  if (err.code !== "MODULE_NOT_FOUND") throw err;
}

const port = Number(process.env.PORT || local.port || 5001);
const client_id = process.env.STRAVA_CLIENT_ID || local.client_id;
const client_secret = process.env.STRAVA_CLIENT_SECRET || local.client_secret;

if (!client_id || !client_secret) {
  console.error(
    "Missing Strava credentials. Copy config.local.example.js to config.local.js " +
    "and fill in client_id and client_secret (or set STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET)."
  );
  process.exit(1);
}

module.exports = {
  client_id,
  client_secret,
  port,
  redirect_uri: `http://localhost:${port}/exchange_token`
};
