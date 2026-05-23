/**
 * @fileoverview Sensor simulator for CrowdCommand.
 * Runs as a Firebase Scheduled Function every 1 minute.
 * Each invocation writes 12 zone density documents to Firestore,
 * simulating a realistic crowd pattern across match phases.
 * Density values follow a match arc: low pre-match, rising at kickoff,
 * peaking during key moments, dropping post-match.
 * Also appends each reading to the zone history subcollection
 * so crowdFlowAgent can compute rate-of-change.
 */

const admin = require("firebase-admin");
const { setZone, appendZoneHistory, getMatchState } = require("../services/firestoreService");
const { logEvent, EVENT_TYPES } = require("../utils/auditLogger");
const config = require("../config");

/**
 * Base density profiles per zone per match phase.
 * Values are the mean density — actual values are jittered ±8 for realism.
 * Zone layout: zones 1-4 are north stand (fills first), 5-8 east/west,
 * 9-12 south stand (corporate — fills last).
 *
 * @type {Object.<string, Object.<string, number>>}
 */
const DENSITY_PROFILES = {
  "pre-match": {
    zone_1: 28, zone_2: 25, zone_3: 32, zone_4: 20,
    zone_5: 18, zone_6: 22, zone_7: 15, zone_8: 19,
    zone_9: 12, zone_10: 14, zone_11: 16, zone_12: 10,
  },
  "in-match": {
    zone_1: 78, zone_2: 82, zone_3: 75, zone_4: 88,
    zone_5: 70, zone_6: 65, zone_7: 72, zone_8: 68,
    zone_9: 55, zone_10: 58, zone_11: 52, zone_12: 60,
  },
  halftime: {
    zone_1: 60, zone_2: 58, zone_3: 65, zone_4: 55,
    zone_5: 70, zone_6: 72, zone_7: 68, zone_8: 65,
    zone_9: 45, zone_10: 48, zone_11: 50, zone_12: 42,
  },
  "post-match": {
    zone_1: 45, zone_2: 40, zone_3: 50, zone_4: 35,
    zone_5: 30, zone_6: 28, zone_7: 25, zone_8: 32,
    zone_9: 20, zone_10: 18, zone_11: 22, zone_12: 15,
  },
};

/**
 * Trend thresholds — a zone is "increasing" if its jittered density
 * is more than 5 points above the profile mean, "decreasing" if more than 5 below.
 * @type {number}
 */
const TREND_DELTA = 5;

/**
 * Jitter range applied to each density reading for realism.
 * @type {number}
 */
const JITTER = 8;

/**
 * Computes a jittered density value clamped to [0, 100].
 *
 * @param {number} base - Base density from the profile
 * @returns {{ density: number, jitter: number }} Jittered density and the raw jitter applied
 */
function jitterDensity(base) {
  const jitter = Math.round((Math.random() - 0.5) * 2 * JITTER);
  const density = Math.min(100, Math.max(0, base + jitter));
  return { density, jitter };
}

/**
 * Derives the trend label from the jitter applied.
 *
 * @param {number} jitter - Raw jitter value applied to this reading
 * @returns {"increasing"|"stable"|"decreasing"} Trend label
 */
function deriveTrend(jitter) {
  if (jitter > TREND_DELTA) return "increasing";
  if (jitter < -TREND_DELTA) return "decreasing";
  return "stable";
}

/**
 * Main simulator function — called by the Scheduled Function every minute.
 * Reads the current match phase from Firestore and writes one density
 * reading per zone using the corresponding profile.
 *
 * @returns {Promise<void>}
 */
async function runSensorSimulator() {
  try {
    const matchState = await getMatchState();
    const phase = matchState.phase || config.matchPhases.prePre;
    const profile = DENSITY_PROFILES[phase] || DENSITY_PROFILES["pre-match"];

    const zoneIds = Object.keys(config.zoneCentres);
    const timestamp = new Date().toISOString();

    await Promise.all(
      zoneIds.map(async (zoneId) => {
        const base = profile[zoneId] ?? 30;
        const { density, jitter } = jitterDensity(base);
        const trend = deriveTrend(jitter);

        // Write main zone document
        await setZone(zoneId, {
          density,
          trend,
          matchPhase: phase,
          simulatedAt: timestamp,
        });

        // Append to history subcollection for rate-of-change analysis
        await appendZoneHistory(zoneId, density);
      })
    );

    await logEvent(
      EVENT_TYPES.SIMULATOR_TICK,
      "sensorSimulator",
      { phase, zoneCount: zoneIds.length, timestamp },
      `Sensor tick complete — ${zoneIds.length} zones updated for phase: ${phase}`,
      ""
    );

    console.log(
      `[sensorSimulator] Tick complete. phase=${phase} zones=${zoneIds.length} at=${timestamp}`
    );
  } catch (err) {
    console.error(`[sensorSimulator.runSensorSimulator] error=${err.message}`, err);
  }
}

/**
 * Instantly sets a specific zone to a target density.
 * Used by DemoControls "Trigger surge at Gate 3" button.
 *
 * @param {string} zoneId - Zone to override (e.g. "zone_3")
 * @param {number} density - Target density value (0-100)
 * @param {"increasing"|"stable"|"decreasing"} [trend="increasing"] - Trend to set
 * @returns {Promise<boolean>} True on success
 */
async function overrideZoneDensity(zoneId, density, trend = "increasing") {
  try {
    await setZone(zoneId, {
      density,
      trend,
      isOverride: true,
      overriddenAt: new Date().toISOString(),
    });

    await appendZoneHistory(zoneId, density);

    await logEvent(
      EVENT_TYPES.SIMULATOR_TICK,
      "sensorSimulator.override",
      { zoneId, density, trend },
      `Demo override: ${zoneId} set to ${density}% (${trend})`,
      "Manual trigger from DemoControls panel"
    );

    return true;
  } catch (err) {
    console.error(
      `[sensorSimulator.overrideZoneDensity] zoneId=${zoneId} error=${err.message}`
    );
    return false;
  }
}

module.exports = { runSensorSimulator, overrideZoneDensity, DENSITY_PROFILES };