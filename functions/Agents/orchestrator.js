/**
 * @fileoverview Master Orchestrator Agent for CrowdCommand.
 * Listens to the agent_signals collection via Firestore onWrite trigger.
 * When a new signal arrives, it collects all signals from the last 60 seconds,
 * calls Gemini to synthesise a prioritised ActionPlan, and either executes
 * it immediately or routes it to the operator for confirmation.
 * All decisions are logged to the immutable audit trail.
 */

const admin = require("firebase-admin");
const BaseAgent = require("./baseAgent");
const {
  getDb,
  getRecentAgentSignals,
  getAllZones,
  getAllVolunteers,
  getMatchState,
  updateVolunteerStatus,
  createVolunteerTask,
  addAlert,
} = require("../services/firestoreService");
const { synthesiseActionPlan } = require("../services/geminiService");
const {
  sendToTopic,
  notifyVolunteerTask,
  notifyFansEmergency,
} = require("../services/notificationService");
const { logEvent, EVENT_TYPES } = require("../utils/auditLogger");
const { findNearestVolunteers } = require("../utils/geoUtils");
const config = require("../config");

class Orchestrator extends BaseAgent {
  constructor() {
    super("orchestrator");

    /**
     * Minimum severity level that triggers orchestrator synthesis.
     * Signals below this level are logged but not synthesised.
     * @type {Array<string>}
     */
    this.synthesisThresholds = ["medium", "high", "critical"];

    /**
     * Action types that always require human confirmation regardless of Gemini output.
     * @type {Array<string>}
     */
    this.alwaysConfirmTypes = ["evacuation"];

    /**
     * Deduplication window — ignore signals of the same type from the same agent
     * within this many milliseconds to prevent orchestrator storm.
     * @type {number}
     */
    this.dedupeWindowMs = 15 * 1000;

    /** @type {Map<string, number>} Last processed timestamp per signal key */
    this._recentSignalKeys = new Map();
  }

  /**
   * Main entry point — called by the Firestore onWrite trigger on agent_signals.
   * Deduplicates rapid-fire signals, gathers full context, calls Gemini,
   * and routes the resulting ActionPlan.
   *
   * @param {Object} signal - The newly written agent signal document
   * @param {string} signalId - Firestore document ID of the triggering signal
   * @returns {Promise<void>}
   */
  async onAgentSignal(signal, signalId) {
    try {
      // Skip low-severity signals that don't warrant orchestration
      if (!this.synthesisThresholds.includes(signal.severity)) {
        return;
      }

      // Deduplicate: skip if same agent+signalType seen within dedupeWindowMs
      const dedupeKey = `${signal.agentName}:${signal.signalType}`;
      const lastSeen = this._recentSignalKeys.get(dedupeKey);
      if (lastSeen && Date.now() - lastSeen < this.dedupeWindowMs) {
        console.log(
          `[orchestrator.onAgentSignal] Deduped signal. key=${dedupeKey} signalId=${signalId}`
        );
        return;
      }
      this._recentSignalKeys.set(dedupeKey, Date.now());

      const [recentSignals, zones, matchState, volunteers] = await Promise.all([
        getRecentAgentSignals(60),
        this.getZoneSnapshot(),
        this.getMatchContext(),
        getAllVolunteers(),
      ]);

      // Build context object for Gemini
      const zoneDensities = {};
      zones.forEach((z) => {
        zoneDensities[z.id] = z.density || 0;
      });

      const activeSosSnapshot = await getDb()
        .collection(config.collections.sos)
        .where("status", "in", ["active", "responding"])
        .get();

      const activeAlertSnapshot = await getDb()
        .collection(config.collections.alerts)
        .where("status", "==", "active")
        .get();

      const context = {
        timestamp: new Date().toISOString(),
        matchPhase: matchState.phase,
        zoneDensities,
        activeAlertCount: activeAlertSnapshot.size,
        activeSosCount: activeSosSnapshot.size,
        weatherStatus: matchState.weatherStatus || "clear",
        recentSignals: recentSignals.map((s) => ({
          agentName: s.agentName,
          signalType: s.signalType,
          severity: s.severity,
          affectedZones: s.affectedZones,
          payload: s.payload,
          isoTimestamp: s.isoTimestamp,
        })),
      };

      const actionPlan = await synthesiseActionPlan(context);

      // Write ActionPlan to Firestore actions/current for dashboard visibility
      await getDb()
        .collection(config.collections.actions)
        .doc(config.documents.actionsCurrent)
        .set({
          ...actionPlan,
          triggeringSignalId: signalId,
          triggeringAgent: signal.agentName,
          triggeringSignalType: signal.signalType,
          status: "pending",
          generatedBy: this.name,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          isoTimestamp: new Date().toISOString(),
          geminiUnavailable: actionPlan._geminiUnavailable || false,
        });

      // Route based on whether human confirmation is required
      const needsConfirmation =
        actionPlan.requiresHumanConfirmation ||
        this.alwaysConfirmTypes.includes(actionPlan.actionType);

      if (needsConfirmation) {
        await this._requestOperatorConfirmation(actionPlan, signalId, signal);
      } else {
        await this._executeActionPlan(actionPlan, signalId, volunteers, zones);
      }
    } catch (err) {
      await this.handleError("onAgentSignal", err);
    }
  }

