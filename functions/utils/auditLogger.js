/**
 * @fileoverview Immutable audit trail logger for CrowdCommand.
 * Every agent action, operator decision, SOS event, evacuation confirmation,
 * volunteer assignment, gate change, and wave release must call logEvent().
 * The audit trail is write-only from agents — no document is ever updated or deleted.
 */

const admin = require("firebase-admin");
const config = require("../config");

/**
 * Event type constants for consistent colour-coding in AuditTrail.js.
 * Maps to: blue=agent, amber=operator, red=emergency, green=resolution
 */
const EVENT_TYPES = {
  // Agent actions (blue)
  AGENT_SIGNAL: "agent_signal",
  SURGE_DETECTED: "surge_detected",
  GATE_REROUTE: "gate_reroute",
  VOLUNTEER_DISPATCH: "volunteer_dispatch",
  FRAUD_DETECTED: "fraud_detected",
  CCTV_ANOMALY: "cctv_anomaly",
  WEATHER_ALERT: "weather_alert",
  ORCHESTRATOR_ACTION: "orchestrator_action",
  WAVE_RELEASE: "wave_release",

  // Operator decisions (amber)
  EVAC_CONFIRM: "evac_confirm",
  EVAC_REJECT: "evac_reject",
  OPERATOR_OVERRIDE: "operator_override",
  MATCH_PHASE_CHANGE: "match_phase_change",
  DEMO_TRIGGER: "demo_trigger",

  // Emergency events (red)
  SOS_RAISED: "sos_raised",
  SOS_CLUSTER: "sos_cluster",
  EVAC_TRIGGERED: "evac_triggered",
  SECURITY_ALERT: "security_alert",
  EMERGENCY_DECLARED: "emergency_declared",

  // Resolutions (green)
  SOS_RESOLVED: "sos_resolved",
  EVAC_COMPLETE: "evac_complete",
  ALERT_CLEARED: "alert_cleared",
  GATE_NORMALISED: "gate_normalised",
};

/**
 * Colour category mapping used by AuditTrail.js for visual differentiation.
 */
const EVENT_COLOURS = {
  [EVENT_TYPES.AGENT_SIGNAL]: "blue",
  [EVENT_TYPES.SURGE_DETECTED]: "blue",
  [EVENT_TYPES.GATE_REROUTE]: "blue",
  [EVENT_TYPES.VOLUNTEER_DISPATCH]: "blue",
  [EVENT_TYPES.FRAUD_DETECTED]: "blue",
  [EVENT_TYPES.CCTV_ANOMALY]: "blue",
  [EVENT_TYPES.WEATHER_ALERT]: "blue",
  [EVENT_TYPES.ORCHESTRATOR_ACTION]: "blue",
  [EVENT_TYPES.WAVE_RELEASE]: "blue",
  [EVENT_TYPES.EVAC_CONFIRM]: "amber",
  [EVENT_TYPES.EVAC_REJECT]: "amber",
  [EVENT_TYPES.OPERATOR_OVERRIDE]: "amber",
  [EVENT_TYPES.MATCH_PHASE_CHANGE]: "amber",
  [EVENT_TYPES.DEMO_TRIGGER]: "amber",
  [EVENT_TYPES.SOS_RAISED]: "red",
  [EVENT_TYPES.SOS_CLUSTER]: "red",
  [EVENT_TYPES.EVAC_TRIGGERED]: "red",
  [EVENT_TYPES.SECURITY_ALERT]: "red",
  [EVENT_TYPES.EMERGENCY_DECLARED]: "red",
  [EVENT_TYPES.SOS_RESOLVED]: "green",
  [EVENT_TYPES.EVAC_COMPLETE]: "green",
  [EVENT_TYPES.ALERT_CLEARED]: "green",
  [EVENT_TYPES.GATE_NORMALISED]: "green",
};

/**
 * Writes an immutable audit log entry to Firestore.
 * This is the single function all agents and routers must call for accountability.
 * Documents are never updated — each event creates a new document.
 *
 * @param {string} eventType - One of the EVENT_TYPES constants
 * @param {string} agent - Name of the agent or system writing this entry
 * @param {Object} payload - Structured data describing what happened
 * @param {string} outcome - Human-readable summary of what was done or decided
 * @param {string} [reasoning] - AI reasoning from Gemini, if applicable
 * @returns {Promise<string>} The Firestore document ID of the audit entry
 */
async function logEvent(eventType, agent, payload, outcome, reasoning = "") {
  const db = admin.firestore();

  const entry = {
    eventType,
    agent,
    payload,
    outcome,
    reasoning,
    colour: EVENT_COLOURS[eventType] || "blue",
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    // ISO string for easy reading in the dashboard without Firestore Timestamp conversion
    isoTimestamp: new Date().toISOString(),
  };

  try {
    const docRef = await db
      .collection(config.collections.auditLog)
      .add(entry);

    return docRef.id;
  } catch (err) {
    // Audit log failure must not crash the calling agent — log to console only
    console.error(
      `[auditLogger] Failed to write audit entry. eventType=${eventType} agent=${agent} error=${err.message}`,
      { entry }
    );
    return null;
  }
}

/**
 * Convenience wrapper for logging SOS events with consistent structure.
 *
 * @param {string} sosId - Firestore SOS document ID
 * @param {string} action - "raised", "routed", "dispatched", "resolved"
 * @param {Object} details - SOS details including coordinates and fan ID
 * @returns {Promise<string>} Audit log document ID
 */
async function logSosEvent(sosId, action, details) {
  const typeMap = {
    raised: EVENT_TYPES.SOS_RAISED,
    routed: EVENT_TYPES.AGENT_SIGNAL,
    dispatched: EVENT_TYPES.VOLUNTEER_DISPATCH,
    resolved: EVENT_TYPES.SOS_RESOLVED,
  };

  return logEvent(
    typeMap[action] || EVENT_TYPES.SOS_RAISED,
    "emergencyAgent",
    { sosId, action, ...details },
    `SOS ${action}: Fan ${details.fanId || "unknown"} at zone ${details.zone || "unknown"}`,
    details.reasoning || ""
  );
}

/**
 * Convenience wrapper for logging evacuation lifecycle events.
 *
 * @param {string} phase - "triggered", "confirmed", "rejected", "complete"
 * @param {string} operator - Operator name or "system" for automated triggers
 * @param {Object} planSummary - Key details from the evacuation plan
 * @returns {Promise<string>} Audit log document ID
 */
async function logEvacEvent(phase, operator, planSummary) {
  const typeMap = {
    triggered: EVENT_TYPES.EVAC_TRIGGERED,
    confirmed: EVENT_TYPES.EVAC_CONFIRM,
    rejected: EVENT_TYPES.EVAC_REJECT,
    complete: EVENT_TYPES.EVAC_COMPLETE,
  };

  return logEvent(
    typeMap[phase] || EVENT_TYPES.EVAC_TRIGGERED,
    operator,
    planSummary,
    `Evacuation ${phase} by ${operator}`,
    planSummary.reasoning || ""
  );
}

module.exports = {
  logEvent,
  logSosEvent,
  logEvacEvent,
  EVENT_TYPES,
  EVENT_COLOURS,
};
