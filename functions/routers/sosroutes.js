/**
 * @fileoverview SOS trigger and resolution HTTP Cloud Functions for CrowdCommand.
 * Handles fan SOS submissions, security dispatch, exit route calculation,
 * and SOS resolution. All actions complete within 3 seconds per the feature spec.
 *
 * Endpoints:
 *   POST /triggerSos    — Fan raises an SOS; returns exit route immediately
 *   POST /resolveSos    — Security marks an SOS as resolved
 *   GET  /activeSos     — Dashboard polls for all active SOS incidents
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const config = require("../config");
const {
  createSos,
  updateSosStatus,
  getActiveSos,
  getAllVolunteers,
  updateVolunteerStatus,
  createVolunteerTask,
  getAllZones,
} = require("../services/firestoreService");
const { calculateExitRoute, buildMapsEmbedUrl } = require("../services/mapsService");
const { notifySecuritySos } = require("../services/notificationService");
const { logEvent, logSosEvent, EVENT_TYPES } = require("../utils/auditLogger");
const { findNearestVolunteers, getZoneForCoordinates } = require("../utils/geoUtils");

// ─── Helper: CORS headers ─────────────────────────────────────────────────────

/**
 * Applies permissive CORS headers to a Cloud Functions response.
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
 * @returns {boolean} True if preflight was handled
 */
function handlePreflight(req, res) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

// ─── POST /triggerSos ─────────────────────────────────────────────────────────

/**
 * Handles a fan SOS submission. Simultaneously:
 *   1. Writes the SOS to Firestore sos/{sosId} with status "active"
 *   2. Calculates the safest exit route avoiding high-density zones
 *   3. Finds the 2 nearest available security personnel
 *   4. Dispatches FCM push to those security volunteers
 *   5. Creates volunteer task documents
 *   6. Returns the exit route to the fan app in the HTTP response
 *
 * Must respond within 3 seconds — all Firestore writes after the route
 * calculation are fire-and-forget via Promise.allSettled.
 *
 * Request body:
 *   fanId       {string} - Fan identifier
 *   lat         {number} - Fan's GPS latitude
 *   lng         {number} - Fan's GPS longitude
 *   deviceToken {string} - Fan's FCM token (optional — for follow-up pushes)
 *   isDemoFan   {boolean} - True when triggered from DemoControls panel
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @returns {Promise<void>}
 */
