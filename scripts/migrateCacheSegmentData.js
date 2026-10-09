const fs = require("fs");
const path = require("path");

const CACHE_FILE = path.resolve(__dirname, "..", "cache.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function main() {
  if (!fs.existsSync(CACHE_FILE)) {
    console.error(`cache.json not found at: ${CACHE_FILE}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(CACHE_FILE, "utf8").trim();
  if (!raw) {
    console.error("cache.json is empty.");
    process.exit(1);
  }

  const cache = readJson(CACHE_FILE);

  const backupFile = path.resolve(
    path.dirname(CACHE_FILE),
    `cache.backup.${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );

  fs.copyFileSync(CACHE_FILE, backupFile);

  const activities = Array.isArray(cache.activities) ? cache.activities : [];
  const rideCount = activities.filter(a => a && a.sport_type === "Ride").length;

  const migrated = {
    ...cache,
    segmentData: {},
    segmentBackfill: {
      enabled: true,
      nextIndex: 0,
      completed: false,
      lastRunAt: null,
      totalEligible: rideCount,
      fetchedThisRun: 0,
      remaining: rideCount
    }
  };

  writeJson(CACHE_FILE, migrated);

  console.log("Migration complete.");
  console.log(`Backup created: ${backupFile}`);
  console.log(`Activities preserved: ${activities.length}`);
  console.log(`Ride activities queued for segment backfill: ${rideCount}`);
  console.log("segmentData was cleared so richer segment records can be repopulated.");
}

main();