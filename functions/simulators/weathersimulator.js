/**
 * @fileoverview Weather event simulator for CrowdCommand.
 * Runs as a Firebase Scheduled Function every 1 minute.
 * Generates realistic weather progression across the match lifecycle —
 * clear conditions early, increasing probability of rain or heat events
 * during in-match and halftime phases, clearing post-match.
 * Weather events written here trigger the weatherAgent onWrite listener
 * which calls Gemini and issues rerouting signals.
 * Also maintains a current weather state document for the WeatherWidget.
 */

const admin = require("firebase-admin");
const { getDb, getMatchState } = require("../services/firestoreService");
const { logEvent, EVENT_TYPES } = require("../utils/auditLogger");
const config = require("../config");

/**
 * Probability of generating a weather event per tick, by match phase.
 * Pre-match: rare events (drizzle possible).
 * In-match: highest risk window for weather disruption.
 * Halftime: moderate — brief heavy rain common at halftime in Bengaluru.
 * Post-match: low — crowds are exiting so weather impact is lower.
 *
 * @type {Object.<string, number>}
 */
const EVENT_PROBABILITY_BY_PHASE = {
  "pre-match": 0.05,
  "in-match": 0.12,
  halftime: 0.18,
  "post-match": 0.06,
};

/**
 * Weighted weather event type pool.
 * Each entry is [eventType, severity, weight].
 * Higher weight = more likely to be selected when an event fires.
 *
 * @type {Array<[string, string, number]>}
 */
const WEATHER_EVENT_POOL = [
  ["rain", "light", 30],
  ["rain", "moderate", 25],
  ["rain", "heavy", 15],
  ["lightning", "severe", 8],
  ["heatwave", "moderate", 12],
  ["heatwave", "severe", 5],
  ["strong_wind", "moderate", 5],
];

/**
 * Duration in minutes that each severity level keeps the weather state active
 * before auto-resolving to "clear". The simulator writes a "clear" event
 * after this window so WeatherWidget returns to green.
 *
 * @type {Object.<string, number>}
 */
const AUTO_RESOLVE_MINUTES = {
  light: 8,
  moderate: 15,
  heavy: 20,
  severe: 25,
};

/**
 * Selects a weather event type from the pool using weighted random selection.
 *
 * @returns {{ type: string, severity: string }} Selected weather event
 */
function selectWeightedEvent() {
  const totalWeight = WEATHER_EVENT_POOL.reduce((sum, [, , w]) => sum + w, 0);
  let roll = Math.random() * totalWeight;

  for (const [type, severity, weight] of WEATHER_EVENT_POOL) {
    roll -= weight;
    if (roll <= 0) {
      return { type, severity };
    }
  }

  // Fallback to light rain if rounding error exhausts the pool
  return { type: "rain", severity: "light" };
}

/**
 * Reads the current weather state document to check if an active event
 * is already in progress. Prevents stacking multiple concurrent events.
 *
 * @returns {Promise<Object|null>} Current weather state or null if clear
 */
async function getCurrentWeatherState() {
  try {
    const doc = await getDb()
      .collection(config.collections.config)
      .doc("weatherState")
      .get();

    if (!doc.exists) return null;
    const data = doc.data();

    // Consider the event resolved if it has been active past its auto-resolve window
    if (data.resolvedAt || data.currentEvent === "clear") return null;

    const severity = data.severity || "light";
    const resolveMinutes = AUTO_RESOLVE_MINUTES[severity] || 15;
    const createdMs = data.updatedAt
      ? data.updatedAt.toMillis()
      : Date.now() - resolveMinutes * 60 * 1000;

    if (Date.now() - createdMs > resolveMinutes * 60 * 1000) {
      return null; // Auto-resolve window passed
    }

    return data;
  } catch (err) {
    console.error(
      `[weatherSimulator.getCurrentWeatherState] error=${err.message}`
    );
    return null;
  }
}

/**
 * Writes a weather clear event to reset the WeatherWidget to green.
 * Called automatically after the auto-resolve window for an active event passes.
 *
 * @returns {Promise<void>}
 */
async function writeClearEvent() {
  try {
    await getDb()
      .collection(config.collections.config)
      .doc("weatherState")
      .set(
        {
          currentEvent: "clear",
          severity: "none",
          riskLevel: "low",
          fanMessage: "Weather conditions are clear.",
          staffMessage: "No weather concerns — normal operations.",
          reasoning: "Auto-resolved by weather simulator after event window expired.",
          affectedZones: [],
          rerouteToZones: [],
          resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          isoTimestamp: new Date().toISOString(),
        },
        { merge: false }
      );

    console.log("[weatherSimulator] Weather cleared — state reset to clear.");
  } catch (err) {
    console.error(
      `[weatherSimulator.writeClearEvent] error=${err.message}`
    );
  }
}

