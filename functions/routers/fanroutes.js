/**
 * @fileoverview HTTP Cloud Functions for the CrowdCommand fan PWA.
 * Exposes endpoints consumed by the fan-pwa React app:
 *   GET  /fanStatus      — personalised gate + match status for a fan
 *   GET  /exitRoute      — live exit route avoiding high-density zones
 *   POST /confirmTask    — volunteer confirms a dispatched task
 *   POST /updateFcmToken — fan registers/refreshes their FCM device token
 *
 * All endpoints are public (no auth) so judges can open the fan PWA without login.
 * Fan identity is carried via query params (fanId, gateId) as specified in the feature spec.
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const config = require("../config");
const {
  getZone,
  getAllZones,
  getMatchState,
  updateVolunteerStatus,
  updateSosStatus,
} = require("../services/firestoreService");
const { calculateExitRoute, buildMapsEmbedUrl } = require("../services/mapsService");
const { logEvent, EVENT_TYPES } = require("../utils/auditLogger");

// ─── Helper: CORS headers ─────────────────────────────────────────────────────

/**
 * Applies permissive CORS headers to a Cloud Functions response.
 * Required because the fan PWA and dashboard are hosted on different Firebase sites.
 *
 * @param {Object} res - Express response object
 */
function setCorsHeaders(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/**
 * Handles OPTIONS preflight requests for CORS.
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {boolean} True if the request was a preflight and has been handled
 */
function handlePreflight(req, res) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

// ─── GET /fanStatus ───────────────────────────────────────────────────────────

/**
 * Returns personalised match and gate status for a fan.
 * Reads fan's assigned gate, current zone density, gate open/closed state,
 * and the current match phase. Used by the fan PWA HomeScreen and MyGate components.
 *
 * Query params:
 *   fanId  {string} - Fan identifier (used for personalisation and FCM topic subscription)
 *   gateId {string} - Fan's assigned gate ID (e.g. "gate_a")
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @returns {Promise<void>}
 *
 * Response shape:
 * {
 *   fanId: string,
 *   assignedGate: { id, name, zones, covered, lat, lng },
 *   gateStatus: "open" | "closed" | "congested",
 *   alternateGate: { id, name } | null,
 *   matchPhase: string,
 *   zonesDensity: Array<{ id, density, trend }>,
 *   stadiumName: string,
 *   timestamp: string,
 * }
 */
exports.fanStatus = functions.https.onRequest(async (req, res) => {
  if (handlePreflight(req, res)) return;
  setCorsHeaders(res);

  const { fanId = "demo_fan", gateId = "gate_a" } = req.query;

  try {
    // Resolve gate config from static list in config.js
    const assignedGate = config.gates.find((g) => g.id === gateId) || config.gates[0];

    // Read the zones served by this gate to determine congestion
    const zoneDataResults = await Promise.allSettled(
      assignedGate.zones.map((zoneId) => getZone(zoneId))
    );
    const gateZones = zoneDataResults
      .filter((r) => r.status === "fulfilled" && r.value)
      .map((r) => r.value);

    // Determine gate status from average zone density
    const avgDensity =
      gateZones.length > 0
        ? gateZones.reduce((sum, z) => sum + (z.density || 0), 0) / gateZones.length
        : 0;

    let gateStatus = "open";
    let alternateGate = null;

    if (avgDensity >= config.thresholds.gateCapacity) {
      gateStatus = "closed";
      // Suggest the next gate in the list (wraps around)
      const currentIndex = config.gates.findIndex((g) => g.id === gateId);
      const next = config.gates[(currentIndex + 1) % config.gates.length];
      alternateGate = { id: next.id, name: next.name };
    } else if (avgDensity >= 65) {
      gateStatus = "congested";
    }

    // Read all zones for the heatmap summary
    const allZones = await getAllZones();
    const zonesDensity = allZones.map((z) => ({
      id: z.id,
      density: z.density || 0,
      trend: z.trend || "stable",
    }));

    // Read current match state
    const matchState = await getMatchState();

    const payload = {
      fanId,
      assignedGate: {
        id: assignedGate.id,
        name: assignedGate.name,
        zones: assignedGate.zones,
        covered: assignedGate.covered,
        lat: assignedGate.lat,
        lng: assignedGate.lng,
      },
      gateStatus,
      alternateGate,
      matchPhase: matchState.phase || config.matchPhases.prePre,
      zonesDensity,
      stadiumName: config.stadium.name,
      stadiumCapacity: config.stadium.capacity,
      timestamp: new Date().toISOString(),
    };

    res.status(200).json({ success: true, data: payload });
  } catch (err) {
    console.error(
      `[fanRoutes.fanStatus] fanId=${fanId} gateId=${gateId} error=${err.message}`
    );
    res.status(500).json({
      success: false,
      error: "Failed to fetch fan status",
      fanId,
      gateId,
    });
  }
});

// ─── GET /exitRoute ───────────────────────────────────────────────────────────

/**
 * Calculates and returns a live exit route for a fan based on their current GPS position.
 * Avoids zones with density above the safety threshold (default 70%).
 * Used by the fan PWA ExitGuide component and by the SOS handler.
 *
 * Query params:
 *   lat          {number} - Fan's current latitude
 *   lng          {number} - Fan's current longitude
 *   fanId        {string} - Fan identifier for audit logging
 *   coveredOnly  {string} - "true" to restrict to covered gates (used during rain events)
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @returns {Promise<void>}
 *
 * Response shape:
 * {
 *   route: ExitRoute,
 *   mapsEmbedUrl: string,
 *   weatherNote: string | null,
 * }
 */
exports.exitRoute = functions.https.onRequest(async (req, res) => {
  if (handlePreflight(req, res)) return;
  setCorsHeaders(res);

  const {
    lat,
    lng,
    fanId = "unknown",
    coveredOnly = "false",
  } = req.query;

  // Validate coordinates
  const fanLat = parseFloat(lat);
  const fanLng = parseFloat(lng);

  if (isNaN(fanLat) || isNaN(fanLng)) {
    // Fall back to stadium centre if coordinates are missing (demo mode)
    const defaultLat = config.stadium.lat;
    const defaultLng = config.stadium.lng;

    try {
      const zones = await getAllZones();
      const route = await calculateExitRoute(defaultLat, defaultLng, zones, {
        coveredOnly: coveredOnly === "true",
      });
      const embedUrl = buildMapsEmbedUrl(defaultLat, defaultLng, route.destinationLat, route.destinationLng);
      return res.status(200).json({
        success: true,
        data: { route, mapsEmbedUrl: embedUrl, weatherNote: null, usedDefaultCoords: true },
      });
    } catch (fallbackErr) {
      console.error(`[fanRoutes.exitRoute] Fallback also failed. error=${fallbackErr.message}`);
      return res.status(400).json({ success: false, error: "lat and lng are required" });
    }
  }

  try {
    const zones = await getAllZones();

    // Check if there's an active weather event requiring covered-only routing
    let forceCovered = coveredOnly === "true";
    try {
      const db = admin.firestore();
      const weatherSnap = await db
        .collection(config.collections.weatherEvents)
        .orderBy("timestamp", "desc")
        .limit(1)
        .get();

      if (!weatherSnap.empty) {
        const latest = weatherSnap.docs[0].data();
        const ageMs = Date.now() - (latest.timestamp?.toMillis?.() || 0);
        const isRecent = ageMs < 30 * 60 * 1000; // 30 minutes
        if (isRecent && ["rain", "lightning"].includes(latest.type)) {
          forceCovered = true;
        }
      }
    } catch (weatherErr) {
      // Non-fatal — continue without weather constraint
      console.warn(`[fanRoutes.exitRoute] Weather check failed: ${weatherErr.message}`);
    }

    const route = await calculateExitRoute(fanLat, fanLng, zones, {
      coveredOnly: forceCovered,
    });

    const embedUrl = buildMapsEmbedUrl(
      fanLat,
      fanLng,
      route.destinationLat,
      route.destinationLng
    );

    const weatherNote = forceCovered
      ? "Routing to covered exits due to adverse weather conditions."
      : null;

    res.status(200).json({
      success: true,
      data: {
        route,
        mapsEmbedUrl: embedUrl,
        weatherNote,
        usedDefaultCoords: false,
      },
    });
  } catch (err) {
    console.error(
      `[fanRoutes.exitRoute] fanId=${fanId} lat=${fanLat} lng=${fanLng} error=${err.message}`
    );
    res.status(500).json({
      success: false,
      error: "Failed to calculate exit route",
    });
  }
});

// ─── POST /confirmTask ────────────────────────────────────────────────────────

/**
 * Called by a volunteer/staff member to confirm they have received and accepted a task.
 * Updates the volunteer's status to "responding" and the task status to "confirmed".
 * Used by the volunteer PWA (same fan-pwa codebase, different URL params role=staff).
 *
 * Request body:
 *   volunteerId {string} - Firestore volunteer document ID
 *   taskId      {string} - Firestore task document ID
 *   confirmed   {boolean} - true to accept, false to decline
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @returns {Promise<void>}
 */
exports.confirmTask = functions.https.onRequest(async (req, res) => {
  if (handlePreflight(req, res)) return;
  setCorsHeaders(res);

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { volunteerId, taskId, confirmed = true } = req.body || {};

  if (!volunteerId || !taskId) {
    return res.status(400).json({
      success: false,
      error: "volunteerId and taskId are required",
    });
  }

  try {
    const db = admin.firestore();
    const newStatus = confirmed ? "responding" : "available";
    const taskStatus = confirmed ? "confirmed" : "declined";

    // Update volunteer status
    await updateVolunteerStatus(volunteerId, newStatus, {
      currentTask: confirmed ? taskId : null,
    });

    // Update task document
    try {
      await db
        .collection(config.collections.volunteerTasks)
        .doc(taskId)
        .update({
          status: taskStatus,
          confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
          volunteerId,
        });
    } catch (taskErr) {
      console.error(
        `[fanRoutes.confirmTask] Task update failed. taskId=${taskId} error=${taskErr.message}`
      );
      // Non-fatal — volunteer status update succeeded
    }

    // Audit log
    await logEvent(
      EVENT_TYPES.VOLUNTEER_DISPATCH,
      "fanRoutes.confirmTask",
      { volunteerId, taskId, confirmed },
      `Volunteer ${volunteerId} ${confirmed ? "accepted" : "declined"} task ${taskId}`
    );

    res.status(200).json({
      success: true,
      data: { volunteerId, taskId, status: taskStatus },
    });
  } catch (err) {
    console.error(
      `[fanRoutes.confirmTask] volunteerId=${volunteerId} taskId=${taskId} error=${err.message}`
    );
    res.status(500).json({ success: false, error: "Failed to confirm task" });
  }
});

// ─── POST /updateFcmToken ─────────────────────────────────────────────────────

/**
 * Registers or refreshes a fan's FCM device token.
 * Tokens are stored on the fan's Firestore document (fans/{fanId})
 * and used for gate-change and wave-exit push notifications.
 * Also subscribes the fan to their zone's FCM topic (e.g. "zone_3_fans").
 *
 * Request body:
 *   fanId     {string} - Fan identifier
 *   gateId    {string} - Fan's assigned gate (used to derive zone topic)
 *   fcmToken  {string} - FCM registration token from the browser/PWA
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @returns {Promise<void>}
 */
exports.updateFcmToken = functions.https.onRequest(async (req, res) => {
  if (handlePreflight(req, res)) return;
  setCorsHeaders(res);

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { fanId, gateId, fcmToken } = req.body || {};

  if (!fanId || !fcmToken) {
    return res.status(400).json({
      success: false,
      error: "fanId and fcmToken are required",
    });
  }

  try {
    const db = admin.firestore();

    // Upsert fan document with device token
    await db
      .collection("fans")
      .doc(fanId)
      .set(
        {
          fanId,
          gateId: gateId || "gate_a",
          fcmToken,
          tokenUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    // Subscribe the fan to their zone topic for broadcast notifications
    if (gateId) {
      const gate = config.gates.find((g) => g.id === gateId);
      if (gate && gate.zones && gate.zones.length > 0) {
        const zoneTopic = `${gate.zones[0]}_fans`; // Primary zone topic
        try {
          await admin.messaging().subscribeToTopic([fcmToken], zoneTopic);
          console.log(
            `[fanRoutes.updateFcmToken] Subscribed fanId=${fanId} to topic=${zoneTopic}`
          );
        } catch (topicErr) {
          // Non-fatal — token is still saved
          console.warn(
            `[fanRoutes.updateFcmToken] Topic subscription failed. fanId=${fanId} topic=${zoneTopic} error=${topicErr.message}`
          );
        }
      }
    }

    res.status(200).json({
      success: true,
      data: { fanId, gateId, subscribed: true },
    });
  } catch (err) {
    console.error(
      `[fanRoutes.updateFcmToken] fanId=${fanId} error=${err.message}`
    );
    res.status(500).json({ success: false, error: "Failed to update FCM token" });
  }
});

// ─── GET /fanMatchInfo ────────────────────────────────────────────────────────

/**
 * Returns lightweight match information for the fan PWA HomeScreen ticker.
 * No fan-specific data — safe to cache and serve to any visitor.
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @returns {Promise<void>}
 *
 * Response shape:
 * {
 *   matchPhase: string,
 *   stadiumName: string,
 *   capacity: number,
 *   activeAlerts: number,
 *   activeSos: number,
 *   timestamp: string,
 * }
 */
exports.fanMatchInfo = functions.https.onRequest(async (req, res) => {
  if (handlePreflight(req, res)) return;
  setCorsHeaders(res);

  try {
    const db = admin.firestore();
    const matchState = await getMatchState();

    // Count active alerts (non-blocking)
    let activeAlerts = 0;
    let activeSos = 0;

    try {
      const [alertSnap, sosSnap] = await Promise.all([
        db.collection(config.collections.alerts).where("status", "==", "active").count().get(),
        db.collection(config.collections.sos).where("status", "in", ["active", "responding"]).count().get(),
      ]);
      activeAlerts = alertSnap.data().count;
      activeSos = sosSnap.data().count;
    } catch (countErr) {
      console.warn(`[fanRoutes.fanMatchInfo] Count query failed: ${countErr.message}`);
    }

    res.status(200).json({
      success: true,
      data: {
        matchPhase: matchState.phase || config.matchPhases.prePre,
        stadiumName: config.stadium.name,
        capacity: config.stadium.capacity,
        zones: config.stadium.zones,
        activeAlerts,
        activeSos,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error(`[fanRoutes.fanMatchInfo] error=${err.message}`);
    res.status(500).json({ success: false, error: "Failed to fetch match info" });
  }
});