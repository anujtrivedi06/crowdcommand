/**
 * @fileoverview Analytics HTTP Cloud Functions for CrowdCommand.
 * Serves aggregated metrics to the AnalyticsTab dashboard component.
 * All queries read from Firestore — no BigQuery dependency per the tech stack spec.
 *
 * Endpoints:
 *   GET /analyticsOverview  — 4 key stat cards: peak density, SOS count, alerts, gate changes
 *   GET /densityTimeline    — Per-zone density history for sparkline charts
 *   GET /agentActivity      — Agent signal counts grouped by agent name
 *   GET /incidentSummary    — Breakdown of alert types and resolutions
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const config = require("../config");
const { getMatchState, getAllZones } = require("../services/firestoreService");

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

/**
 * Returns a Firestore Timestamp for N minutes ago.
 *
 * @param {number} minutes - How many minutes back
 * @returns {FirebaseFirestore.Timestamp}
 */
function minutesAgo(minutes) {
  return admin.firestore.Timestamp.fromDate(
    new Date(Date.now() - minutes * 60 * 1000)
  );
}

// ─── GET /analyticsOverview ───────────────────────────────────────────────────

/**
 * Returns the 4 key metric stat cards shown in AnalyticsTab.js.
 * Reads live counts from Firestore collections — no aggregation pipeline needed.
 *
 * Response shape:
 * {
 *   peakDensityZone: { zoneId, density, trend },
 *   totalSosRaised: number,
 *   activeSosCount: number,
 *   totalAlertsTriggered: number,
 *   activeAlertCount: number,
 *   gateChangesIssued: number,
 *   volunteersDeployed: number,
 *   matchPhase: string,
 *   stadiumName: string,
 *   timestamp: string,
 * }
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @returns {Promise<void>}
 */
