const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function loadConfig(local = {}, env = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, "../config.js"), "utf8");
  vm.runInNewContext(source, {
    module,
    URL,
    process: { env: { STRAVA_CLIENT_ID: "id", STRAVA_CLIENT_SECRET: "secret", ...env } },
    require(name) {
      if (name === "./config.local") return local;
      if (name === "./lib/bikeTypes") return { createBikeTypeResolver: () => ({}) };
      throw new Error(`Unexpected dependency: ${name}`);
    }
  });
  return module.exports;
}

test("Strava redirect defaults to localhost and honors local and environment settings", () => {
  assert.equal(loadConfig({}, { PORT: "5002" }).redirect_uri, "http://localhost:5002/exchange_token");
  const local = { redirect_uri: "http://192.168.0.115:5001/exchange_token" };
  assert.equal(loadConfig(local).redirect_uri, local.redirect_uri);
  assert.equal(loadConfig(local, { STRAVA_REDIRECT_URI: "https://example.com/exchange_token" }).redirect_uri,
    "https://example.com/exchange_token");
});

test("invalid Strava redirects fail at startup", () => {
  for (const uri of ["not a URL", "ftp://example.com/exchange_token", "http://example.com/",
    "http://example.com/exchange_token?other=value", "http://user@example.com/exchange_token"]) {
    assert.throws(() => loadConfig({ redirect_uri: uri }), /Strava redirect URI/);
  }
});