exports.triggerSos = functions.https.onRequest(async (req, res) => {
  if (handlePreflight(req, res)) return;
  setCorsHeaders(res);

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const {
    fanId = "demo_fan",
    lat,
    lng,
    deviceToken = null,
    isDemoFan = false,
  } = req.body || {};

  // Use stadium centre as fallback for demo fan or missing coordinates
  const fanLat = parseFloat(lat) || config.zoneCentres["zone_5"].lat;
  const fanLng = parseFloat(lng) || config.zoneCentres["zone_5"].lng;

  // Identify which zone the fan is in
  const zone = getZoneForCoordinates(fanLat, fanLng) || "zone_5";

  try {
    // ── Step 1: Create SOS document immediately ───────────────────────────────
    const sosId = await createSos({
      fanId,
      lat: fanLat,
      lng: fanLng,
      zone,
      deviceToken,
      isDemoFan: !!isDemoFan,
    });

    if (!sosId) {
      throw new Error("Failed to create SOS document in Firestore");
    }

    // ── Step 2 & 3: Calculate exit route + find security — run in parallel ────
    const [zones, volunteers] = await Promise.all([
      getAllZones(),
      getAllVolunteers(),
    ]);

    const [route] = await Promise.all([
      calculateExitRoute(fanLat, fanLng, zones, { densityThreshold: 70 }),
    ]);

    // Filter to security role volunteers only
    const securityVolunteers = volunteers.filter(
      (v) => v.role === "security" && v.status === "available"
    );

    // Find 2 nearest security personnel using Euclidean distance
    const nearestSecurity = findNearestVolunteers(
      fanLat,
      fanLng,
      securityVolunteers,
      2
    );

    // Build maps embed URL for the fan PWA SOSActive screen
    const mapsEmbedUrl = buildMapsEmbedUrl(
      fanLat,
      fanLng,
      route.destinationLat,
      route.destinationLng
    );

    // ── Steps 4 & 5: Dispatch to security — fire-and-forget after response ────
    // We intentionally do NOT await these so the HTTP response is fast
    const dispatchPromises = nearestSecurity.map(async (volunteer) => {
      try {
        // Update volunteer status
        await updateVolunteerStatus(volunteer.id, "responding", {
          currentSosId: sosId,
          respondingToFan: fanId,
        });

        // Create task document
        const taskId = await createVolunteerTask({
          volunteerId: volunteer.id,
          taskType: "sos_response",
          zone,
          instructions: `Respond to SOS from fan ${fanId} at ${zone.replace("_", " ")}. Coordinates: ${fanLat.toFixed(5)}, ${fanLng.toFixed(5)}`,
          priority: 5,
          sosId,
          fanLat,
          fanLng,
        });

        // Send FCM push with fan location
        if (volunteer.deviceToken) {
          await notifySecuritySos(
            volunteer.deviceToken,
            sosId,
            fanLat,
            fanLng,
            zone
          );
        }

        return { volunteerId: volunteer.id, taskId, dispatched: true };
      } catch (dispatchErr) {
        console.error(
          `[sosRoutes.triggerSos] Dispatch failed for volunteer=${volunteer.id} sosId=${sosId} error=${dispatchErr.message}`
        );
        return { volunteerId: volunteer.id, dispatched: false };
      }
    });

    // Audit log — also fire-and-forget
    const auditPromise = logSosEvent(sosId, "raised", {
      fanId,
      zone,
      lat: fanLat,
      lng: fanLng,
      securityDispatched: nearestSecurity.map((v) => v.id),
    });

    // Run all background work in parallel without blocking the response
    Promise.allSettled([...dispatchPromises, auditPromise]).then((results) => {
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        console.error(
          `[sosRoutes.triggerSos] ${failed.length} background tasks failed for sosId=${sosId}`
        );
      }
    });

    // ── Step 6: Return exit route to fan app immediately ──────────────────────
    res.status(200).json({
      success: true,
      data: {
        sosId,
        fanId,
        zone,
        exitRoute: route,
        mapsEmbedUrl,
        securityDispatched: nearestSecurity.length,
        // Security responder animation start point (nearest security volunteer location)
        responderStartLat: nearestSecurity[0]?.lat || fanLat,
        responderStartLng: nearestSecurity[0]?.lng || fanLng,
        message: "Help is on the way. Follow the exit route shown on your screen.",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error(
      `[sosRoutes.triggerSos] fanId=${fanId} lat=${fanLat} lng=${fanLng} error=${err.message}`
    );

    // Even on error, try to write a minimal SOS record so the dashboard shows it
    try {
      const db = admin.firestore();
      await db.collection(config.collections.sos).add({
        fanId,
        lat: fanLat,
        lng: fanLng,
        zone,
        status: "active",
        error: err.message,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isoTimestamp: new Date().toISOString(),
      });
    } catch (fallbackErr) {
      console.error(
        `[sosRoutes.triggerSos] Fallback SOS write also failed: ${fallbackErr.message}`
      );
    }

    res.status(500).json({
      success: false,
      error: "SOS registered but route calculation failed. Please follow staff directions.",
      // Still give the fan something actionable
      fallbackMessage: "Move to your nearest exit and look for security staff in yellow vests.",
    });
  }
});

// ─── POST /resolveSos ─────────────────────────────────────────────────────────

/**
 * Marks an SOS as resolved by a security responder or operator.
 * Updates the SOS status, frees the assigned volunteer, and logs the resolution.
 *
 * Request body:
 *   sosId       {string} - Firestore SOS document ID
 *   resolvedBy  {string} - Volunteer ID or "operator" for manual resolution
 *   notes       {string} - Optional resolution notes
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @returns {Promise<void>}
 */
exports.resolveSos = functions.https.onRequest(async (req, res) => {
  if (handlePreflight(req, res)) return;
  setCorsHeaders(res);

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { sosId, resolvedBy = "operator", notes = "" } = req.body || {};

  if (!sosId) {
    return res.status(400).json({ success: false, error: "sosId is required" });
  }

  try {
    const db = admin.firestore();

    // Read the SOS to get the assigned volunteer
    let sosData = null;
    try {
      const sosDoc = await db.collection(config.collections.sos).doc(sosId).get();
      if (sosDoc.exists) {
        sosData = sosDoc.data();
      }
    } catch (readErr) {
      console.warn(`[sosRoutes.resolveSos] Could not read SOS doc: ${readErr.message}`);
    }

    // Update SOS status
    await updateSosStatus(sosId, "resolved", {
      resolvedBy,
      resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      resolutionNotes: notes,
    });

    // Free the responding volunteer if we know who it was
    if (sosData && resolvedBy && resolvedBy !== "operator") {
      try {
        await updateVolunteerStatus(resolvedBy, "available", {
          currentSosId: null,
          respondingToFan: null,
        });
      } catch (volunteerErr) {
        console.error(
          `[sosRoutes.resolveSos] Failed to update volunteer status. volunteerId=${resolvedBy} error=${volunteerErr.message}`
        );
      }
    }

    // Audit log
    await logSosEvent(sosId, "resolved", {
      fanId: sosData?.fanId || "unknown",
      zone: sosData?.zone || "unknown",
      resolvedBy,
      notes,
    });

    res.status(200).json({
      success: true,
      data: { sosId, status: "resolved", resolvedBy },
    });
  } catch (err) {
    console.error(
      `[sosRoutes.resolveSos] sosId=${sosId} error=${err.message}`
    );
    res.status(500).json({ success: false, error: "Failed to resolve SOS" });
  }
});

// ─── GET /activeSos ───────────────────────────────────────────────────────────

/**
 * Returns all active SOS incidents for the SOSTracker dashboard component.
 * The dashboard also uses a Firestore onSnapshot listener directly,
 * so this endpoint is a fallback for initial load and polling.
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @returns {Promise<void>}
 */
exports.activeSos = functions.https.onRequest(async (req, res) => {
  if (handlePreflight(req, res)) return;
  setCorsHeaders(res);

  try {
    const incidents = await getActiveSos();

    // Enrich each incident with a Maps link for the dashboard
    const enriched = incidents.map((s) => ({
      ...s,
      mapsLink: s.lat && s.lng
        ? `https://www.google.com/maps?q=${s.lat},${s.lng}`
        : null,
    }));

    res.status(200).json({
      success: true,
      data: {
        incidents: enriched,
        count: enriched.length,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error(`[sosRoutes.activeSos] error=${err.message}`);
    res.status(500).json({ success: false, error: "Failed to fetch active SOS incidents" });
  }
});