exports.analyticsOverview = functions.https.onRequest(async (req, res) => {
  if (handlePreflight(req, res)) return;
  setCorsHeaders(res);

  try {
    const db = admin.firestore();

    // Run all Firestore reads in parallel for speed
    const [
      zonesSnap,
      totalSosSnap,
      activeSosSnap,
      totalAlertsSnap,
      activeAlertsSnap,
      gateChangeSnap,
      volunteerSnap,
      matchState,
    ] = await Promise.allSettled([
      db.collection(config.collections.zones).get(),
      db.collection(config.collections.sos).count().get(),
      db.collection(config.collections.sos)
        .where("status", "in", ["active", "responding"])
        .count()
        .get(),
      db.collection(config.collections.alerts).count().get(),
      db.collection(config.collections.alerts)
        .where("status", "==", "active")
        .count()
        .get(),
      db.collection(config.collections.auditLog)
        .where("eventType", "==", "gate_reroute")
        .count()
        .get(),
      db.collection(config.collections.volunteers)
        .where("status", "in", ["assigned", "responding"])
        .count()
        .get(),
      getMatchState(),
    ]);

    // Extract zone with highest current density
    let peakDensityZone = { zoneId: "zone_1", density: 0, trend: "stable" };
    if (zonesSnap.status === "fulfilled") {
      zonesSnap.value.docs.forEach((doc) => {
        const data = doc.data();
        if ((data.density || 0) > peakDensityZone.density) {
          peakDensityZone = {
            zoneId: doc.id,
            density: data.density || 0,
            trend: data.trend || "stable",
          };
        }
      });
    }

    const safeCount = (result) => {
      if (result.status === "fulfilled") {
        try {
          return result.value.data().count;
        } catch {
          return 0;
        }
      }
      return 0;
    };

    res.status(200).json({
      success: true,
      data: {
        peakDensityZone,
        totalSosRaised: safeCount(totalSosSnap),
        activeSosCount: safeCount(activeSosSnap),
        totalAlertsTriggered: safeCount(totalAlertsSnap),
        activeAlertCount: safeCount(activeAlertsSnap),
        gateChangesIssued: safeCount(gateChangeSnap),
        volunteersDeployed: safeCount(volunteerSnap),
        matchPhase:
          matchState.status === "fulfilled"
            ? matchState.value.phase || config.matchPhases.prePre
            : config.matchPhases.prePre,
        stadiumName: config.stadium.name,
        stadiumCapacity: config.stadium.capacity,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error(`[analyticsRoutes.analyticsOverview] error=${err.message}`);
    res.status(500).json({ success: false, error: "Failed to fetch analytics overview" });
  }
});

// ─── GET /densityTimeline ─────────────────────────────────────────────────────

/**
 * Returns the last N density readings per zone for sparkline charts.
 * Reads from the zones/{zoneId}/history subcollection written by sensorSimulator.
 *
 * Query params:
 *   limit   {number} - Number of readings per zone (default 10, max 30)
 *   zoneId  {string} - Optional single zone ID; omit for all zones
 *
 * Response shape:
 * {
 *   zones: {
 *     [zoneId]: Array<{ density: number, isoTimestamp: string }>
 *   },
 *   timestamp: string,
 * }
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @returns {Promise<void>}
 */
exports.densityTimeline = functions.https.onRequest(async (req, res) => {
  if (handlePreflight(req, res)) return;
  setCorsHeaders(res);

  const limit = Math.min(parseInt(req.query.limit || "10", 10), 30);
  const filterZoneId = req.query.zoneId || null;

  try {
    const db = admin.firestore();
    const zoneIds = filterZoneId
      ? [filterZoneId]
      : Object.keys(config.zoneCentres);

    // Fetch history for all zones in parallel
    const historyResults = await Promise.allSettled(
      zoneIds.map(async (zoneId) => {
        const snap = await db
          .collection(config.collections.zones)
          .doc(zoneId)
          .collection("history")
          .orderBy("recordedAt", "desc")
          .limit(limit)
          .get();

        const readings = snap.docs
          .map((d) => ({
            density: d.data().density || 0,
            isoTimestamp: d.data().isoTimestamp || new Date().toISOString(),
          }))
          .reverse(); // Oldest first for charting

        return { zoneId, readings };
      })
    );

    const zones = {};
    historyResults.forEach((result) => {
      if (result.status === "fulfilled") {
        zones[result.value.zoneId] = result.value.readings;
      }
    });

    res.status(200).json({
      success: true,
      data: { zones, limit, timestamp: new Date().toISOString() },
    });
  } catch (err) {
    console.error(`[analyticsRoutes.densityTimeline] error=${err.message}`);
    res.status(500).json({ success: false, error: "Failed to fetch density timeline" });
  }
});

// ─── GET /agentActivity ───────────────────────────────────────────────────────

/**
 * Returns agent signal counts grouped by agent name for the last N minutes.
 * Shows judges how active each agent has been during the demo session.
 *
 * Query params:
 *   windowMinutes {number} - Lookback window in minutes (default 60, max 180)
 *
 * Response shape:
 * {
 *   agents: {
 *     [agentName]: { total: number, bySeverity: { low, medium, high, critical } }
 *   },
 *   totalSignals: number,
 *   windowMinutes: number,
 *   timestamp: string,
 * }
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @returns {Promise<void>}
 */
exports.agentActivity = functions.https.onRequest(async (req, res) => {
  if (handlePreflight(req, res)) return;
  setCorsHeaders(res);

  const windowMinutes = Math.min(
    parseInt(req.query.windowMinutes || "60", 10),
    180
  );

  try {
    const db = admin.firestore();
    const cutoff = minutesAgo(windowMinutes);

    const snap = await db
      .collection(config.collections.agentSignals)
      .where("timestamp", ">=", cutoff)
      .orderBy("timestamp", "desc")
      .limit(200)
      .get();

    // Group signals by agent name
    const agents = {};
    snap.docs.forEach((doc) => {
      const data = doc.data();
      const agentName = data.agentName || "unknown";
      const severity = data.severity || "low";

      if (!agents[agentName]) {
        agents[agentName] = {
          total: 0,
          bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
          recentSignalTypes: [],
        };
      }

      agents[agentName].total += 1;
      if (agents[agentName].bySeverity[severity] !== undefined) {
        agents[agentName].bySeverity[severity] += 1;
      }

      // Track last 3 signal types for the UI
      if (agents[agentName].recentSignalTypes.length < 3) {
        agents[agentName].recentSignalTypes.push(data.signalType || "unknown");
      }
    });

    res.status(200).json({
      success: true,
      data: {
        agents,
        totalSignals: snap.size,
        windowMinutes,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error(`[analyticsRoutes.agentActivity] error=${err.message}`);
    res.status(500).json({ success: false, error: "Failed to fetch agent activity" });
  }
});

// ─── GET /incidentSummary ─────────────────────────────────────────────────────

/**
 * Returns a breakdown of alert types, SOS incidents, and resolutions.
 * Used by the AnalyticsTab to show incident composition and resolution rate.
 *
 * Response shape:
 * {
 *   alertsByType: { [alertType]: number },
 *   sosStats: { total, active, resolved, avgResolutionMinutes },
 *   fraudAlerts: { total, byType: { duplicate_scan, device_rate, wrong_zone } },
 *   securityAlerts: { total, bySeverity },
 *   auditEventCounts: { [eventType]: number },
 *   timestamp: string,
 * }
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @returns {Promise<void>}
 */
exports.incidentSummary = functions.https.onRequest(async (req, res) => {
  if (handlePreflight(req, res)) return;
  setCorsHeaders(res);

  try {
    const db = admin.firestore();

    const [
      alertsSnap,
      sosSnap,
      fraudSnap,
      securitySnap,
      auditSnap,
    ] = await Promise.allSettled([
      db.collection(config.collections.alerts).limit(200).get(),
      db.collection(config.collections.sos).limit(200).get(),
      db.collection(config.collections.fraudAlerts).limit(200).get(),
      db.collection(config.collections.securityAlerts).limit(200).get(),
      db.collection(config.collections.auditLog)
        .where("timestamp", ">=", minutesAgo(120))
        .limit(300)
        .get(),
    ]);

    // ── Alerts by type ────────────────────────────────────────────────────────
    const alertsByType = {};
    if (alertsSnap.status === "fulfilled") {
      alertsSnap.value.docs.forEach((doc) => {
        const type = doc.data().type || "unknown";
        alertsByType[type] = (alertsByType[type] || 0) + 1;
      });
    }

    // ── SOS stats ─────────────────────────────────────────────────────────────
    let sosStats = { total: 0, active: 0, resolved: 0, avgResolutionMinutes: null };
    if (sosSnap.status === "fulfilled") {
      const sosDocs = sosSnap.value.docs.map((d) => ({ id: d.id, ...d.data() }));
      sosStats.total = sosDocs.length;
      sosStats.active = sosDocs.filter((s) => ["active", "responding"].includes(s.status)).length;
      sosStats.resolved = sosDocs.filter((s) => s.status === "resolved").length;

      // Calculate average resolution time for resolved SOSes
      const resolvedWithTimes = sosDocs.filter(
        (s) => s.status === "resolved" && s.createdAt && s.resolvedAt
      );
      if (resolvedWithTimes.length > 0) {
        const totalMs = resolvedWithTimes.reduce((sum, s) => {
          const created = s.createdAt.toMillis ? s.createdAt.toMillis() : 0;
          const resolved = s.resolvedAt.toMillis ? s.resolvedAt.toMillis() : 0;
          return sum + Math.max(0, resolved - created);
        }, 0);
        sosStats.avgResolutionMinutes = Math.round(
          totalMs / resolvedWithTimes.length / 60000
        );
      }
    }

    // ── Fraud alerts ──────────────────────────────────────────────────────────
    const fraudAlerts = { total: 0, byType: { duplicate_scan: 0, device_rate: 0, wrong_zone: 0 } };
    if (fraudSnap.status === "fulfilled") {
      fraudSnap.value.docs.forEach((doc) => {
        fraudAlerts.total += 1;
        const fraudType = doc.data().fraudType || "unknown";
        if (fraudAlerts.byType[fraudType] !== undefined) {
          fraudAlerts.byType[fraudType] += 1;
        }
      });
    }

    // ── Security alerts ───────────────────────────────────────────────────────
    const securityAlerts = { total: 0, bySeverity: { low: 0, medium: 0, high: 0, critical: 0 } };
    if (securitySnap.status === "fulfilled") {
      securitySnap.value.docs.forEach((doc) => {
        securityAlerts.total += 1;
        const severity = doc.data().severity || "low";
        if (securityAlerts.bySeverity[severity] !== undefined) {
          securityAlerts.bySeverity[severity] += 1;
        }
      });
    }

    // ── Audit event counts ────────────────────────────────────────────────────
    const auditEventCounts = {};
    if (auditSnap.status === "fulfilled") {
      auditSnap.value.docs.forEach((doc) => {
        const eventType = doc.data().eventType || "unknown";
        auditEventCounts[eventType] = (auditEventCounts[eventType] || 0) + 1;
      });
    }

    res.status(200).json({
      success: true,
      data: {
        alertsByType,
        sosStats,
        fraudAlerts,
        securityAlerts,
        auditEventCounts,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error(`[analyticsRoutes.incidentSummary] error=${err.message}`);
    res.status(500).json({ success: false, error: "Failed to fetch incident summary" });
  }
});