/**
 * Writes a weather event document to the weather_events collection.
 * The weatherAgent onWrite trigger picks this up and processes it.
 *
 * @param {string} type - Weather event type (e.g. "rain", "lightning")
 * @param {string} severity - Severity level (e.g. "moderate", "severe")
 * @param {boolean} [isSimulated=true] - Whether this is a simulated event
 * @param {boolean} [isDemo=false] - Whether this was triggered by DemoControls
 * @returns {Promise<string|null>} New event document ID or null on failure
 */
async function writeWeatherEvent(type, severity, isSimulated = true, isDemo = false) {
  try {
    const ref = await getDb()
      .collection(config.collections.weatherEvents)
      .add({
        type,
        severity,
        source: isDemo ? "demo_controls" : "weather_simulator",
        isSimulated,
        isDemo,
        processed: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isoTimestamp: new Date().toISOString(),
      });

    console.log(
      `[weatherSimulator] Weather event written. type=${type} severity=${severity} id=${ref.id}`
    );

    return ref.id;
  } catch (err) {
    console.error(
      `[weatherSimulator.writeWeatherEvent] type=${type} severity=${severity} error=${err.message}`,
      { type, severity }
    );
    return null;
  }
}

/**
 * Main simulator function — called by the Scheduled Function every minute.
 * Checks if a weather event is already active, and if not, probabilistically
 * generates a new weather event based on the current match phase.
 * Auto-resolves expired events to clear.
 *
 * @returns {Promise<void>}
 */
async function runWeatherSimulator() {
  try {
    const matchState = await getMatchState();
    const phase = matchState.phase || config.matchPhases.prePre;

    const currentWeather = await getCurrentWeatherState();

    // If an active event is in progress, check if it needs auto-resolving
    if (currentWeather) {
      const severity = currentWeather.severity || "light";
      const resolveMinutes = AUTO_RESOLVE_MINUTES[severity] || 15;
      const createdMs = currentWeather.updatedAt
        ? currentWeather.updatedAt.toMillis()
        : Date.now();

      if (Date.now() - createdMs > resolveMinutes * 60 * 1000) {
        await writeClearEvent();
        await logEvent(
          EVENT_TYPES.SIMULATOR_TICK,
          "weatherSimulator",
          { phase, action: "auto_resolve", severity },
          `Weather event auto-resolved after ${resolveMinutes} minutes`,
          ""
        );
      } else {
        // Active event still within its window — do nothing
        console.log(
          `[weatherSimulator] Active weather event in progress (${currentWeather.currentEvent} ${severity}) — skipping tick.`
        );
      }
      return;
    }

    // Probabilistically generate a new event based on match phase
    const eventProbability = EVENT_PROBABILITY_BY_PHASE[phase] ?? 0.05;
    const roll = Math.random();

    if (roll > eventProbability) {
      // No event this tick
      console.log(
        `[weatherSimulator] No event this tick. phase=${phase} roll=${roll.toFixed(3)} threshold=${eventProbability}`
      );
      return;
    }

    // Select and write a weather event
    const { type, severity } = selectWeightedEvent();
    const eventId = await writeWeatherEvent(type, severity, true, false);

    if (eventId) {
      await logEvent(
        EVENT_TYPES.SIMULATOR_TICK,
        "weatherSimulator",
        { phase, type, severity, eventId },
        `Weather event generated: ${type} (${severity}) during ${phase}`,
        ""
      );
    }
  } catch (err) {
    console.error(
      `[weatherSimulator.runWeatherSimulator] error=${err.message}`, err
    );
  }
}

/**
 * Triggers an immediate demo weather event for the DemoControls panel.
 * Bypasses the probability check and writes directly to weather_events.
 *
 * @param {string} [type="rain"] - Weather event type
 * @param {string} [severity="moderate"] - Severity level
 * @returns {Promise<string|null>} New event document ID or null on failure
 */
async function triggerDemoWeatherEvent(type = "rain", severity = "moderate") {
  const eventId = await writeWeatherEvent(type, severity, false, true);

  if (eventId) {
    await logEvent(
      EVENT_TYPES.SIMULATOR_TICK,
      "weatherSimulator.demo",
      { type, severity, eventId, isDemo: true },
      `Demo weather event triggered manually: ${type} (${severity})`,
      "Triggered from DemoControls panel"
    );
  }

  return eventId;
}

/**
 * Resets the weather state to clear — called by the demo reset flow.
 *
 * @returns {Promise<void>}
 */
async function resetWeatherState() {
  await writeClearEvent();
  await logEvent(
    EVENT_TYPES.SIMULATOR_TICK,
    "weatherSimulator.reset",
    {},
    "Weather state reset to clear by demo reset",
    ""
  );
}

module.exports = {
  runWeatherSimulator,
  triggerDemoWeatherEvent,
  resetWeatherState,
  writeWeatherEvent,
  WEATHER_EVENT_POOL,
  EVENT_PROBABILITY_BY_PHASE,
};