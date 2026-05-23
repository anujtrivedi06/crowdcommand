/**
 * @fileoverview HTTP Cloud Functions for the CrowdCommand operator dashboard.
 * All routes are called by dashboard/src/services/api.js via fetch.
 * Routes handle: demo controls, match state transitions, wave exit staggering,
 * evacuation confirmation/rejection, and demo reset.
 * All mutations are logged to the audit trail.
 */

const admin = require("firebase-admin");
const {
  getDb,
  getMatchState,
  setMatchState,
  resetZonesToBaseline,
  clearAllAlerts,
  clearActiveSos,
  clearFraudAlerts,
  getAllZones,
} = require("../services/firestoreService");
const { overrideZoneDensity } = require("../simulators/sensorSimulator");
const { triggerDemoWeatherEvent } = require("../simulators/weathersimulator");
const { emergencyAgent } = require("../Agents/emergencyAgent");
const { securityAgent } = require("../Agents/securityAgent");
const { logEvent, EVENT_TYPES } = require("../utils/auditLogger");
const {
  notifyWaveExit,
  notifyFansEmergency,
} = require("../services/notificationService");
const config = require("../config");

/**
 * Sends a JSON success response.
 *
 * @param {import("firebase-functions").Response} res - Express response object
 * @param {Object} data - Response payload
 * @param {number} [status=200] - HTTP status code
 */
function sendSuccess(res, data, status = 200) {
  res.status(status).json({ success: true, ...data });
}

/**
 * Sends a JSON error response.
 *
 * @param {import("firebase-functions").Response} res - Express response object
 * @param {string} message - Error message
 * @param {number} [status=500] - HTTP status code
 */
function sendError(res, message, status = 500) {
  res.status(status).json({ success: false, error: message });
}

/**
 * Sets CORS headers and handles preflight OPTIONS requests.
 * Must be called at the top of every HTTP function handler.
 *
 * @param {import("firebase-functions").Request} req
 * @param {import("firebase-functions").Response} res
 * @returns {boolean} True if this was a preflight request (caller should return)
 */
