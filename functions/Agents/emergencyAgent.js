/**
 * @fileoverview Emergency Agent for CrowdCommand.
 * Triggered by Firestore onWrite on the emergency_triggers collection.
 * Calls Gemini to generate a full evacuation plan, writes it to
 * evacuation/current with status "pending_confirmation", and waits
 * for operator approval via EvacPlanModal.js before executing.
 * Human confirmation is NEVER bypassed — this is a core design invariant.
 */

const admin = require("firebase-admin");
const BaseAgent = require("./baseAgent");
const {
  getDb,
  getAllZones,
  getAllVolunteers,
  setPendingEvacuationPlan,
  updateEvacuationStatus,
  updateVolunteerStatus,
  createVolunteerTask,
  addAlert,
} = require("../services/firestoreService");
const { generateEvacuationPlan } = require("../services/geminiService");
const {
  notifyEvacuationVolunteers,
  notifyFansEmergency,
  notifySecuritySos,
} = require("../services/notificationService");
const { logEvent, EVENT_TYPES } = require("../utils/auditLogger");
const config = require("../config");

class EmergencyAgent extends BaseAgent {
  constructor() {
    super("emergencyAgent");
  }

  /**
   * Main entry point — called when an emergency_triggers document is created.
   * Gathers full stadium context, calls Gemini for an evacuation plan,
   * and writes it to Firestore awaiting operator confirmation.
   * NEVER auto-executes the plan — human approval is always required.
   *
   * @param {Object} trigger - The emergency trigger document data
   * @param {string} triggerId - Firestore document ID of the trigger
   * @returns {Promise<void>}
   */
  async onEmergencyTrigger(trigger, triggerId) {
    try {
      const [zones, matchState, volunteers] = await Promise.all([
        this.getZoneSnapshot(),
        this.getMatchContext(),
        getAllVolunteers(),
      ]);

      // Build structured context for Gemini
      const zoneDensities = {};
      zones.forEach((z) => {
        zoneDensities[z.id] = z.density || 0;
      });

      const gateStatuses = config.gates.map((g) => ({
        id: g.id,
        name: g.name,
        covered: g.covered,
        zones: g.zones,
        avgDensity:
          g.zones.reduce((sum, zId) => sum + (zoneDensities[zId] || 0), 0) /
          g.zones.length,
      }));

      const volunteerContext = volunteers.map((v) => ({
        id: v.id,
        name: v.name,
        role: v.role || "steward",
        zone: v.zone,
        status: v.status,
        lat: v.lat,
        lng: v.lng,
      }));

      const plan = await generateEvacuationPlan({
        triggerReason: trigger.reason || "manual_trigger",
        affectedZone: trigger.affectedZone || "unknown",
        matchPhase: matchState.phase,
        zoneDensities,
        gateStatuses,
        volunteers: volunteerContext,
      });

      // Attach trigger metadata to the plan before writing
      const enrichedPlan = {
        ...plan,
        triggerId,
        triggerReason: trigger.reason || "manual_trigger",
        affectedZone: trigger.affectedZone || "unknown",
        sosCount: trigger.sosCount || 0,
        matchPhase: matchState.phase,
        generatedBy: this.name,
        geminiUnavailable: plan._geminiUnavailable || false,
      };

      // Write plan with status "pending_confirmation" — never auto-execute
      await setPendingEvacuationPlan(enrichedPlan);

      // Surface alert in AlertFeed so operators see it immediately
      await addAlert({
        type: "evacuation_pending",
        severity: plan.risk_level || "critical",
        affectedZones: trigger.affectedZone ? [trigger.affectedZone] : [],
        message: `Evacuation plan ready — operator confirmation required. Reason: ${trigger.reason}`,
        reasoning: plan.reasoning,
        agentName: this.name,
        triggerId,
        status: "active",
      });

      // Emit signal to orchestrator
      await this.emitSignal(
        "evacuation_plan_ready",
        trigger.affectedZone ? [trigger.affectedZone] : [],
        plan.risk_level || "critical",
        {
          triggerId,
          triggerReason: trigger.reason,
          riskLevel: plan.risk_level,
          exitsToOpen: plan.exits_to_open,
          exitsToClose: plan.exits_to_close,
          requiresHumanConfirmation: true,
          reasoning: plan.reasoning,
        }
      );

      // Mark the trigger document as processed
      await getDb()
        .collection(config.collections.emergencyTriggers)
        .doc(triggerId)
        .update({
          processed: true,
          evacuationPlanStatus: "pending_confirmation",
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      await logEvent(
        EVENT_TYPES.EVACUATION_INITIATED,
        this.name,
        {
          triggerId,
          reason: trigger.reason,
          affectedZone: trigger.affectedZone,
          riskLevel: plan.risk_level,
          exitsToOpen: plan.exits_to_open,
          volunteerCount: Object.keys(plan.volunteer_assignments || {}).length,
        },
        `Evacuation plan generated — awaiting operator confirmation`,
        plan.reasoning
      );
    } catch (err) {
      await this.handleError("onEmergencyTrigger", err);
    }
  }

  /**
   * Executes a confirmed evacuation plan.
   * Called by sosRoutes after the operator presses Confirm in EvacPlanModal.js.
   * Sends FCM to all assigned volunteers and fans, updates gate statuses,
   * and writes the full execution record to the audit trail.
   *
   * @param {Object} plan - The confirmed evacuation plan from Firestore
   * @param {string} confirmedBy - Operator identifier
   * @returns {Promise<void>}
   */
  async executeConfirmedPlan(plan, confirmedBy) {
    try {
      // Update status to executing immediately so the dashboard reflects it
      await updateEvacuationStatus("executing", {
        confirmedBy,
        executionStartedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const volunteers = await getAllVolunteers();

      // Build volunteer assignment notifications
      const assignments = Object.entries(plan.volunteer_assignments || {}).map(
        ([volunteerId, instruction]) => {
          const volunteer = volunteers.find((v) => v.id === volunteerId);
          return {
            deviceToken: volunteer ? volunteer.deviceToken : null,
            volunteerId,
            instruction,
          };
        }
      );

      // Send volunteer notifications (fire-and-forget — failures logged internally)
      const { sent, failed } = await notifyEvacuationVolunteers(assignments);

      // Update volunteer statuses in Firestore
      await Promise.allSettled(
        Object.keys(plan.volunteer_assignments || {}).map((volunteerId) =>
          updateVolunteerStatus(volunteerId, "responding", {
            currentTask: "evacuation",
            evacuationPlanId: plan.triggerId || "unknown",
          })
        )
      );

      // Open specified exits — update gate status documents
      await Promise.allSettled(
        (plan.exits_to_open || []).map((gateId) =>
          getDb()
            .collection("gate_statuses")
            .doc(gateId)
            .set(
              {
                status: "open",
                evacuationMode: true,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            )
        )
      );

      // Close specified exits
      await Promise.allSettled(
        (plan.exits_to_close || []).map((gateId) =>
          getDb()
            .collection("gate_statuses")
            .doc(gateId)
            .set(
              {
                status: "closed",
                evacuationMode: true,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            )
        )
      );

      // Push fan-facing emergency message to all zone topics
      const allZoneTopics = Object.keys(config.zoneCentres).map(
        (zId) => `${zId}_fans`
      );
      await notifyFansEmergency(
        allZoneTopics,
        plan.fan_app_message || "Please exit calmly via the nearest gate.",
        plan.pa_announcement_script || ""
      );

      // Update LEDBoard with PA announcement script
      await getDb()
        .collection("led_messages")
        .doc("evacuation")
        .set({
          message: plan.pa_announcement_script || "EVACUATION IN PROGRESS — PLEASE EXIT CALMLY",
          type: "evacuation",
          priority: "critical",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      // Mark evacuation as executing complete
      await updateEvacuationStatus("executing", {
        volunteersSent: sent,
        volunteersFailedNotify: failed,
        exitsOpened: (plan.exits_to_open || []).length,
        exitsClosed: (plan.exits_to_close || []).length,
      });

      await logEvent(
        EVENT_TYPES.EVACUATION_CONFIRMED,
        this.name,
        {
          confirmedBy,
          exitsOpened: plan.exits_to_open,
          exitsClosed: plan.exits_to_close,
          volunteersSent: sent,
          volunteersFailedNotify: failed,
          fanMessageSent: plan.fan_app_message,
        },
        `Evacuation executing — confirmed by ${confirmedBy}. ${sent} volunteers notified.`,
        plan.reasoning
      );
    } catch (err) {
      await this.handleError("executeConfirmedPlan", err);
    }
  }

  /**
   * Records an operator rejection of the evacuation plan.
   * Writes rejection reason to Firestore and audit trail.
   * Does not execute any actions — the plan is discarded.
   *
   * @param {string} rejectedBy - Operator identifier
   * @param {string} [reason="No reason provided"] - Rejection reason
   * @returns {Promise<void>}
   */
  async rejectPlan(rejectedBy, reason = "No reason provided") {
    try {
      await updateEvacuationStatus("rejected", {
        rejectedBy,
        rejectionReason: reason,
        rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await logEvent(
        EVENT_TYPES.EVACUATION_REJECTED,
        this.name,
        { rejectedBy, reason },
        `Evacuation plan rejected by ${rejectedBy}: ${reason}`,
        ""
      );
    } catch (err) {
      await this.handleError("rejectPlan", err);
    }
  }

  /**
   * Processes an SOS event — finds nearest security volunteers,
   * calculates safe exit route, and notifies responders.
   * Called by sosRoutes immediately after the SOS document is created.
   *
   * @param {string} sosId - Firestore SOS document ID
   * @param {Object} sosData - SOS data: fanId, lat, lng, zone, exitRoute
   * @returns {Promise<{responders: Array, exitRoute: Object}>}
   */
  async dispatchSosResponse(sosId, sosData) {
    try {
      const volunteers = await getAllVolunteers();

      // Find 2 nearest available security personnel
      const security = volunteers.filter(
        (v) => v.role === "security" && v.status === "available"
      );

      const { findNearestVolunteers } = require("../utils/geoUtils");
      const responders = findNearestVolunteers(
        security,
        { lat: sosData.lat, lng: sosData.lng },
        2
      );

      // Notify security responders via FCM
      await Promise.allSettled(
        responders.map((responder) => {
          if (responder.deviceToken) {
            return notifySecuritySos(
              responder.deviceToken,
              sosId,
              sosData.lat,
              sosData.lng,
              sosData.zone || "unknown"
            );
          }
          return Promise.resolve();
        })
      );

      // Update responder statuses
      await Promise.allSettled(
        responders.map((r) =>
          updateVolunteerStatus(r.id, "responding", {
            sosId,
            respondingToZone: sosData.zone,
          })
        )
      );

      // Update SOS document with responder info
      await getDb()
        .collection(config.collections.sos)
        .doc(sosId)
        .update({
          status: "responding",
          responderIds: responders.map((r) => r.id),
          responderCount: responders.length,
          respondingAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      await logEvent(
        EVENT_TYPES.SOS_DISPATCHED,
        this.name,
        {
          sosId,
          fanId: sosData.fanId,
          zone: sosData.zone,
          responderCount: responders.length,
          responderIds: responders.map((r) => r.id),
        },
        `SOS response dispatched — ${responders.length} security personnel en route`,
        `Fan at ${sosData.zone} lat=${sosData.lat} lng=${sosData.lng}`
      );

      return { responders, exitRoute: sosData.exitRoute || null };
    } catch (err) {
      await this.handleError("dispatchSosResponse", err);
      return { responders: [], exitRoute: null };
    }
  }

  /**
   * Creates a demo SOS event for the DemoControls panel.
   * Uses a pre-seeded demo fan at the centre of zone 5.
   *
   * @returns {Promise<Object>} The SOS data object written to Firestore
   */
  async triggerDemoSos() {
    try {
      const zone5Centre = config.zoneCentres["zone_5"];

      const sosData = {
        fanId: "demo_fan_001",
        lat: zone5Centre.lat,
        lng: zone5Centre.lng,
        zone: "zone_5",
        deviceToken: null,
        isDemo: true,
        status: "active",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isoTimestamp: new Date().toISOString(),
      };

      const sosRef = await getDb()
        .collection(config.collections.sos)
        .add(sosData);

      await logEvent(
        EVENT_TYPES.SOS_RECEIVED,
        this.name,
        { sosId: sosRef.id, isDemo: true, zone: "zone_5" },
        "Demo SOS triggered from DemoControls panel",
        "Pre-seeded demo fan at zone_5 centre"
      );

      return { sosId: sosRef.id, ...sosData };
    } catch (err) {
      await this.handleError("triggerDemoSos", err);
      return null;
    }
  }
}

const emergencyAgent = new EmergencyAgent();

module.exports = { emergencyAgent, EmergencyAgent };