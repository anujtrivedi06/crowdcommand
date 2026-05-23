/**
 * @fileoverview Ticketing Agent for CrowdCommand.
 * Monitors gate scan events for duplicate QR codes, rapid-fire device scans,
 * and zone mismatch fraud. Triggered by Firestore onWrite on gate_scans.
 * All fraud flags are written to fraud_alerts and surfaced in AlertFeed.js.
 */

const admin = require("firebase-admin");
const BaseAgent = require("./baseAgent");
const {
  getDb,
  addAlert,
  getAllVolunteers,
} = require("../services/firestoreService");
const { logEvent, EVENT_TYPES } = require("../utils/auditLogger");
const config = require("../config");

class TicketingAgent extends BaseAgent {
  constructor() {
    super("ticketingAgent");

    /** @type {number} Max scans per device within the rolling window */
    this.maxScansPerDevice = 5;

    /** @type {number} Rolling window in milliseconds for device scan rate check */
    this.deviceWindowMs = 60 * 1000;
  }

  /**
   * Main entry point — called by the Firestore onWrite Cloud Function trigger
   * on the gate_scans collection. Runs all three fraud checks against the new scan.
   *
   * @param {Object} scanData - The new gate scan document data
   * @param {string} scanId - Firestore document ID of the scan
   * @returns {Promise<void>}
   */
  async processScan(scanData, scanId) {
    try {
      const [duplicateFlag, rapidFireFlag, zoneMismatchFlag] = await Promise.all([
        this._checkDuplicateQr(scanData, scanId),
        this._checkRapidFireDevice(scanData, scanId),
        this._checkZoneMismatch(scanData, scanId),
      ]);

      const anyFraud = duplicateFlag || rapidFireFlag || zoneMismatchFlag;

      if (anyFraud) {
        await this.emitSignal(
          "fraud_detected",
          [scanData.zone || "unknown"],
          "medium",
          {
            scanId,
            qrCode: scanData.qrCode,
            gate: scanData.gate,
            deviceId: scanData.deviceId,
            duplicateQr: duplicateFlag,
            rapidFire: rapidFireFlag,
            zoneMismatch: zoneMismatchFlag,
            reasoning: "One or more fraud indicators detected on gate scan.",
          }
        );
      }
    } catch (err) {
      await this.handleError("processScan", err);
    }
  }

  /**
   * Checks whether the same QR code has already been scanned at any gate.
   * A legitimate QR code appears exactly once in gate_scans.
   *
   * @param {Object} scanData - The triggering scan document
   * @param {string} scanId - Document ID of the triggering scan (excluded from count)
   * @returns {Promise<boolean>} True if a duplicate was found
   * @private
   */
  async _checkDuplicateQr(scanData, scanId) {
    if (!scanData.qrCode) return false;

    try {
      const snapshot = await getDb()
        .collection(config.collections.gateScans)
        .where("qrCode", "==", scanData.qrCode)
        .get();

      // Exclude the triggering document itself
      const duplicates = snapshot.docs.filter((d) => d.id !== scanId);

      if (duplicates.length > 0) {
        await this._writeFraudAlert({
          type: "duplicate_qr",
          scanId,
          gate: scanData.gate,
          zone: scanData.zone,
          qrCode: scanData.qrCode,
          duplicateCount: duplicates.length,
          message: `QR code scanned ${duplicates.length + 1} times — possible ticket cloning at ${scanData.gate}.`,
        });
        return true;
      }

      return false;
    } catch (err) {
      console.error(
        `[ticketingAgent._checkDuplicateQr] scanId=${scanId} error=${err.message}`
      );
      return false;
    }
  }

  /**
   * Checks whether the same deviceId has triggered more than 5 scans
   * within the last 60 seconds — indicating a scanning device being exploited.
   *
   * @param {Object} scanData - The triggering scan document
   * @param {string} scanId - Document ID of the triggering scan
   * @returns {Promise<boolean>} True if rapid-fire behaviour detected
   * @private
   */
  async _checkRapidFireDevice(scanData, scanId) {
    if (!scanData.deviceId) return false;

    try {
      const windowStart = admin.firestore.Timestamp.fromMillis(
        Date.now() - this.deviceWindowMs
      );

      const snapshot = await getDb()
        .collection(config.collections.gateScans)
        .where("deviceId", "==", scanData.deviceId)
        .where("scannedAt", ">=", windowStart)
        .get();

      if (snapshot.size > this.maxScansPerDevice) {
        await this._writeFraudAlert({
          type: "rapid_fire_device",
          scanId,
          gate: scanData.gate,
          zone: scanData.zone,
          deviceId: scanData.deviceId,
          scanCount: snapshot.size,
          message: `Device ${scanData.deviceId} scanned ${snapshot.size} tickets in 60 seconds at ${scanData.gate}.`,
        });
        return true;
      }

      return false;
    } catch (err) {
      console.error(
        `[ticketingAgent._checkRapidFireDevice] scanId=${scanId} error=${err.message}`
      );
      return false;
    }
  }

  /**
   * Checks whether the fan scanned at a gate that doesn't match their assigned zone.
   * Fans have an assignedZone field on their scan document.
   *
   * @param {Object} scanData - The triggering scan document
   * @param {string} scanId - Document ID of the triggering scan
   * @returns {Promise<boolean>} True if zone mismatch detected
   * @private
   */
  async _checkZoneMismatch(scanData, scanId) {
    if (!scanData.assignedZone || !scanData.zone) return false;

    try {
      if (scanData.zone !== scanData.assignedZone) {
        await this._writeFraudAlert({
          type: "zone_mismatch",
          scanId,
          gate: scanData.gate,
          zone: scanData.zone,
          assignedZone: scanData.assignedZone,
          fanId: scanData.fanId,
          message: `Fan ${scanData.fanId} scanned at ${scanData.zone} but ticket is assigned to ${scanData.assignedZone}.`,
        });
        return true;
      }

      return false;
    } catch (err) {
      console.error(
        `[ticketingAgent._checkZoneMismatch] scanId=${scanId} error=${err.message}`
      );
      return false;
    }
  }

  /**
   * Writes a fraud alert document to the fraud_alerts collection
   * and mirrors it to alerts so AlertFeed.js shows it as an amber alert.
   *
   * @param {Object} fraudData - Fraud details including type, gate, message
   * @returns {Promise<void>}
   * @private
   */
  async _writeFraudAlert(fraudData) {
    try {
      await getDb()
        .collection(config.collections.fraudAlerts)
        .add({
          ...fraudData,
          status: "active",
          agentName: this.name,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          isoTimestamp: new Date().toISOString(),
        });

      await addAlert({
        type: "fraud_alert",
        subType: fraudData.type,
        severity: "medium",
        gate: fraudData.gate,
        zone: fraudData.zone,
        message: fraudData.message,
        agentName: this.name,
        status: "active",
      });

      await logEvent(
        EVENT_TYPES.AGENT_ACTION,
        this.name,
        fraudData,
        `Fraud detected: ${fraudData.type} at ${fraudData.gate}`,
        fraudData.message
      );
    } catch (err) {
      console.error(
        `[ticketingAgent._writeFraudAlert] type=${fraudData.type} error=${err.message}`,
        { fraudData }
      );
    }
  }
}

// Singleton instance — Cloud Functions share the module between invocations
const ticketingAgent = new TicketingAgent();

module.exports = { ticketingAgent, TicketingAgent };