function handleCors(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

// ─── Demo Controls ────────────────────────────────────────────────────────────

/**
 * POST /triggerSurge
 * Instantly sets zone_3 density to 85% with trend "increasing".
 * Triggers the crowdFlowAgent onWrite listener which calls Gemini
 * for surge prediction — the full demo flow runs automatically.
 *
 * @param {import("firebase-functions").Request} req
 * @param {import("firebase-functions").Response} res
 */
async function triggerSurge(req, res) {
  if (handleCors(req, res)) return;

  try {
    const zoneId = req.body.zoneId || "zone_3";
    const density = req.body.density || 85;

    await overrideZoneDensity(zoneId, density, "increasing");

    // Also write several history points so rate-of-change calculation fires
    const {
      appendZoneHistory,
    } = require("../services/firestoreService");

    // Simulate a rapid rise: 60 → 70 → 78 → 85
    await appendZoneHistory(zoneId, 60);
    await appendZoneHistory(zoneId, 70);
    await appendZoneHistory(zoneId, 78);
    await appendZoneHistory(zoneId, density);

    await logEvent(
      EVENT_TYPES.DEMO_TRIGGER,
      "dashboardRoutes.triggerSurge",
      { zoneId, density },
      `Demo surge triggered at ${zoneId} — density set to ${density}%`,
      "DemoControls panel"
    );

    sendSuccess(res, {
      message: `Surge triggered at ${zoneId} — density ${density}%. CrowdFlowAgent processing.`,
      zoneId,
      density,
    });
  } catch (err) {
    console.error(`[dashboardRoutes.triggerSurge] error=${err.message}`);
    sendError(res, err.message);
  }
}

/**
 * POST /triggerWeatherAlert
 * Writes a rain weather event to Firestore.
 * The weatherAgent onWrite trigger processes it automatically.
 *
 * @param {import("firebase-functions").Request} req
 * @param {import("firebase-functions").Response} res
 */
async function triggerWeatherAlert(req, res) {
  if (handleCors(req, res)) return;

  try {
    const type = req.body.type || "rain";
    const severity = req.body.severity || "moderate";

    const eventId = await triggerDemoWeatherEvent(type, severity);

    await logEvent(
      EVENT_TYPES.DEMO_TRIGGER,
      "dashboardRoutes.triggerWeatherAlert",
      { type, severity, eventId },
      `Demo weather alert triggered: ${type} (${severity})`,
      "DemoControls panel"
    );

    sendSuccess(res, {
      message: `Weather event written — weatherAgent processing. type=${type} severity=${severity}`,
      eventId,
    });
  } catch (err) {
    console.error(`[dashboardRoutes.triggerWeatherAlert] error=${err.message}`);
    sendError(res, err.message);
  }
}

/**
 * POST /triggerDemoSos
 * Fires the full SOS flow for a pre-seeded demo fan at zone_5 centre.
 * Writes the SOS document and calls emergencyAgent.dispatchSosResponse.
 *
 * @param {import("firebase-functions").Request} req
 * @param {import("firebase-functions").Response} res
 */
async function triggerDemoSos(req, res) {
  if (handleCors(req, res)) return;

  try {
    const sosData = await emergencyAgent.triggerDemoSos();

    if (!sosData) {
      return sendError(res, "Failed to create demo SOS document");
    }

    await logEvent(
      EVENT_TYPES.DEMO_TRIGGER,
      "dashboardRoutes.triggerDemoSos",
      { sosId: sosData.sosId, zone: "zone_5" },
      "Demo SOS triggered from DemoControls panel",
      "Pre-seeded demo fan at zone_5 centre"
    );

    sendSuccess(res, {
      message: "Demo SOS triggered — SOSTracker and AlertFeed updating.",
      sosId: sosData.sosId,
      lat: sosData.lat,
      lng: sosData.lng,
      zone: sosData.zone,
    });
  } catch (err) {
    console.error(`[dashboardRoutes.triggerDemoSos] error=${err.message}`);
    sendError(res, err.message);
  }
}

/**
 * POST /triggerSecurityAlert
 * Writes a high-score CCTV anomaly for zone_7, bypassing the scheduled scan.
 * The securityAgent.triggerDemoAlert method processes it directly.
 *
 * @param {import("firebase-functions").Request} req
 * @param {import("firebase-functions").Response} res
 */
async function triggerSecurityAlert(req, res) {
  if (handleCors(req, res)) return;

  try {
    const zoneId = req.body.zoneId || "zone_7";
    const label = req.body.label || "aggression";
    const score = req.body.score || 0.91;

    const alertId = await securityAgent.triggerDemoAlert(zoneId, label, score);

    await logEvent(
      EVENT_TYPES.DEMO_TRIGGER,
      "dashboardRoutes.triggerSecurityAlert",
      { zoneId, label, score, alertId },
      `Demo security alert triggered at ${zoneId} — label=${label} score=${score}`,
      "DemoControls panel"
    );

    sendSuccess(res, {
      message: `Security alert triggered at ${zoneId}. AlertFeed updating.`,
      alertId,
      zoneId,
      label,
      score,
    });
  } catch (err) {
    console.error(`[dashboardRoutes.triggerSecurityAlert] error=${err.message}`);
    sendError(res, err.message);
  }
}

// ─── Match lifecycle ──────────────────────────────────────────────────────────

/**
 * POST /endMatch
 * Transitions match phase to "post-match" and initiates the 3-wave exit sequence.
 * Wave 1 fires immediately, waves 2 and 3 are scheduled via setTimeout
 * (acceptable for demo; production would use Cloud Tasks).
 * Only available when match phase is "in-match".
 *
 * @param {import("firebase-functions").Request} req
 * @param {import("firebase-functions").Response} res
 */
async function endMatch(req, res) {
  if (handleCors(req, res)) return;

  try {
    const matchState = await getMatchState();

    if (matchState.phase !== config.matchPhases.inMatch &&
        matchState.phase !== config.matchPhases.halftime) {
      return sendError(res, `Cannot end match in phase: ${matchState.phase}`, 400);
    }

    // Transition to post-match
    await setMatchState(config.matchPhases.postMatch, {
      matchEndedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Write wave sequence document for dashboard tracking
    const waveSequenceRef = getDb()
      .collection(config.collections.waveSequence)
      .doc();

    await waveSequenceRef.set({
      status: "in_progress",
      wave1StartedAt: admin.firestore.FieldValue.serverTimestamp(),
      wave2ScheduledMinutes: config.waveStaggering.wave2DelayMinutes,
      wave3ScheduledMinutes: config.waveStaggering.wave3DelayMinutes,
      wave1Zones: config.waveStaggering.wave1ZoneIds,
      wave2Zones: config.waveStaggering.wave2ZoneIds,
      wave3Zones: config.waveStaggering.wave3ZoneIds,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      isoTimestamp: new Date().toISOString(),
    });

    // Wave 1 — immediate
    await _executeWave(1, config.waveStaggering.wave1ZoneIds, waveSequenceRef.id);

    // Wave 2 — after configured delay (default 4 minutes)
    const wave2DelayMs = config.waveStaggering.wave2DelayMinutes * 60 * 1000;
    setTimeout(async () => {
      await _executeWave(2, config.waveStaggering.wave2ZoneIds, waveSequenceRef.id);
    }, wave2DelayMs);

    // Wave 3 — after configured delay (default 8 minutes)
    const wave3DelayMs = config.waveStaggering.wave3DelayMinutes * 60 * 1000;
    setTimeout(async () => {
      await _executeWave(3, config.waveStaggering.wave3ZoneIds, waveSequenceRef.id);
      // Mark sequence complete after wave 3
      await waveSequenceRef.update({
        status: "complete",
        wave3CompletedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }, wave3DelayMs);

    await logEvent(
      EVENT_TYPES.MATCH_PHASE_CHANGE,
      "dashboardRoutes.endMatch",
      {
        previousPhase: matchState.phase,
        newPhase: config.matchPhases.postMatch,
        waveSequenceId: waveSequenceRef.id,
      },
      "Match ended — wave exit staggering sequence initiated",
      "3-wave exit: zones 1-4 immediate, 5-8 at 4min, 9-12 at 8min"
    );

    sendSuccess(res, {
      message: "Match ended. Wave exit sequence started. Wave 1 firing now.",
      waveSequenceId: waveSequenceRef.id,
      wave1Zones: config.waveStaggering.wave1ZoneIds,
      wave2DelayMinutes: config.waveStaggering.wave2DelayMinutes,
      wave3DelayMinutes: config.waveStaggering.wave3DelayMinutes,
    });
  } catch (err) {
    console.error(`[dashboardRoutes.endMatch] error=${err.message}`);
    sendError(res, err.message);
  }
}

/**
 * Executes a single wave of the exit staggering sequence.
 * Sends FCM notifications to fans in the wave zones and
 * updates the LEDBoard and zone documents.
 *
 * @param {number} waveNumber - Wave number (1, 2, or 3)
 * @param {Array<string>} zoneIds - Zone IDs in this wave
 * @param {string} waveSequenceId - Parent wave sequence document ID
 * @returns {Promise<void>}
 * @private
 */
async function _executeWave(waveNumber, zoneIds, waveSequenceId) {
  try {
    const gateNames = _getGateNamesForZones(zoneIds);
    const exitInstruction = _buildWaveInstruction(waveNumber, gateNames);

    // Send FCM to each zone's fan topic
    await Promise.allSettled(
      zoneIds.map((zoneId) =>
        notifyWaveExit(`${zoneId}_fans`, waveNumber, exitInstruction, gateNames)
      )
    );

    // Update each zone document with wave status
    await Promise.allSettled(
      zoneIds.map((zoneId) =>
        getDb()
          .collection(config.collections.zones)
          .doc(zoneId)
          .update({
            waveStatus: `wave_${waveNumber}_released`,
            waveReleasedAt: admin.firestore.FieldValue.serverTimestamp(),
            exitInstruction,
          })
      )
    );

    // Update LEDBoard for each zone
    await Promise.allSettled(
      zoneIds.map((zoneId) =>
        getDb()
          .collection("led_messages")
          .doc(zoneId)
          .set({
            message: exitInstruction,
            type: `wave_${waveNumber}_exit`,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          })
      )
    );

    // Update wave sequence document with wave timestamp
    await getDb()
      .collection(config.collections.waveSequence)
      .doc(waveSequenceId)
      .update({
        [`wave${waveNumber}ExecutedAt`]: admin.firestore.FieldValue.serverTimestamp(),
        [`wave${waveNumber}Status`]: "released",
      });

    await logEvent(
      EVENT_TYPES.WAVE_RELEASED,
      "dashboardRoutes.waveExit",
      { waveNumber, zoneIds, gateNames, waveSequenceId },
      `Wave ${waveNumber} released — zones ${zoneIds.join(", ")} now exiting`,
      exitInstruction
    );

    console.log(
      `[dashboardRoutes._executeWave] Wave ${waveNumber} complete. zones=${zoneIds.join(",")}`
    );
  } catch (err) {
    console.error(
      `[dashboardRoutes._executeWave] wave=${waveNumber} error=${err.message}`
    );
  }
}

/**
 * Returns comma-separated gate names serving the given zone IDs.
 *
 * @param {Array<string>} zoneIds - Zone IDs to look up
 * @returns {string} Comma-separated gate names
 * @private
 */
function _getGateNamesForZones(zoneIds) {
  const gateNames = config.gates
    .filter((g) => g.zones.some((z) => zoneIds.includes(z)))
    .map((g) => g.name);

  return [...new Set(gateNames)].join(", ");
}

/**
 * Builds a human-readable wave exit instruction string.
 *
 * @param {number} waveNumber - Wave number
 * @param {string} gateNames - Comma-separated gate names
 * @returns {string} Exit instruction
 * @private
 */
function _buildWaveInstruction(waveNumber, gateNames) {
  if (waveNumber === 1) {
    return `Your section may now exit. Please use ${gateNames}. Walk calmly and follow staff.`;
  }
  if (waveNumber === 2) {
    return `Your section may now exit. Please use ${gateNames}. Thank you for your patience.`;
  }
  return `Your section may now exit. Please use ${gateNames}. Thank you for attending today's match.`;
}

// ─── Evacuation confirmation ──────────────────────────────────────────────────

/**
 * POST /confirmEvacuation
 * Operator confirms the pending evacuation plan.
 * Calls emergencyAgent.executeConfirmedPlan which sends all
 * volunteer and fan notifications and updates gate statuses.
 *
 * @param {import("firebase-functions").Request} req
 * @param {import("firebase-functions").Response} res
 */
async function confirmEvacuation(req, res) {
  if (handleCors(req, res)) return;

  try {
    const confirmedBy = req.body.operatorId || "dashboard_operator";

    // Read the pending plan
    const planDoc = await getDb()
      .collection(config.collections.evacuation)
      .doc(config.documents.evacuationCurrent)
      .get();

    if (!planDoc.exists) {
      return sendError(res, "No evacuation plan found to confirm", 404);
    }

    const plan = planDoc.data();

    if (plan.status !== "pending_confirmation") {
      return sendError(
        res,
        `Plan is not pending confirmation — current status: ${plan.status}`,
        400
      );
    }

    await emergencyAgent.executeConfirmedPlan(plan, confirmedBy);

    await logEvent(
      EVENT_TYPES.EVACUATION_CONFIRMED,
      "dashboardRoutes.confirmEvacuation",
      { confirmedBy, planId: planDoc.id, triggerReason: plan.triggerReason },
      `Evacuation confirmed by operator: ${confirmedBy}`,
      plan.reasoning
    );

    sendSuccess(res, {
      message: `Evacuation confirmed by ${confirmedBy}. Volunteers and fans notified.`,
      confirmedBy,
    });
  } catch (err) {
    console.error(`[dashboardRoutes.confirmEvacuation] error=${err.message}`);
    sendError(res, err.message);
  }
}

/**
 * POST /rejectEvacuation
 * Operator rejects the pending evacuation plan.
 * Records the rejection reason in Firestore and audit trail.
 *
 * @param {import("firebase-functions").Request} req
 * @param {import("firebase-functions").Response} res
 */
async function rejectEvacuation(req, res) {
  if (handleCors(req, res)) return;

  try {
    const rejectedBy = req.body.operatorId || "dashboard_operator";
    const reason = req.body.reason || "No reason provided";

    await emergencyAgent.rejectPlan(rejectedBy, reason);

    sendSuccess(res, {
      message: `Evacuation plan rejected by ${rejectedBy}.`,
      rejectedBy,
      reason,
    });
  } catch (err) {
    console.error(`[dashboardRoutes.rejectEvacuation] error=${err.message}`);
    sendError(res, err.message);
  }
}

// ─── Demo reset ───────────────────────────────────────────────────────────────

/**
 * POST /resetDemo
 * Full demo state reset — clears all active alerts, SOSes, fraud alerts,
 * resets zone densities to pre-match baseline, resets match phase to pre-match,
 * and clears the weather state.
 * Allows the demo to be run multiple times cleanly.
 *
 * @param {import("firebase-functions").Request} req
 * @param {import("firebase-functions").Response} res
 */
async function resetDemo(req, res) {
  if (handleCors(req, res)) return;

  try {
    const [zonesReset, alertsCleared, sosCleared, fraudCleared] =
      await Promise.all([
        resetZonesToBaseline(),
        clearAllAlerts(),
        clearActiveSos(),
        clearFraudAlerts(),
      ]);

    // Reset match state to pre-match
    await setMatchState(config.matchPhases.prePre, {
      resetAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Clear weather state
    const { resetWeatherState } = require("../simulators/weathersimulator");
    await resetWeatherState();

    // Clear evacuation plan
    await getDb()
      .collection(config.collections.evacuation)
      .doc(config.documents.evacuationCurrent)
      .set({
        status: "cleared",
        clearedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    // Clear LED messages
    const ledSnapshot = await getDb().collection("led_messages").get();
    const ledBatch = getDb().batch();
    ledSnapshot.docs.forEach((d) =>
      ledBatch.set(d.ref, {
        message: "Welcome to M. Chinnaswamy Stadium",
        type: "default",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    );
    await ledBatch.commit();

    // Clear agent signals older than demo reset
    const signalSnapshot = await getDb()
      .collection(config.collections.agentSignals)
      .orderBy("timestamp", "desc")
      .limit(100)
      .get();
    const signalBatch = getDb().batch();
    signalSnapshot.docs.forEach((d) => signalBatch.delete(d.ref));
    await signalBatch.commit();

    await logEvent(
      EVENT_TYPES.DEMO_RESET,
      "dashboardRoutes.resetDemo",
      {
        zonesReset,
        alertsCleared,
        sosCleared,
        fraudCleared,
      },
      "Demo reset complete — all state cleared, phase set to pre-match",
      ""
    );

    sendSuccess(res, {
      message: "Demo reset complete. Stadium ready for next run.",
      zonesReset,
      alertsCleared,
      sosCleared,
      fraudCleared,
      matchPhase: config.matchPhases.prePre,
    });
  } catch (err) {
    console.error(`[dashboardRoutes.resetDemo] error=${err.message}`);
    sendError(res, err.message);
  }
}

/**
 * GET /matchState
 * Returns the current match state document.
 * Used by the dashboard App.js on initial load.
 *
 * @param {import("firebase-functions").Request} req
 * @param {import("firebase-functions").Response} res
 */
async function getMatchStateHandler(req, res) {
  if (handleCors(req, res)) return;

  try {
    const matchState = await getMatchState();
    sendSuccess(res, { matchState });
  } catch (err) {
    console.error(`[dashboardRoutes.getMatchState] error=${err.message}`);
    sendError(res, err.message);
  }
}

/**
 * POST /setMatchPhase
 * Manually sets the match phase. Used for demo pacing.
 * Valid phases: pre-match, in-match, halftime, post-match.
 *
 * @param {import("firebase-functions").Request} req
 * @param {import("firebase-functions").Response} res
 */
async function setMatchPhase(req, res) {
  if (handleCors(req, res)) return;

  try {
    const { phase } = req.body;
    const validPhases = Object.values(config.matchPhases);

    if (!phase || !validPhases.includes(phase)) {
      return sendError(
        res,
        `Invalid phase. Must be one of: ${validPhases.join(", ")}`,
        400
      );
    }

    await setMatchState(phase, {
      setManuallyAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await logEvent(
      EVENT_TYPES.MATCH_PHASE_CHANGE,
      "dashboardRoutes.setMatchPhase",
      { phase },
      `Match phase manually set to: ${phase}`,
      "Manual override from dashboard"
    );

    sendSuccess(res, { message: `Match phase set to: ${phase}`, phase });
  } catch (err) {
    console.error(`[dashboardRoutes.setMatchPhase] error=${err.message}`);
    sendError(res, err.message);
  }
}

module.exports = {
  triggerSurge,
  triggerWeatherAlert,
  triggerDemoSos,
  triggerSecurityAlert,
  endMatch,
  confirmEvacuation,
  rejectEvacuation,
  resetDemo,
  getMatchStateHandler,
  setMatchPhase,
};