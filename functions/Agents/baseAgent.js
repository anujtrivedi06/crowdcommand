/**
 * @fileoverview Base agent class for all CrowdCommand agents.
 * Provides shared lifecycle methods, signal writing, and audit logging.
 * All agents extend this class and call super() methods for consistency.
 */

const { addAgentSignal } = require("../services/firestoreService");
const { logEvent, EVENT_TYPES } = require("../utils/auditLogger");
const { getMatchState, getAllZones } = require("../services/firestoreService");

/**
 * @typedef {Object} AgentSignal
 * @property {string} agentName - Name of the emitting agent
 * @property {string} signalType - Type of signal (e.g. "surge_detected", "weather_alert")
 * @property {Array<string>} affectedZones - Zone IDs affected by this signal
 * @property {string} severity - "low" | "medium" | "high" | "critical"
 * @property {Object} payload - Structured data payload from the agent
 */

class BaseAgent {
  /**
   * @param {string} name - Agent name used in logs and Firestore signals
   */
  constructor(name) {
    this.name = name;
  }

  /**
   * Emits a structured signal to the agent_signals Firestore collection.
   * The orchestrator listens to this collection to coordinate responses.
   *
   * @param {string} signalType - Signal type identifier
   * @param {Array<string>} affectedZones - Zone IDs affected
   * @param {string} severity - "low" | "medium" | "high" | "critical"
   * @param {Object} payload - Structured payload data
   * @returns {Promise<string|null>} Signal document ID or null on failure
   */
  async emitSignal(signalType, affectedZones, severity, payload) {
    const signal = {
      agentName: this.name,
      signalType,
      affectedZones,
      severity,
      payload,
    };

    const signalId = await addAgentSignal(signal);

    await logEvent(
      EVENT_TYPES.AGENT_SIGNAL,
      this.name,
      { signalId, signalType, affectedZones, severity },
      `${this.name} emitted signal: ${signalType} (${severity})`,
      payload.reasoning || ""
    );

    return signalId;
  }

  /**
   * Reads the current match state from Firestore.
   * Agents use this to contextualise their reasoning (pre-match density is normal;
   * the same density post-match may indicate a crush forming).
   *
   * @returns {Promise<Object>} Match state document with phase field
   */
  async getMatchContext() {
    return getMatchState();
  }

  /**
   * Reads all zone documents for full stadium situational awareness.
   *
   * @returns {Promise<Array<Object>>} Array of zone data objects
   */
  async getZoneSnapshot() {
    return getAllZones();
  }

  /**
   * Logs an agent action to the immutable audit trail.
   * Convenience wrapper so agents don't need to import auditLogger directly.
   *
   * @param {string} eventType - EVENT_TYPES constant
   * @param {Object} payload - Action data
   * @param {string} outcome - Human-readable outcome description
   * @param {string} [reasoning] - AI reasoning string from Gemini
   * @returns {Promise<string|null>} Audit log document ID
   */
  async audit(eventType, payload, outcome, reasoning = "") {
    return logEvent(eventType, this.name, payload, outcome, reasoning);
  }

  /**
   * Standardised error handler for agent run methods.
   * Logs the error and emits a low-severity signal so the orchestrator
   * is aware the agent encountered a problem without crashing the function.
   *
   * @param {string} method - Method name where the error occurred
   * @param {Error} err - The caught error
   * @returns {Promise<void>}
   */
  async handleError(method, err) {
    console.error(`[${this.name}.${method}] Unhandled error: ${err.message}`, err);

    await logEvent(
      EVENT_TYPES.AGENT_SIGNAL,
      this.name,
      { method, error: err.message },
      `${this.name} encountered an error in ${method} — manual check recommended`,
      ""
    ).catch(() => {
      // If audit logging also fails, just log to console
      console.error(`[${this.name}] Audit log also failed during error handling`);
    });
  }
}

module.exports = BaseAgent;
