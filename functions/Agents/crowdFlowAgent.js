/**
 * @fileoverview Crowd Flow Agent for CrowdCommand.
 * Triggered by Firestore onWrite on the zones collection.
 * Reads the last 5 density readings per zone, calculates rate of change,
 * calls Gemini for surge prediction when thresholds are exceeded,
 * dispatches volunteers to choke points, and triggers gate rerouting.
 */

const admin = require("firebase-admin");
const BaseAgent = require("./baseAgent");
const {
  getDb,
  getZoneHistory,
  getAllZones,
  addAlert,
  getAllVolunteers,
  updateVolunteerStatus,
  createVolunteerTask,
} = require("../services/firestoreService");
const { predictSurge } = require("../services/geminiService");
const {
  notifyGateChange,
  notifyVolunteerTask,
} = require("../services/notificationService");
const { findNearestVolunteers } = require("../utils/geoUtils");
const { logEvent, EVENT_TYPES } = require("../utils/auditLogger");
const config = require("../config");

class CrowdFlowAgent extends BaseAgent {
  constructor() {
    super("crowdFlowAgent");
  }

  /**
   * Main entry point — called when any zone document is written.
   * Reads history for all zones, computes rates of change, and
   * triggers surge prediction if any zone exceeds the configured threshold.
   *
   * @param {string} changedZoneId - The zone ID that triggered the onWrite
   * @returns {Promise<void>}
   */
  async onZoneUpdate(changedZoneId) {
    try {
      const [zones, matchState] = await Promise.all([
        this.getZoneSnapshot(),
        this.getMatchContext(),
      ]);

      if (!zones || zones.length === 0) return;

      // Build density map and compute rates of change across all zones
      const zoneDensities = {};
      const ratesOfChange = {};
      const surgingZones = [];

      await Promise.all(
        zones.map(async (zone) => {
          zoneDensities[zone.id] = zone.density || 0;
          const history = await getZoneHistory(zone.id, 5);

          if (history.length >= 2) {
            // Rate = change between newest and oldest reading in the window
            const newest = history[0].density;
            const oldest = history[history.length - 1].density;
            const rate = (newest - oldest) / (history.length - 1);
            ratesOfChange[zone.id] = parseFloat(rate.toFixed(2));

            if (rate >= config.thresholds.surgeRate) {
              surgingZones.push(zone.id);
            }
          } else {
            ratesOfChange[zone.id] = 0;
          }
        })
      );

      // Check for gates exceeding capacity threshold
      const overCapacityZones = zones.filter(
        (z) => (z.density || 0) >= config.thresholds.gateCapacity
      );

      // Run surge prediction if any zone is surging
      if (surgingZones.length > 0) {
        await this._runSurgePrediction(
          zoneDensities,
          ratesOfChange,
          surgingZones,
          matchState,
          zones
        );
      }

      // Reroute gates that are over capacity
      for (const zone of overCapacityZones) {
        await this._triggerGateReroute(zone, zones);
      }
    } catch (err) {
      await this.handleError("onZoneUpdate", err);
    }
  }

  /**
   * Calls Gemini for surge prediction, writes an alert, dispatches volunteers,
   * and emits an agent signal for the orchestrator.
   *
   * @param {Object} zoneDensities - Map of zoneId -> current density
   * @param {Object} ratesOfChange - Map of zoneId -> density rate of change
   * @param {Array<string>} surgingZones - Zone IDs with rate >= threshold
   * @param {Object} matchState - Current match state document
   * @param {Array<Object>} zones - All zone documents
   * @returns {Promise<void>}
   * @private
   */
  async _runSurgePrediction(
    zoneDensities,
    ratesOfChange,
    surgingZones,
    matchState,
    zones
  ) {
    try {
      const volunteers = await getAllVolunteers();
      const volunteersPerZone = this._countVolunteersPerZone(volunteers);

      const prediction = await predictSurge({
        zoneDensities,
        ratesOfChange,
        matchPhase: matchState.phase,
        weatherStatus: matchState.weatherStatus || "clear",
        volunteersPerZone,
        activeAlertCount: surgingZones.length,
      });

      const alertId = await addAlert({
        type: "surge_prediction",
        severity: prediction.risk_level,
        affectedZones: prediction.affected_zones || surgingZones,
        estimatedMinutesToCritical: prediction.estimated_minutes_to_critical,
        recommendedActions: prediction.recommended_actions,
        riskLevel: prediction.risk_level,
        reasoning: prediction.reasoning,
        agentName: this.name,
        geminiUnavailable: prediction._geminiUnavailable || false,
      });

      await this.emitSignal(
        "surge_detected",
        prediction.affected_zones || surgingZones,
        prediction.risk_level,
        {
          alertId,
          estimatedMinutesToCritical: prediction.estimated_minutes_to_critical,
          recommendedActions: prediction.recommended_actions,
          reasoning: prediction.reasoning,
        }
      );

      // Auto-dispatch volunteers to surging zones
      for (const zoneId of surgingZones) {
        await this._dispatchVolunteersToZone(zoneId, volunteers, zones);
      }
    } catch (err) {
      console.error(
        `[crowdFlowAgent._runSurgePrediction] error=${err.message}`
      );
    }
  }

