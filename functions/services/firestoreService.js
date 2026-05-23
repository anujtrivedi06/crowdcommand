/**
 * @fileoverview Firestore read/write helper service for CrowdCommand.
 * All agents and routers use these helpers rather than calling the Firestore
 * SDK directly. This centralises error handling, logging, and collection
 * name resolution from config.js.
 */

const admin = require("firebase-admin");
const config = require("../config");

/**
 * Returns the Firestore db instance, initialising firebase-admin if needed.
 * Safe to call multiple times — admin.initializeApp is idempotent.
 * @returns {FirebaseFirestore.Firestore}
 */
function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  return admin.firestore();
}

// ─── Zone helpers ────────────────────────────────────────────────────────────

/**
 * Reads a single zone document by zone ID.
 *
 * @param {string} zoneId - e.g. "zone_3"
 * @returns {Promise<Object|null>} Zone data or null if not found
 */
async function getZone(zoneId) {
  try {
    const doc = await getDb().collection(config.collections.zones).doc(zoneId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  } catch (err) {
    console.error(`[firestoreService.getZone] zoneId=${zoneId} error=${err.message}`);
    return null;
  }
}

/**
 * Reads all 12 zone documents as an array.
 *
 * @returns {Promise<Array<Object>>} Array of zone data objects
 */
async function getAllZones() {
  try {
    const snapshot = await getDb().collection(config.collections.zones).get();
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error(`[firestoreService.getAllZones] error=${err.message}`);
    return [];
  }
}

/**
 * Writes or merges a zone document. Creates the document if it doesn't exist.
 *
 * @param {string} zoneId - Zone ID to write
 * @param {Object} data - Zone fields to set/merge
 * @param {boolean} [merge=true] - Whether to merge with existing data
 * @returns {Promise<boolean>} True on success
 */
async function setZone(zoneId, data, merge = true) {
  try {
    await getDb()
      .collection(config.collections.zones)
      .doc(zoneId)
      .set({ ...data, lastUpdated: admin.firestore.FieldValue.serverTimestamp() }, { merge });
    return true;
  } catch (err) {
    console.error(
      `[firestoreService.setZone] zoneId=${zoneId} error=${err.message}`,
      { data }
    );
    return false;
  }
}

/**
 * Appends a density reading to a zone's history subcollection.
 * Used by the sensor simulator and crowdFlowAgent for rate-of-change analysis.
 *
 * @param {string} zoneId - Zone ID
 * @param {number} density - Density value (0-100)
 * @returns {Promise<string|null>} New history document ID or null on failure
 */
async function appendZoneHistory(zoneId, density) {
  try {
    const ref = await getDb()
      .collection(config.collections.zones)
      .doc(zoneId)
      .collection("history")
      .add({
        density,
        recordedAt: admin.firestore.FieldValue.serverTimestamp(),
        isoTimestamp: new Date().toISOString(),
      });
    return ref.id;
  } catch (err) {
    console.error(
      `[firestoreService.appendZoneHistory] zoneId=${zoneId} density=${density} error=${err.message}`
    );
    return null;
  }
}

/**
 * Reads the last N density readings from a zone's history subcollection.
 *
 * @param {string} zoneId - Zone ID
 * @param {number} [limit=5] - Number of recent readings to return
 * @returns {Promise<Array<Object>>} Array of history documents, newest first
 */
async function getZoneHistory(zoneId, limit = 5) {
  try {
    const snapshot = await getDb()
      .collection(config.collections.zones)
      .doc(zoneId)
      .collection("history")
      .orderBy("recordedAt", "desc")
      .limit(limit)
      .get();
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error(
      `[firestoreService.getZoneHistory] zoneId=${zoneId} error=${err.message}`
    );
    return [];
  }
}

// ─── Alert helpers ───────────────────────────────────────────────────────────

/**
 * Writes a new alert document to the alerts collection.
 *
 * @param {Object} alert - Alert data including type, severity, zones, message, reasoning
 * @returns {Promise<string|null>} New alert document ID or null on failure
 */
async function addAlert(alert) {
  try {
    const ref = await getDb()
      .collection(config.collections.alerts)
      .add({
        ...alert,
        status: alert.status || "active",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isoTimestamp: new Date().toISOString(),
      });
    return ref.id;
  } catch (err) {
    console.error(
      `[firestoreService.addAlert] type=${alert.type} error=${err.message}`,
      { alert }
    );
    return null;
  }
}

/**
 * Clears all active alerts (used by DemoControls reset).
 *
 * @returns {Promise<number>} Number of alerts cleared
 */
async function clearAllAlerts() {
  try {
    const snapshot = await getDb()
      .collection(config.collections.alerts)
      .where("status", "==", "active")
      .get();

    const batch = getDb().batch();
    snapshot.docs.forEach((d) => batch.update(d.ref, { status: "cleared" }));
    await batch.commit();
    return snapshot.size;
  } catch (err) {
    console.error(`[firestoreService.clearAllAlerts] error=${err.message}`);
    return 0;
  }
}

// ─── Agent signal helpers ────────────────────────────────────────────────────

/**
 * Writes a structured agent signal to the agent_signals collection.
 * The orchestrator listens to this collection to coordinate multi-agent responses.
 *
 * @param {Object} signal - Signal data: agentName, signalType, affectedZones, severity, payload
 * @returns {Promise<string|null>} New signal document ID or null on failure
 */
async function addAgentSignal(signal) {
  try {
    const ref = await getDb()
      .collection(config.collections.agentSignals)
      .add({
        ...signal,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        isoTimestamp: new Date().toISOString(),
      });
    return ref.id;
  } catch (err) {
    console.error(
      `[firestoreService.addAgentSignal] agent=${signal.agentName} type=${signal.signalType} error=${err.message}`,
      { signal }
    );
    return null;
  }
}

/**
 * Reads all agent signals from the last N seconds.
 * Used by the orchestrator to synthesise a recent-context window.
 *
 * @param {number} [windowSeconds=60] - How far back to look
 * @returns {Promise<Array<Object>>} Array of recent signal documents
 */
async function getRecentAgentSignals(windowSeconds = 60) {
  try {
    const cutoff = new Date(Date.now() - windowSeconds * 1000);
    const snapshot = await getDb()
      .collection(config.collections.agentSignals)
      .where("timestamp", ">=", admin.firestore.Timestamp.fromDate(cutoff))
      .orderBy("timestamp", "desc")
      .get();
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error(
      `[firestoreService.getRecentAgentSignals] windowSeconds=${windowSeconds} error=${err.message}`
    );
    return [];
  }
}

// ─── SOS helpers ─────────────────────────────────────────────────────────────

/**
 * Creates a new SOS document.
 *
 * @param {Object} sosData - SOS data: fanId, lat, lng, zone, deviceToken
 * @returns {Promise<string|null>} New SOS document ID or null on failure
 */
async function createSos(sosData) {
  try {
    const ref = await getDb()
      .collection(config.collections.sos)
      .add({
        ...sosData,
        status: "active",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isoTimestamp: new Date().toISOString(),
      });
    return ref.id;
  } catch (err) {
    console.error(
      `[firestoreService.createSos] fanId=${sosData.fanId} error=${err.message}`,
      { sosData }
    );
    return null;
  }
}

/**
 * Updates the status of an existing SOS document.
 *
 * @param {string} sosId - Firestore SOS document ID
 * @param {string} status - New status: "active" | "responding" | "resolved"
 * @param {Object} [extra={}] - Additional fields to merge (e.g. resolvedAt, responderId)
 * @returns {Promise<boolean>} True on success
 */
async function updateSosStatus(sosId, status, extra = {}) {
  try {
    await getDb()
      .collection(config.collections.sos)
      .doc(sosId)
      .update({ status, ...extra, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return true;
  } catch (err) {
    console.error(
      `[firestoreService.updateSosStatus] sosId=${sosId} status=${status} error=${err.message}`
    );
    return false;
  }
}

/**
 * Reads all active SOS documents.
 *
 * @returns {Promise<Array<Object>>} Array of active SOS documents
 */
async function getActiveSos() {
  try {
    const snapshot = await getDb()
      .collection(config.collections.sos)
      .where("status", "in", ["active", "responding"])
      .get();
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error(`[firestoreService.getActiveSos] error=${err.message}`);
    return [];
  }
}

// ─── Volunteer helpers ───────────────────────────────────────────────────────

/**
 * Reads all volunteer documents.
 *
 * @returns {Promise<Array<Object>>} Array of volunteer data objects
 */
async function getAllVolunteers() {
  try {
    const snapshot = await getDb().collection(config.collections.volunteers).get();
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error(`[firestoreService.getAllVolunteers] error=${err.message}`);
    return [];
  }
}

/**
 * Updates a volunteer's status and location.
 *
 * @param {string} volunteerId - Firestore volunteer document ID
 * @param {string} status - New status: "available" | "assigned" | "responding"
 * @param {Object} [extra={}] - Additional fields to merge (e.g. currentTask)
 * @returns {Promise<boolean>} True on success
 */
async function updateVolunteerStatus(volunteerId, status, extra = {}) {
  try {
    await getDb()
      .collection(config.collections.volunteers)
      .doc(volunteerId)
      .update({ status, ...extra, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return true;
  } catch (err) {
    console.error(
      `[firestoreService.updateVolunteerStatus] volunteerId=${volunteerId} status=${status} error=${err.message}`
    );
    return false;
  }
}

/**
 * Creates a task document in volunteer_tasks and links it to the volunteer.
 *
 * @param {Object} task - Task data: volunteerId, taskType, zone, instructions, priority
 * @returns {Promise<string|null>} New task document ID or null on failure
 */
async function createVolunteerTask(task) {
  try {
    const ref = await getDb()
      .collection(config.collections.volunteerTasks)
      .add({
        ...task,
        status: "assigned",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isoTimestamp: new Date().toISOString(),
      });
    return ref.id;
  } catch (err) {
    console.error(
      `[firestoreService.createVolunteerTask] volunteerId=${task.volunteerId} error=${err.message}`,
      { task }
    );
    return null;
  }
}

// ─── Match state helpers ─────────────────────────────────────────────────────

/**
 * Reads the current match state document.
 *
 * @returns {Promise<Object>} Match state data with defaults if not found
 */
async function getMatchState() {
  try {
    const doc = await getDb()
      .collection(config.collections.config)
      .doc(config.documents.matchState)
      .get();

    if (!doc.exists) {
      return { phase: config.matchPhases.prePre, startedAt: null };
    }
    return doc.data();
  } catch (err) {
    console.error(`[firestoreService.getMatchState] error=${err.message}`);
    return { phase: config.matchPhases.prePre, startedAt: null };
  }
}

/**
 * Updates the match state document.
 *
 * @param {string} phase - New match phase (use config.matchPhases constants)
 * @param {Object} [extra={}] - Additional fields to merge
 * @returns {Promise<boolean>} True on success
 */
async function setMatchState(phase, extra = {}) {
  try {
    await getDb()
      .collection(config.collections.config)
      .doc(config.documents.matchState)
      .set({ phase, ...extra, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return true;
  } catch (err) {
    console.error(
      `[firestoreService.setMatchState] phase=${phase} error=${err.message}`
    );
    return false;
  }
}

// ─── Evacuation helpers ──────────────────────────────────────────────────────

/**
 * Writes a pending evacuation plan to Firestore.
 * Status is always "pending_confirmation" — never auto-executes.
 *
 * @param {Object} plan - Evacuation plan from Gemini
 * @returns {Promise<boolean>} True on success
 */
async function setPendingEvacuationPlan(plan) {
  try {
    await getDb()
      .collection(config.collections.evacuation)
      .doc(config.documents.evacuationCurrent)
      .set({
        ...plan,
        status: "pending_confirmation",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isoTimestamp: new Date().toISOString(),
      });
    return true;
  } catch (err) {
    console.error(
      `[firestoreService.setPendingEvacuationPlan] error=${err.message}`,
      { plan }
    );
    return false;
  }
}

/**
 * Updates the evacuation plan status (confirmed / rejected / executing / complete).
 *
 * @param {string} status - New status
 * @param {Object} [extra={}] - Additional fields (e.g. confirmedBy, rejectionReason)
 * @returns {Promise<boolean>} True on success
 */
async function updateEvacuationStatus(status, extra = {}) {
  try {
    await getDb()
      .collection(config.collections.evacuation)
      .doc(config.documents.evacuationCurrent)
      .update({ status, ...extra, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return true;
  } catch (err) {
    console.error(
      `[firestoreService.updateEvacuationStatus] status=${status} error=${err.message}`
    );
    return false;
  }
}

// ─── Demo / reset helpers ────────────────────────────────────────────────────

/**
 * Resets all zone densities to pre-match baseline values (15–35%).
 * Called by the DemoControls "Reset demo" button via dashboardRoutes.
 *
 * @returns {Promise<boolean>} True on success
 */
async function resetZonesToBaseline() {
  try {
    const batch = getDb().batch();
    const zoneIds = Object.keys(config.zoneCentres);

    zoneIds.forEach((zoneId, i) => {
      const ref = getDb().collection(config.collections.zones).doc(zoneId);
      // Stagger baseline densities slightly for realism
      const baseDensity = 15 + (i % 4) * 5;
      batch.set(ref, {
        density: baseDensity,
        trend: "stable",
        gateStatus: "open",
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        isoTimestamp: new Date().toISOString(),
      }, { merge: true });
    });

    await batch.commit();
    return true;
  } catch (err) {
    console.error(`[firestoreService.resetZonesToBaseline] error=${err.message}`);
    return false;
  }
}

/**
 * Clears all active SOS documents (sets status to "resolved").
 *
 * @returns {Promise<number>} Number of SOSes cleared
 */
async function clearActiveSos() {
  try {
    const snapshot = await getDb()
      .collection(config.collections.sos)
      .where("status", "in", ["active", "responding"])
      .get();

    const batch = getDb().batch();
    snapshot.docs.forEach((d) =>
      batch.update(d.ref, {
        status: "resolved",
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        resolvedBy: "demo_reset",
      })
    );
    await batch.commit();
    return snapshot.size;
  } catch (err) {
    console.error(`[firestoreService.clearActiveSos] error=${err.message}`);
    return 0;
  }
}

/**
 * Clears all fraud alerts.
 *
 * @returns {Promise<number>} Number of fraud alerts cleared
 */
async function clearFraudAlerts() {
  try {
    const snapshot = await getDb()
      .collection(config.collections.fraudAlerts)
      .where("status", "==", "active")
      .get();

    const batch = getDb().batch();
    snapshot.docs.forEach((d) => batch.update(d.ref, { status: "cleared" }));
    await batch.commit();
    return snapshot.size;
  } catch (err) {
    console.error(`[firestoreService.clearFraudAlerts] error=${err.message}`);
    return 0;
  }
}

module.exports = {
  getDb,
  // Zone
  getZone,
  getAllZones,
  setZone,
  appendZoneHistory,
  getZoneHistory,
  // Alerts
  addAlert,
  clearAllAlerts,
  // Agent signals
  addAgentSignal,
  getRecentAgentSignals,
  // SOS
  createSos,
  updateSosStatus,
  getActiveSos,
  // Volunteers
  getAllVolunteers,
  updateVolunteerStatus,
  createVolunteerTask,
  // Match state
  getMatchState,
  setMatchState,
  // Evacuation
  setPendingEvacuationPlan,
  updateEvacuationStatus,
  // Demo reset
  resetZonesToBaseline,
  clearActiveSos,
  clearFraudAlerts,
};
