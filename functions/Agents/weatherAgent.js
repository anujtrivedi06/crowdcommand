/**
 * @fileoverview Weather Agent for CrowdCommand.
 * Triggered by Firestore onWrite on the weather_events collection.
 * Assesses weather risk via Gemini, identifies fans in open-air zones,
 * and emits a rerouting signal to the orchestrator when risk is medium or above.
 * Also updates the WeatherWidget state document for dashboard display.
 */

const admin = require("firebase-admin");
const BaseAgent = require("./baseAgent");
const {
  getDb,
  getAllZones,
  addAlert,
} = require("../services/firestoreService");
const { assessWeatherRisk } = require("../services/geminiService");
const { sendToTopic } = require("../services/notificationService");
const { logEvent, EVENT_TYPES } = require("../utils/auditLogger");
const config = require("../config");

class WeatherAgent extends BaseAgent {
  constructor() {
    super("weatherAgent");

    /**
     * Risk levels that trigger rerouting action.
     * "low" is logged but no reroute is issued.
     * @type {Array<string>}
     */
    this.rerouteThresholdLevels = ["medium", "high", "critical"];
  }

  /**
   * Main entry point — called when a weather_events document is created or updated.
   * Collects zone data, calls Gemini for risk assessment, and routes the response.
   *
   * @param {Object} weatherEvent - The Firestore weather event document data
   * @param {string} eventId - Firestore document ID of the weather event
   * @returns {Promise<void>}
   */
  async onWeatherEvent(weatherEvent, eventId) {
    try {
      const [zones, matchState] = await Promise.all([
        this.getZoneSnapshot(),
        this.getMatchContext(),
      ]);

      const zoneDensities = {};
      zones.forEach((z) => {
        zoneDensities[z.id] = z.density || 0;
      });

      // Identify covered vs open-air zones from gate config
      const coveredZones = config.gates
        .filter((g) => g.covered)
        .flatMap((g) => g.zones);

      const openAirZones = config.gates
        .filter((g) => !g.covered)
        .flatMap((g) => g.zones);

      // Estimate fan count in open zones by density (density = % of zone capacity ~2900 fans/zone)
      const zoneCapacity = Math.floor(config.stadium.capacity / config.stadium.zones);
      const fansInOpenZones = openAirZones.reduce((sum, zId) => {
        return sum + Math.floor(((zoneDensities[zId] || 0) / 100) * zoneCapacity);
      }, 0);

      const assessment = await assessWeatherRisk({
        eventType: weatherEvent.type || "rain",
        severity: weatherEvent.severity || "moderate",
        zoneDensities,
        coveredZones,
        openAirZones,
        matchPhase: matchState.phase,
        fansInOpenZones,
      });

      // Always update the WeatherWidget state document regardless of risk level
      await this._updateWeatherWidgetState(weatherEvent, assessment);

      // Write to alerts collection for AlertFeed display
      await addAlert({
        type: "weather_alert",
        subType: weatherEvent.type || "rain",
        severity: assessment.risk_level,
        affectedZones: assessment.affected_zones || openAirZones,
        message: assessment.fan_message,
        staffMessage: assessment.staff_message,
        reasoning: assessment.reasoning,
        rerouteToZones: assessment.reroute_to_zones,
        agentName: this.name,
        weatherEventId: eventId,
        status: "active",
      });

      // Mark the weather event as processed
      await getDb()
        .collection(config.collections.weatherEvents)
        .doc(eventId)
        .update({
          processed: true,
          riskLevel: assessment.risk_level,
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      // Only emit reroute signal if risk is medium or above
      if (this.rerouteThresholdLevels.includes(assessment.risk_level)) {
        await this._executeReroute(assessment, weatherEvent, matchState);
      } else {
        // Log low-risk event without rerouting
        await logEvent(
          EVENT_TYPES.AGENT_ACTION,
          this.name,
          { eventId, riskLevel: assessment.risk_level, eventType: weatherEvent.type },
          `Weather event assessed as ${assessment.risk_level} risk — no reroute required`,
          assessment.reasoning
        );
      }
    } catch (err) {
      await this.handleError("onWeatherEvent", err);
    }
  }

  /**
   * Executes the fan rerouting response for medium-or-above weather risk.
   * Sends FCM push notifications to fans in affected open-air zones,
   * updates zone documents with shelter routing info,
   * and emits a weather_reroute signal to the orchestrator.
   *
   * @param {Object} assessment - Gemini weather risk assessment result
   * @param {Object} weatherEvent - Original weather event document
   * @param {Object} matchState - Current match state
   * @returns {Promise<void>}
   * @private
   */
  async _executeReroute(assessment, weatherEvent, matchState) {
    try {
      const affectedZones = assessment.affected_zones || [];
      const rerouteToZones = assessment.reroute_to_zones || [];

      // Notify fans in open-air zones to move to shelter
      await Promise.allSettled(
        affectedZones.map((zoneId) =>
          sendToTopic(
            `${zoneId}_fans`,
            {
              title: "⛈️ Weather alert — please seek shelter",
              body: assessment.fan_message,
              data: {
                type: "weather_reroute",
                rerouteToZones: rerouteToZones.join(","),
                weatherType: weatherEvent.type || "rain",
                screen: "exit_guide",
              },
            },
            this.name
          )
        )
      );

      // Update affected zone documents with shelter routing info
      await Promise.allSettled(
        affectedZones.map((zoneId) =>
          getDb()
            .collection(config.collections.zones)
            .doc(zoneId)
            .update({
              weatherReroute: true,
              rerouteToZones,
              weatherMessage: assessment.fan_message,
              lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            })
        )
      );

      // Update LEDBoard with weather message for affected zones
      await Promise.allSettled(
        affectedZones.map((zoneId) =>
          getDb()
            .collection("led_messages")
            .doc(zoneId)
            .set({
              message: assessment.fan_message,
              type: "weather_alert",
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            })
        )
      );

      // Emit signal to orchestrator for coordinated multi-agent response
      await this.emitSignal(
        "weather_reroute",
        affectedZones,
        assessment.risk_level,
        {
          weatherType: weatherEvent.type || "rain",
          severity: weatherEvent.severity || "moderate",
          rerouteToZones,
          fanMessage: assessment.fan_message,
          staffMessage: assessment.staff_message,
          reasoning: assessment.reasoning,
        }
      );

      await logEvent(
        EVENT_TYPES.AGENT_ACTION,
        this.name,
        {
          weatherType: weatherEvent.type,
          riskLevel: assessment.risk_level,
          affectedZones,
          rerouteToZones,
          fansNotified: affectedZones.length,
        },
        `Weather reroute executed — ${affectedZones.length} zone(s) affected, fans directed to shelter`,
        assessment.reasoning
      );
    } catch (err) {
      console.error(
        `[weatherAgent._executeReroute] error=${err.message}`
      );
    }
  }

  /**
   * Writes or updates the WeatherWidget singleton document in Firestore.
   * The dashboard WeatherWidget.js listens to this document via onSnapshot.
   *
   * @param {Object} weatherEvent - Original weather event
   * @param {Object} assessment - Gemini assessment result
   * @returns {Promise<void>}
   * @private
   */
  async _updateWeatherWidgetState(weatherEvent, assessment) {
    try {
      await getDb()
        .collection(config.collections.config)
        .doc("weatherState")
        .set(
          {
            currentEvent: weatherEvent.type || "clear",
            severity: weatherEvent.severity || "none",
            riskLevel: assessment.risk_level,
            fanMessage: assessment.fan_message,
            staffMessage: assessment.staff_message,
            reasoning: assessment.reasoning,
            affectedZones: assessment.affected_zones || [],
            rerouteToZones: assessment.reroute_to_zones || [],
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            isoTimestamp: new Date().toISOString(),
          },
          { merge: true }
        );
    } catch (err) {
      console.error(
        `[weatherAgent._updateWeatherWidgetState] error=${err.message}`,
        { weatherEvent, assessment }
      );
    }
  }

  /**
   * Writes a demo weather event directly to weather_events.
   * Called by the DemoControls "Trigger weather alert" button via dashboardRoutes.
   * The onWrite trigger on weather_events will then invoke onWeatherEvent normally.
   *
   * @param {string} [type="rain"] - Weather event type
   * @param {string} [severity="moderate"] - Event severity
   * @returns {Promise<string|null>} New weather event document ID or null on failure
   */
  async triggerDemoWeatherEvent(type = "rain", severity = "moderate") {
    try {
      const ref = await getDb()
        .collection(config.collections.weatherEvents)
        .add({
          type,
          severity,
          source: "demo_controls",
          isDemo: true,
          processed: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          isoTimestamp: new Date().toISOString(),
        });

      await logEvent(
        EVENT_TYPES.AGENT_ACTION,
        this.name,
        { type, severity, eventId: ref.id, isDemo: true },
        `Demo weather event triggered: ${type} (${severity})`,
        "Manual demo trigger from DemoControls panel"
      );

      return ref.id;
    } catch (err) {
      console.error(
        `[weatherAgent.triggerDemoWeatherEvent] type=${type} error=${err.message}`
      );
      return null;
    }
  }
}

const weatherAgent = new WeatherAgent();

module.exports = { weatherAgent, WeatherAgent };