  /**
   * Finds the 3 nearest available volunteers to a surging zone and dispatches them.
   *
   * @param {string} zoneId - Zone ID requiring volunteers
   * @param {Array<Object>} allVolunteers - All volunteer documents
   * @param {Array<Object>} zones - All zone documents
   * @returns {Promise<void>}
   * @private
   */
  async _dispatchVolunteersToZone(zoneId, allVolunteers, zones) {
    try {
      const zoneCentre = config.zoneCentres[zoneId];
      if (!zoneCentre) return;

      const available = allVolunteers.filter(
        (v) => v.status === "available" && v.role !== "security"
      );

      const nearest = findNearestVolunteers(available, zoneCentre, 3);
      if (nearest.length === 0) return;

      await Promise.all(
        nearest.map(async (volunteer) => {
          const instructions = `Report to ${zoneId.replace("_", " ")} immediately — crowd surge detected. Assist with fan flow management.`;

          const taskId = await createVolunteerTask({
            volunteerId: volunteer.id,
            taskType: "crowd_management",
            zone: zoneId,
            instructions,
            priority: "high",
            assignedBy: this.name,
          });

          await updateVolunteerStatus(volunteer.id, "assigned", {
            currentTask: taskId,
            assignedZone: zoneId,
          });

          if (volunteer.deviceToken) {
            await notifyVolunteerTask(
              volunteer.deviceToken,
              taskId,
              "crowd_management",
              zoneId,
              instructions
            );
          }

          await logEvent(
            EVENT_TYPES.VOLUNTEER_ASSIGNED,
            this.name,
            { volunteerId: volunteer.id, taskId, zoneId },
            `Volunteer ${volunteer.name} dispatched to ${zoneId}`,
            "Surge response dispatch"
          );
        })
      );
    } catch (err) {
      console.error(
        `[crowdFlowAgent._dispatchVolunteersToZone] zoneId=${zoneId} error=${err.message}`
      );
    }
  }

  /**
   * Triggers gate rerouting when a zone exceeds capacity.
   * Finds an alternate gate with lower density, updates Firestore,
   * and notifies fans assigned to the congested gate.
   *
   * @param {Object} overCapacityZone - Zone document that is over capacity
   * @param {Array<Object>} allZones - All zone documents for alternate selection
   * @returns {Promise<void>}
   * @private
   */
  async _triggerGateReroute(overCapacityZone, allZones) {
    try {
      // Find the gate serving this zone
      const congested = config.gates.find((g) =>
        g.zones.includes(overCapacityZone.id)
      );
      if (!congested) return;

      // Find an alternate gate with density below 60%
      const alternate = config.gates.find((g) => {
        if (g.id === congested.id) return false;
        const avgDensity =
          g.zones.reduce((sum, zId) => {
            const z = allZones.find((az) => az.id === zId);
            return sum + (z ? z.density || 0 : 0);
          }, 0) / g.zones.length;
        return avgDensity < 60;
      });

      if (!alternate) return;

      // Write rerouting action to Firestore
      await getDb()
        .collection(config.collections.actions)
        .add({
          type: "gate_reroute",
          fromGate: congested.id,
          toGate: alternate.id,
          fromGateName: congested.name,
          toGateName: alternate.name,
          affectedZone: overCapacityZone.id,
          agentName: this.name,
          status: "active",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          isoTimestamp: new Date().toISOString(),
        });

      // Update the overcapacity zone's gate status in Firestore
      await getDb()
        .collection(config.collections.zones)
        .doc(overCapacityZone.id)
        .update({
          gateStatus: "rerouted",
          alternateGateId: alternate.id,
          alternateGateName: alternate.name,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });

      // Notify fans on the congested gate's FCM topic
      const { notifyGateChange: notifyTopic } = require("../services/notificationService");
      const { sendToTopic } = require("../services/notificationService");
      await sendToTopic(
        `gate_${congested.id}_fans`,
        {
          title: "Gate change",
          body: `Please use ${alternate.name} — ${congested.name} is now at capacity.`,
          data: {
            type: "gate_change",
            newGateId: alternate.id,
            newGateName: alternate.name,
            screen: "my_gate",
          },
        },
        this.name
      );

      // Update LEDBoard signal via Firestore
      await getDb()
        .collection("led_messages")
        .doc(congested.id)
        .set({
          message: `${congested.name} FULL — Use ${alternate.name}`,
          type: "gate_reroute",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      await this.emitSignal(
        "gate_rerouted",
        [overCapacityZone.id],
        "medium",
        {
          fromGate: congested.id,
          toGate: alternate.id,
          reasoning: `${congested.name} at ${overCapacityZone.density}% capacity — rerouting to ${alternate.name}.`,
        }
      );

      await logEvent(
        EVENT_TYPES.GATE_REROUTED,
        this.name,
        {
          fromGate: congested.id,
          toGate: alternate.id,
          zone: overCapacityZone.id,
          density: overCapacityZone.density,
        },
        `Gate reroute: ${congested.name} → ${alternate.name}`,
        `Density threshold ${config.thresholds.gateCapacity}% exceeded`
      );
    } catch (err) {
      console.error(
        `[crowdFlowAgent._triggerGateReroute] zoneId=${overCapacityZone.id} error=${err.message}`
      );
    }
  }

  /**
   * Builds a map of zone ID to volunteer count for Gemini context.
   *
   * @param {Array<Object>} volunteers - All volunteer documents
   * @returns {Object} Map of zoneId -> volunteer count
   * @private
   */
  _countVolunteersPerZone(volunteers) {
    return volunteers.reduce((acc, v) => {
      if (v.zone) {
        acc[v.zone] = (acc[v.zone] || 0) + 1;
      }
      return acc;
    }, {});
  }
}

const crowdFlowAgent = new CrowdFlowAgent();

module.exports = { crowdFlowAgent, CrowdFlowAgent };