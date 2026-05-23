/**
 * @fileoverview SOS cluster detection for CrowdCommand.
 * Called by the scheduled clusterDetector Cloud Function every minute.
 * If 3+ active SOSes are within 50m of each other within a 2-minute window,
 * an emergency_trigger document is written to Firestore, which activates
 * the evacuation protocol via emergencyAgent.
 *
 * Threshold values are sourced from config.js and documented in README section 8.
 */

const admin = require("firebase-admin");
const config = require("../config");
const { clusterByProximity, calculateCentroid, getZoneForCoordinate } =
  require("./geoUtils");
const { logEvent, EVENT_TYPES } = require("./auditLogger");

/**
 * @typedef {Object} SosDocument
 * @property {string} id - Firestore document ID
 * @property {string} fanId - Fan identifier
 * @property {number} lat - Fan latitude at time of SOS
 * @property {number} lng - Fan longitude at time of SOS
 * @property {string} status - "active" | "resolved" | "responding"
 * @property {FirebaseFirestore.Timestamp} createdAt - When the SOS was raised
 */

/**
 * @typedef {Object} ClusterResult
 * @property {boolean} clusterFound - Whether a qualifying cluster was detected
 * @property {string|null} triggerId - Firestore ID of the emergency_trigger written, or null
 * @property {Array<Object>} clusters - All clusters found (including sub-threshold ones)
 * @property {number} activeSosCount - Total active SOS count in the time window
 */

/**
 * Runs the full SOS cluster detection pipeline.
 * Queries Firestore for recent active SOSes, groups them by proximity,
 * and writes emergency triggers for any clusters meeting the threshold.
 *
 * @returns {Promise<ClusterResult>} Detection results for logging
 */
async function detectSosClusters() {
  const db = admin.firestore();

  const windowMs =
    config.thresholds.sosClusterWindowMinutes * 60 * 1000;
  const cutoff = new Date(Date.now() - windowMs);

  // Query active SOSes within the time window
  let activeSosDocuments;
  try {
    const snapshot = await db
      .collection(config.collections.sos)
      .where("status", "==", "active")
      .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(cutoff))
      .get();

    activeSosDocuments = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  } catch (err) {
    console.error(
      `[clusterDetector] Failed to query active SOSes: ${err.message}`
    );
    return { clusterFound: false, triggerId: null, clusters: [], activeSosCount: 0 };
  }

  if (activeSosDocuments.length < config.thresholds.sosCluster) {
    // Not enough SOSes to form a cluster — exit early
    return {
      clusterFound: false,
      triggerId: null,
      clusters: [],
      activeSosCount: activeSosDocuments.length,
    };
  }

  // Build point array for clustering — filter out SOSes without coordinates
  const points = activeSosDocuments
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({ lat: s.lat, lng: s.lng, sosId: s.id, fanId: s.fanId }));

  if (points.length === 0) {
    return {
      clusterFound: false,
      triggerId: null,
      clusters: [],
      activeSosCount: activeSosDocuments.length,
    };
  }

  // Group by proximity using the configured radius
  const clusters = clusterByProximity(
    points,
    config.thresholds.sosClusterRadiusMetres
  );

  // Find clusters that meet or exceed the threshold
  const alarmingClusters = clusters.filter(
    (c) => c.length >= config.thresholds.sosCluster
  );

  if (alarmingClusters.length === 0) {
    return {
      clusterFound: false,
      triggerId: null,
      clusters,
      activeSosCount: activeSosDocuments.length,
    };
  }

  // Take the largest cluster as the primary threat
  const primaryCluster = alarmingClusters.sort(
    (a, b) => b.length - a.length
  )[0];

  const centroid = calculateCentroid(primaryCluster);
  const affectedZone = getZoneForCoordinate(centroid.lat, centroid.lng);

  // Write the emergency trigger — this will activate emergencyAgent via onWrite
  const trigger = {
    reason: "sos_cluster",
    affectedZone: affectedZone || "unknown",
    sosCount: primaryCluster.length,
    clusterCentroid: centroid,
    sosIds: primaryCluster.map((p) => p.sosId),
    allActiveSosCount: activeSosDocuments.length,
    detectedAt: admin.firestore.FieldValue.serverTimestamp(),
    status: "pending",
    config: {
      threshold: config.thresholds.sosCluster,
      windowMinutes: config.thresholds.sosClusterWindowMinutes,
      radiusMetres: config.thresholds.sosClusterRadiusMetres,
    },
  };

  let triggerId = null;
  try {
    const triggerRef = await db
      .collection(config.collections.emergencyTriggers)
      .add(trigger);

    triggerId = triggerRef.id;

    console.log(
      `[clusterDetector] SOS cluster detected: ${primaryCluster.length} SOSes in zone ${affectedZone}. Trigger ID: ${triggerId}`
    );
  } catch (err) {
    console.error(
      `[clusterDetector] Failed to write emergency trigger. cluster=${JSON.stringify(centroid)} error=${err.message}`,
      { trigger }
    );
  }

  // Log to audit trail
  await logEvent(
    EVENT_TYPES.SOS_CLUSTER,
    "clusterDetector",
    {
      triggerId,
      affectedZone,
      sosCount: primaryCluster.length,
      centroid,
      sosIds: primaryCluster.map((p) => p.sosId),
    },
    `SOS cluster detected: ${primaryCluster.length} incidents in ${affectedZone} within ${config.thresholds.sosClusterRadiusMetres}m radius`
  );

  return {
    clusterFound: true,
    triggerId,
    clusters,
    activeSosCount: activeSosDocuments.length,
  };
}

/**
 * Checks a single new SOS against existing active SOSes to determine
 * if it immediately forms part of a cluster. Used for instant response
 * in addition to the scheduled check.
 *
 * @param {number} newLat - Latitude of the newly raised SOS
 * @param {number} newLng - Longitude of the newly raised SOS
 * @param {string} newSosId - Firestore ID of the new SOS document
 * @returns {Promise<{isPartOfCluster: boolean, nearbyCount: number}>}
 */
async function checkImmediateCluster(newLat, newLng, newSosId) {
  const db = admin.firestore();

  const windowMs = config.thresholds.sosClusterWindowMinutes * 60 * 1000;
  const cutoff = new Date(Date.now() - windowMs);

  try {
    const snapshot = await db
      .collection(config.collections.sos)
      .where("status", "==", "active")
      .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(cutoff))
      .get();

    // Count SOSes within the cluster radius, excluding the new one itself
    const nearby = snapshot.docs.filter((doc) => {
      if (doc.id === newSosId) return false;
      const data = doc.data();
      if (data.lat == null || data.lng == null) return false;

      const dist = require("./geoUtils").haversineDistance(
        newLat,
        newLng,
        data.lat,
        data.lng
      );
      return dist <= config.thresholds.sosClusterRadiusMetres;
    });

    return {
      isPartOfCluster: nearby.length + 1 >= config.thresholds.sosCluster,
      nearbyCount: nearby.length + 1, // Include the new SOS in the count
    };
  } catch (err) {
    console.error(
      `[clusterDetector] Immediate cluster check failed: ${err.message}`
    );
    return { isPartOfCluster: false, nearbyCount: 1 };
  }
}

module.exports = {
  detectSosClusters,
  checkImmediateCluster,
};
