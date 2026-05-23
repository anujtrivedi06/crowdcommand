/**
 * @fileoverview Security Agent for CrowdCommand.
 * Runs as a Firebase Scheduled Function every 30 seconds.
 * Calls visionService to score all 12 CCTV zones, raises security alerts
 * when anomaly scores exceed the configured threshold, and calls Gemini
 * to assess severity and recommend response actions.
 */

const admin = require("firebase-admin");
const BaseAgent = require("./baseAgent");
const {
  getDb,
  getAllZones,
  getAllVolunteers,
  addAlert,
} = require("../services/firestoreService");
const { scoreCCTVFrame } = require("../services/visionService");
const { assessCctvAnomaly } = require("../services/geminiService");
const { logEvent, EVENT_TYPES } = require("../utils/auditLogger");
const config = require("../config");

class SecurityAgent extends BaseAgent {
  constructor() {
    super("securityAgent");
  }

  /**
   * Main entry point — called by the Scheduled Function every 30 seconds.
   * Scores all 12 CCTV zones concurrently and processes any anomalies found.
   *
   * @returns {Promise<void>}
   */
  async runCctvScan() {
    try {
      const [zones, matchState, volunteers] = await Promise.all([
        this.getZoneSnapshot(),
        this.getMatchContext(),
        getAllVolunteers(),
      ]);

      if (!zones || zones.length === 0) return;

      // Score all zones concurrently — mock or real Vision AI per USE_MOCK_VISION flag
      const scanResults = await Promise.allSettled(
        zones.map((zone) => this._scanZone(zone, matchState, volunteers))
      );

      const alertsRaised = scanResults.filter(
        (r) => r.status === "fulfilled" && r.value === true
      ).length;

      if (alertsRaised > 0) {
        console.log(
          `[securityAgent.runCctvScan] Scan complete — ${alertsRaised} alert(s) raised across ${zones.length} zones.`
        );
      }
    } catch (err) {
      await this.handleError("runCctvScan", err);
    }
  }

  /**
   * Scores a single zone's CCTV feed and processes the result.
   * Writes a security alert and calls Gemini if score exceeds threshold.
   *
   * @param {Object} zone - Zone document from Firestore
   * @param {Object} matchState - Current match state
   * @param {Array<Object>} volunteers - All volunteer documents
   * @returns {Promise<boolean>} True if an alert was raised for this zone
   * @private
   */
  async _scanZone(zone, matchState, volunteers) {
    try {
      const cctvResult = await scoreCCTVFrame(zone.id);

      // Only process results that exceed the anomaly threshold
      if (cctvResult.score < config.thresholds.cctvAnomalyScore) {
        return false;
      }

      // Count volunteers available in this zone for Gemini context
      const volunteersInZone = volunteers.filter(
        (v) => v.zone === zone.id && v.status === "available"
      ).length;

      // Call Gemini to assess severity and recommend response
      const assessment = await assessCctvAnomaly({
        zoneId: zone.id,
        anomalyLabel: cctvResult.label,
        score: cctvResult.score,
        density: zone.density || 0,
        volunteersInZone,
        matchPhase: matchState.phase,
      });

      // Write to security_alerts collection
      const alertRef = await getDb()
        .collection(config.collections.securityAlerts)
        .add({
          zoneId: zone.id,
          anomalyLabel: cctvResult.label,
          cctvScore: cctvResult.score,
          severity: assessment.severity,
          recommendedResponse: assessment.recommended_response,
          escalateToOrchestrator: assessment.escalate_to_orchestrator,
          reasoning: assessment.reasoning,
          agentName: this.name,
          matchPhase: matchState.phase,
          zoneDensity: zone.density || 0,
          status: "active",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          isoTimestamp: new Date().toISOString(),
          geminiUnavailable: assessment._geminiUnavailable || false,
        });

      // Mirror to general alerts collection so AlertFeed.js shows it as a red alert
      await addAlert({
        type: "security_alert",
        subType: cctvResult.label,
        severity: assessment.severity,
        affectedZones: [zone.id],
        message: `CCTV anomaly in ${zone.id.replace("_", " ")}: ${cctvResult.label} (score: ${cctvResult.score.toFixed(2)})`,
        recommendedResponse: assessment.recommended_response,
        reasoning: assessment.reasoning,
        agentName: this.name,
        securityAlertId: alertRef.id,
        status: "active",
      });

      // Escalate to orchestrator via agent signal if Gemini recommends it
      if (assessment.escalate_to_orchestrator) {
        await this.emitSignal(
          "cctv_anomaly",
          [zone.id],
          assessment.severity,
          {
            anomalyLabel: cctvResult.label,
            cctvScore: cctvResult.score,
            recommendedResponse: assessment.recommended_response,
            reasoning: assessment.reasoning,
            securityAlertId: alertRef.id,
          }
        );
      }

      await logEvent(
        EVENT_TYPES.SECURITY_ALERT,
        this.name,
        {
          zoneId: zone.id,
          label: cctvResult.label,
          score: cctvResult.score,
          severity: assessment.severity,
          securityAlertId: alertRef.id,
        },
        `CCTV alert: ${cctvResult.label} in ${zone.id} — ${assessment.severity} severity`,
        assessment.reasoning
      );

      return true;
    } catch (err) {
      console.error(
        `[securityAgent._scanZone] zoneId=${zone.id} error=${err.message}`
      );
      return false;
    }
  }

