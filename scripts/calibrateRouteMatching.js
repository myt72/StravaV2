#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const routeMatching = require("../lib/routeMatching");
const calibration = require("./routeCalibration");

const ROOT = path.resolve(__dirname, "..");
const SEEDS_FILE = path.join(ROOT, "calibration", "seeds.json");
const CACHE_FILE = path.join(ROOT, "cache.json");

function parseArgs(argv) {
  const options = { seed: null, json: false, sweep: false, thresholds: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--sweep") options.sweep = true;
    else if (arg === "--seed" || arg === "--thresholds") {
      if (!argv[i + 1]) throw new Error(`${arg} requires a value`);
      options[arg === "--seed" ? "seed" : "thresholds"] = argv[++i];
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function distanceBetweenRepresentatives(a, b, config) {
  const left = routeMatching.prepareRide(a, {}, config);
  const right = routeMatching.prepareRide(b, {}, config);
  if (!left.points || !right.points) return { hausdorff: null, dtw: null };
  const A = routeMatching.project(left.points, left.points[0]);
  const same = routeMatching.project(right.points, left.points[0]);
  const reverse = same.slice().reverse();
  const hausdorff = Math.min(
    routeMatching.hausdorff(A, same, config.HAUSDORFF_PERCENTILE),
    routeMatching.hausdorff(A, reverse, config.HAUSDORFF_PERCENTILE)
  );
  const dtw = Math.min(
    routeMatching.dtw(A, same, config.DTW_BAND_FRACTION),
    routeMatching.dtw(A, reverse, config.DTW_BAND_FRACTION)
  );
  return { hausdorff, dtw };
}

function clusterChecks(seeds, cache, config) {
  const activities = Array.isArray(cache.activities) ? cache.activities : [];
  const clusters = cache.routeClusters && Array.isArray(cache.routeClusters.clusters)
    ? cache.routeClusters
    : routeMatching.buildRouteClusters(activities, cache.segmentData || {}, null, config);
  const activityById = new Map(activities.map(activity => [String(activity.id), activity]));
  const clusterByRoute = new Map(clusters.clusters.map(cluster => [cluster.routeId, cluster]));
  const perSeed = seeds.map(seed => {
    const routeId = clusters.index && clusters.index[String(seed.activityId)];
    const cluster = routeId && clusterByRoute.get(routeId);
    return {
      activityId: String(seed.activityId),
      routeId: routeId || null,
      representativeId: cluster ? String(cluster.representativeId) : null,
      clusterSize: cluster ? cluster.activityIds.length : 0,
      expectedCount: seed.expectedCount,
      sizeDelta: cluster ? cluster.activityIds.length - seed.expectedCount : null,
      clusterMergesSeeds: false
    };
  });
  const pairs = [];
  for (let i = 0; i < perSeed.length; i++) {
    for (let j = i + 1; j < perSeed.length; j++) {
      const left = perSeed[i];
      const right = perSeed[j];
      const leftCluster = left.routeId && clusterByRoute.get(left.routeId);
      const rightCluster = right.routeId && clusterByRoute.get(right.routeId);
      const sameCluster = !!left.routeId && left.routeId === right.routeId;
      if (sameCluster) {
        left.clusterMergesSeeds = true;
        right.clusterMergesSeeds = true;
      }
      const leftRep = leftCluster && activityById.get(String(leftCluster.representativeId));
      const rightRep = rightCluster && activityById.get(String(rightCluster.representativeId));
      pairs.push({
        activityIds: [left.activityId, right.activityId],
        sameCluster,
        representatives: [left.representativeId, right.representativeId],
        ...(leftRep && rightRep ? distanceBetweenRepresentatives(leftRep, rightRep, config) : { hausdorff: null, dtw: null })
      });
    }
  }
  return { perSeed, pairs };
}

function printRideList(label, rides) {
  console.log(`  ${label} (${rides.length})`);
  for (const ride of rides) {
    console.log(`    ${ride.id} | ${ride.date || "no date"} | ${ride.name || "unnamed"} | ${ride.distance} m | H ${ride.hausdorff ?? "-"} | DTW ${ride.dtw ?? "-"} | J ${ride.segmentJaccard ?? "-"}`);
  }
}

function printReadable(report) {
  for (const result of report.seeds) {
    console.log(`\nSeed ${result.activityId}`);
    if (result.skipped) {
      console.log(`  SKIPPED: ${result.skipped}`);
      continue;
    }
    console.log(`  Count incl. self: ${result.counts.withSelf.actual} / ${result.counts.withSelf.expected} (delta ${result.counts.withSelf.delta >= 0 ? "+" : ""}${result.counts.withSelf.delta})`);
    console.log(`  Count excl. self: ${result.counts.withoutSelf.actual} / ${result.counts.withoutSelf.expected} (delta ${result.counts.withoutSelf.delta >= 0 ? "+" : ""}${result.counts.withoutSelf.delta})`);
    const f = result.funnel;
    console.log(`  Funnel: eligible ${f.eligible} -> start/finish ${f.startFinish} -> distance ${f.distance} -> Hausdorff ${f.hausdorff} -> DTW ${f.dtw} -> segment-overlap decision ${f.segmentOverlap}`);
    console.log(`  Direction: ${result.sameDirection.length} same-direction candidates (${result.sameDirection.filter(ride => ride.match).length} accepted); ${result.reverseDirection.length} reverse-direction candidates (${result.reverseDirection.filter(ride => ride.match).length} accepted)`);
    if (result.listScore) {
      console.log(`  ID-list scores: precision ${(result.listScore.precision * 100).toFixed(1)}%, recall ${(result.listScore.recall * 100).toFixed(1)}%, F1 ${(result.listScore.f1 * 100).toFixed(1)}%`);
      printRideList("Missed rides", result.listScore.missedRides);
      printRideList("Extra rides", result.listScore.extraRides);
      printRideList("Known not-matched IDs returned", result.listScore.knownNotMatched);
    } else {
      printRideList("Closest accepted", result.nearBoundary.accepted);
      printRideList("Closest rejected", result.nearBoundary.rejected);
    }
  }
  console.log("\nCluster checks");
  for (const cluster of report.clusterChecks.perSeed) {
    console.log(`  ${cluster.activityId}: cluster size ${cluster.clusterSize}, expected ${cluster.expectedCount}, size delta ${cluster.sizeDelta ?? "n/a"}${cluster.clusterMergesSeeds ? " [MERGES SEEDS]" : ""}`);
  }
  for (const pair of report.clusterChecks.pairs) {
    console.log(`  Pair ${pair.activityIds.join(" / ")}: same cluster ${pair.sameCluster}; representative Hausdorff ${pair.hausdorff ?? "n/a"} m, DTW ${pair.dtw ?? "n/a"} m`);
  }
  if (report.sweep && report.sweep.length) {
    console.log("\nSweep leaders (absolute count error; then mean F1)");
    for (const row of report.sweep.slice(0, 15)) {
      console.log(`  error ${row.totalAbsoluteError}, F1 ${row.meanF1 == null ? "n/a" : row.meanF1.toFixed(3)} | ${JSON.stringify(row.config)}`);
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(CACHE_FILE)) throw new Error("cache.json was not found. Run the app and finish the geo backfill before calibrating.");
  const checkedSeeds = calibration.validateSeeds(loadJson(SEEDS_FILE));
  if (!checkedSeeds.valid) throw new Error(checkedSeeds.errors.join("\n"));
  let seeds = checkedSeeds.seeds;
  if (options.seed) seeds = seeds.filter(seed => seed.activityId === String(options.seed));
  if (!seeds.length) throw new Error(options.seed ? `No calibration seed found for activity ${options.seed}` : "No calibration seeds are configured.");
  let configOverrides = {};
  if (options.thresholds) {
    const loaded = loadJson(path.resolve(process.cwd(), options.thresholds));
    const overrides = loaded.thresholds || loaded.config || loaded;
    configOverrides = routeMatching.validateMatchConfig(overrides);
  }
  const cache = loadJson(CACHE_FILE);
  const config = { ...routeMatching.DEFAULT_MATCH_CONFIG, ...configOverrides };
  const results = seeds.map(seed => calibration.analyzeSeed(seed, cache, config));
  const allSeeds = checkedSeeds.seeds;
  const report = {
    generatedAt: new Date().toISOString(),
    config,
    seeds: results,
    clusterChecks: clusterChecks(allSeeds, cache, config),
    sweep: null
  };
  if (options.sweep) {
    report.sweep = calibration.sweep(allSeeds, cache, configOverrides);
    const best = report.sweep[0];
    if (best && allSeeds.some(seed => !calibration.analyzeSeed(seed, cache, config).skipped)) {
      const recommendedFile = path.join(ROOT, "calibration", "recommended-thresholds.json");
      fs.writeFileSync(recommendedFile, JSON.stringify({
        thresholds: best.config,
        totalAbsoluteError: best.totalAbsoluteError,
        meanF1: best.meanF1,
        note: "Generated by --sweep. Review against matched-ride IDs before changing DEFAULT_MATCH_CONFIG."
      }, null, 2) + "\n");
      report.recommendedThresholdsFile = path.relative(ROOT, recommendedFile);
    }
  }
  const reportFile = path.join(ROOT, "calibration", "report.latest.json");
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n");
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printReadable(report);
}

try {
  main();
} catch (err) {
  console.error(`Route matching calibration failed: ${err.message}`);
  process.exitCode = 1;
}