  /**
   * Executes an ActionPlan immediately without operator confirmation.
   * Dispatches the correct handler based on actionType.
   *
   * @param {Object} actionPlan - Gemini-generated ActionPlan
   * @param {string} triggeringSignalId - Signal that triggered this plan
   * @param {Array<Object>} volunteers - All volunteer documents
   * @param {Array<Object>} zones - All zone documents
   * @returns {Promise<void>}
   * @private
   */
  async _executeActionPlan(actionPlan, triggeringSignalId, volunteers, zones) {
    try {
      switch (actionPlan.actionType) {
        case "gate_reroute":
          await this._executeGateReroute(actionPlan, volunteers);
          break;

        case "volunteer_dispatch":
          await this._executeVolunteerDispatch(actionPlan, volunteers, zones);
          break;

        case "fan_notification":
          await this._executeFanNotification(actionPlan);
          break;

        case "weather_reroute":
          await this._executeWeatherReroute(actionPlan);
          break;

        case "monitor_only":
          // No direct action — signal is logged and visible in dashboard
          break;

        case "evacuation":
          // Evacuation always requires human confirmation — should not reach here
          // but guard defensively
          await this._requestOperatorConfirmation(actionPlan, triggeringSignalId, {});
          return;

        default:
          console.warn(
            `[orchestrator._executeActionPlan] Unknown actionType=${actionPlan.actionType}`
          );
      }

      // Mark plan as executed
      await getDb()
        .collection(config.collections.actions)
        .doc(config.documents.actionsCurrent)
        .update({
          status: "executed",
          executedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      await logEvent(
        EVENT_TYPES.ORCHESTRATOR_ACTION,
        this.name,
        {
          actionType: actionPlan.actionType,
          priority: actionPlan.priority,
          targetZones: actionPlan.targetZones,
          triggeringSignalId,
        },
        `Orchestrator executed: ${actionPlan.actionType} (priority ${actionPlan.priority})`,
        actionPlan.rationale
      );
    } catch (err) {
      console.error(
        `[orchestrator._executeActionPlan] actionType=${actionPlan.actionType} error=${err.message}`
      );
    }
  }

  /**
   * Writes the ActionPlan to evacuation/current as pending_confirmation
   * so EvacPlanModal.js surfaces it to the operator for approval.
   *
   * @param {Object} actionPlan - ActionPlan requiring confirmation
   * @param {string} triggeringSignalId - Signal that triggered this plan
   * @param {Object} signal - Original triggering signal document
   * @returns {Promise<void>}
   * @private
   */
  async _requestOperatorConfirmation(actionPlan, triggeringSignalId, signal) {
    try {
      await getDb()
        .collection(config.collections.evacuation)
        .doc(config.documents.evacuationCurrent)
        .set(
          {
            ...actionPlan,
            status: "pending_confirmation",
            source: "orchestrator",
            triggeringSignalId,
            triggeringAgent: signal.agentName || "unknown",
            requestedAt: admin.firestore.FieldValue.serverTimestamp(),
            isoTimestamp: new Date().toISOString(),
          },
          { merge: false }
        );

      await addAlert({
        type: "operator_confirmation_required",
        severity: actionPlan.priority >= 4 ? "critical" : "high",
        affectedZones: actionPlan.targetZones || [],
        message: `Operator confirmation required: ${actionPlan.actionType}. ${actionPlan.messageToStaff}`,
        reasoning: actionPlan.rationale,
        agentName: this.name,
        status: "active",
      });

      await logEvent(
        EVENT_TYPES.ORCHESTRATOR_ACTION,
        this.name,
        {
          actionType: actionPlan.actionType,
          priority: actionPlan.priority,
          targetZones: actionPlan.targetZones,
          triggeringSignalId,
          requiresConfirmation: true,
        },
        `Orchestrator requesting operator confirmation for: ${actionPlan.actionType}`,
        actionPlan.rationale
      );
    } catch (err) {
      console.error(
        `[orchestrator._requestOperatorConfirmation] error=${err.message}`,
        { actionPlan }
      );
    }
  }

  /**
   * Executes a gate reroute action — sends fan notifications via FCM topic
   * and updates the LEDBoard document.
   *
   * @param {Object} actionPlan - ActionPlan with targetZones and messageToFans
   * @param {Array<Object>} volunteers - All volunteer documents
   * @returns {Promise<void>}
   * @private
   */
  async _executeGateReroute(actionPlan, volunteers) {
    try {
      // Notify fans in affected zones via topic
      await Promise.allSettled(
        (actionPlan.targetZones || []).map((zoneId) =>
          sendToTopic(
            `${zoneId}_fans`,
            {
              title: "Gate change",
              body: actionPlan.messageToFans || "Please use an alternate gate.",
              data: {
                type: "gate_change",
                screen: "my_gate",
                zones: (actionPlan.targetZones || []).join(","),
              },
            },
            this.name
          )
        )
      );

      // Update LED board for affected zones
      await Promise.allSettled(
        (actionPlan.targetZones || []).map((zoneId) =>
          getDb()
            .collection("led_messages")
            .doc(zoneId)
            .set({
              message: actionPlan.messageToFans || "Please use an alternate gate",
              type: "gate_reroute",
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            })
        )
      );
    } catch (err) {
      console.error(
        `[orchestrator._executeGateReroute] error=${err.message}`
      );
    }
  }

  /**
   * Executes a volunteer dispatch action — finds nearest available volunteers
   * and sends them task notifications.
   *
   * @param {Object} actionPlan - ActionPlan with targetZones and messageToStaff
   * @param {Array<Object>} volunteers - All volunteer documents
   * @param {Array<Object>} zones - All zone documents
   * @returns {Promise<void>}
   * @private
   */
  async _executeVolunteerDispatch(actionPlan, volunteers, zones) {
    try {
      const available = volunteers.filter((v) => v.status === "available");

      for (const zoneId of actionPlan.targetZones || []) {
        const zoneCentre = config.zoneCentres[zoneId];
        if (!zoneCentre) continue;

        const nearest = findNearestVolunteers(available, zoneCentre, 2);

        await Promise.allSettled(
          nearest.map(async (volunteer) => {
            const instructions =
              actionPlan.messageToStaff ||
              `Report to ${zoneId.replace("_", " ")} — orchestrator dispatch.`;

            const taskId = await createVolunteerTask({
              volunteerId: volunteer.id,
              taskType: "orchestrator_dispatch",
              zone: zoneId,
              instructions,
              priority: actionPlan.priority >= 4 ? "critical" : "high",
              assignedBy: this.name,
              actionType: actionPlan.actionType,
            });

            await updateVolunteerStatus(volunteer.id, "assigned", {
              currentTask: taskId,
              assignedZone: zoneId,
            });

            if (volunteer.deviceToken) {
              await notifyVolunteerTask(
                volunteer.deviceToken,
                taskId,
                "orchestrator_dispatch",
                zoneId,
                instructions
              );
            }
          })
        );
      }
    } catch (err) {
      console.error(
        `[orchestrator._executeVolunteerDispatch] error=${err.message}`
      );
    }
  }

  /**
   * Executes a fan_notification action — sends the orchestrator message
   * to all fans in targeted zones via FCM topics.
   *
   * @param {Object} actionPlan - ActionPlan with targetZones and messageToFans
   * @returns {Promise<void>}
   * @private
   */
  async _executeFanNotification(actionPlan) {
    try {
      await Promise.allSettled(
        (actionPlan.targetZones || []).map((zoneId) =>
          sendToTopic(
            `${zoneId}_fans`,
            {
              title: "Stadium update",
              body: actionPlan.messageToFans || "Please follow staff instructions.",
              data: {
                type: "orchestrator_notification",
                screen: "home",
              },
            },
            this.name
          )
        )
      );
    } catch (err) {
      console.error(
        `[orchestrator._executeFanNotification] error=${err.message}`
      );
    }
  }

  /**
   * Executes a weather_reroute action — directs fans in open-air zones
   * to covered areas and updates the ExitGuide via Firestore.
   *
   * @param {Object} actionPlan - ActionPlan with targetZones and messageToFans
   * @returns {Promise<void>}
   * @private
   */
  async _executeWeatherReroute(actionPlan) {
    try {
      const openAirZones = config.gates
        .filter((g) => !g.covered)
        .flatMap((g) => g.zones);

      const coveredZones = config.gates
        .filter((g) => g.covered)
        .flatMap((g) => g.zones);

      // Notify fans in open-air zones
      await Promise.allSettled(
        openAirZones.map((zoneId) =>
          sendToTopic(
            `${zoneId}_fans`,
            {
              title: "⛈️ Please seek shelter",
              body: actionPlan.messageToFans || "Please move to a covered area.",
              data: {
                type: "weather_reroute",
                rerouteToZones: coveredZones.join(","),
                screen: "exit_guide",
              },
            },
            this.name
          )
        )
      );

      // Update zone documents with shelter routing
      await Promise.allSettled(
        openAirZones.map((zoneId) =>
          getDb()
            .collection(config.collections.zones)
            .doc(zoneId)
            .update({
              weatherReroute: true,
              rerouteToZones: coveredZones,
              weatherMessage: actionPlan.messageToFans,
              lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            })
        )
      );
    } catch (err) {
      console.error(
        `[orchestrator._executeWeatherReroute] error=${err.message}`
      );
    }
  }
}

const orchestrator = new Orchestrator();

module.exports = { orchestrator, Orchestrator };