  /**
   * Writes a direct security alert triggered by the DemoControls panel.
   * Bypasses the scheduled CCTV scan and writes a high-score anomaly for zone 7.
   *
   * @param {string} [zoneId="zone_7"] - Zone to trigger the alert in
   * @param {string} [label="aggression"] - Anomaly label to simulate
   * @param {number} [score=0.91] - Vision AI confidence score to simulate
   * @returns {Promise<string|null>} Security alert document ID or null on failure
   */
  async triggerDemoAlert(zoneId = "zone_7", label = "aggression", score = 0.91) {
    try {
      const [zones, matchState, volunteers] = await Promise.all([
        this.getZoneSnapshot(),
        this.getMatchContext(),
        getAllVolunteers(),
      ]);

      const zone = zones.find((z) => z.id === zoneId) || {
        id: zoneId,
        density: 72,
      };
      const volunteersInZone = volunteers.filter(
        (v) => v.zone === zoneId && v.status === "available"
      ).length;

      const assessment = await assessCctvAnomaly({
        zoneId,
        anomalyLabel: label,
        score,
        density: zone.density || 72,
        volunteersInZone,
        matchPhase: matchState.phase,
      });

      const alertRef = await getDb()
        .collection(config.collections.securityAlerts)
        .add({
          zoneId,
          anomalyLabel: label,
          cctvScore: score,
          severity: assessment.severity,
          recommendedResponse: assessment.recommended_response,
          escalateToOrchestrator: true,
          reasoning: assessment.reasoning,
          agentName: this.name,
          matchPhase: matchState.phase,
          zoneDensity: zone.density || 72,
          status: "active",
          isDemo: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          isoTimestamp: new Date().toISOString(),
        });

      await addAlert({
        type: "security_alert",
        subType: label,
        severity: assessment.severity,
        affectedZones: [zoneId],
        message: `[DEMO] CCTV anomaly in ${zoneId.replace("_", " ")}: ${label} (score: ${score.toFixed(2)})`,
        recommendedResponse: assessment.recommended_response,
        reasoning: assessment.reasoning,
        agentName: this.name,
        securityAlertId: alertRef.id,
        isDemo: true,
        status: "active",
      });

      await this.emitSignal("cctv_anomaly", [zoneId], assessment.severity, {
        anomalyLabel: label,
        cctvScore: score,
        recommendedResponse: assessment.recommended_response,
        reasoning: assessment.reasoning,
        securityAlertId: alertRef.id,
        isDemo: true,
      });

      await logEvent(
        EVENT_TYPES.SECURITY_ALERT,
        this.name,
        { zoneId, label, score, severity: assessment.severity, isDemo: true },
        `[DEMO] Security alert triggered manually in ${zoneId}`,
        assessment.reasoning
      );

      return alertRef.id;
    } catch (err) {
      await this.handleError("triggerDemoAlert", err);
      return null;
    }
  }
}

const securityAgent = new SecurityAgent();

module.exports = { securityAgent, SecurityAgent };