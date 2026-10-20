// Settings are read from (in priority order):
//   1. Environment variables: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, ADMIN_PASSWORD, PORT
//   2. config.local.js (gitignored - copy config.local.example.js to create it)
// config.local.js is read once at startup: restart the server after editing it.
// Never put the client secret in this file.

const { createBikeTypeResolver } = require("./lib/bikeTypes");

let local = {};
try {
  local = require("./config.local");
} catch (err) {
  if (err.code !== "MODULE_NOT_FOUND") throw err;
}

const port = Number(process.env.PORT || local.port || 5001);
const client_id = process.env.STRAVA_CLIENT_ID || local.client_id;
const client_secret = process.env.STRAVA_CLIENT_SECRET || local.client_secret;
const admin_password = process.env.ADMIN_PASSWORD || local.ADMIN_PASSWORD || "";
const resolver = createBikeTypeResolver(local.bike_types);
const bike_types = resolver.types;
const getBikeType = resolver.getBikeType;
const applyBikeTypes = resolver.applyBikeTypes;
const findUnmatchedBikeTypes = resolver.findUnmatched;

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
  admin_password,
  bike_types,
  getBikeType,
  applyBikeTypes,
  findUnmatchedBikeTypes,
  port,
  redirect_uri: `http://localhost:${port}/exchange_token`
};
