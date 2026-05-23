/**
 * @fileoverview Firebase Cloud Messaging (FCM) notification service for CrowdCommand.
 * Handles push notifications to fans (gate changes, wave exit instructions)
 * and volunteers (task dispatch, SOS response assignments).
 * All sends are fire-and-forget with error logging — a failed push never blocks agent logic.
 */

const admin = require("firebase-admin");
const config = require("../config");

/**
 * @typedef {Object} NotificationPayload
 * @property {string} title - Notification title
 * @property {string} body - Notification body text
 * @property {Object} [data] - Key-value data payload for app handling
 * @property {string} [imageUrl] - Optional notification image URL
 */

/**
 * Sends a push notification to a single FCM device token.
 *
 * @param {string} deviceToken - FCM registration token for the target device
 * @param {NotificationPayload} payload - Notification content
 * @param {string} [callerName="unknown"] - Calling agent name for error logging
 * @returns {Promise<boolean>} True if sent successfully
 */
async function sendToDevice(deviceToken, payload, callerName = "unknown") {
  if (!deviceToken) {
    console.error(`[notificationService.sendToDevice] No device token provided. caller=${callerName}`);
    return false;
  }

  const message = {
    token: deviceToken,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: payload.data
      ? Object.fromEntries(
          Object.entries(payload.data).map(([k, v]) => [k, String(v)])
        )
      : {},
    android: {
      priority: "high",
      notification: {
        sound: "default",
        channelId: "crowdcommand_alerts",
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
          badge: 1,
        },
      },
    },
  };

  try {
    const response = await admin.messaging().send(message);
    console.log(
      `[notificationService.sendToDevice] Sent. caller=${callerName} messageId=${response}`
    );
    return true;
  } catch (err) {
    console.error(
      `[notificationService.sendToDevice] Failed. caller=${callerName} token=${deviceToken.slice(0, 10)}... error=${err.message}`,
      { payload }
    );
    return false;
  }
}

/**
 * Sends a push notification to multiple device tokens concurrently.
 * Uses Promise.allSettled so a single failed token doesn't block others.
 *
 * @param {Array<string>} deviceTokens - Array of FCM registration tokens
 * @param {NotificationPayload} payload - Notification content
 * @param {string} [callerName="unknown"] - Calling agent name for error logging
 * @returns {Promise<{sent: number, failed: number}>} Send result counts
 */
async function sendToDevices(deviceTokens, payload, callerName = "unknown") {
  if (!deviceTokens || deviceTokens.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const results = await Promise.allSettled(
    deviceTokens.map((token) => sendToDevice(token, payload, callerName))
  );

  const sent = results.filter((r) => r.status === "fulfilled" && r.value === true).length;
  const failed = results.length - sent;

  return { sent, failed };
}

/**
 * Sends a push notification to all subscribers of an FCM topic.
 * Topics are used for zone-based fan notifications (e.g. "zone_3_fans").
 *
 * @param {string} topic - FCM topic name (no leading slash)
 * @param {NotificationPayload} payload - Notification content
 * @param {string} [callerName="unknown"] - Calling agent name for error logging
 * @returns {Promise<boolean>} True if sent successfully
 */
async function sendToTopic(topic, payload, callerName = "unknown") {
  const message = {
    topic,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: payload.data
      ? Object.fromEntries(
          Object.entries(payload.data).map(([k, v]) => [k, String(v)])
        )
      : {},
    android: {
      priority: "high",
    },
  };

  try {
    const response = await admin.messaging().send(message);
    console.log(
      `[notificationService.sendToTopic] Sent to topic=${topic} caller=${callerName} messageId=${response}`
    );
    return true;
  } catch (err) {
    console.error(
      `[notificationService.sendToTopic] Failed. topic=${topic} caller=${callerName} error=${err.message}`,
      { payload }
    );
    return false;
  }
}

// ─── Domain-specific notification helpers ────────────────────────────────────

/**
 * Notifies a fan that their entry gate has changed due to capacity.
 *
 * @param {string} deviceToken - Fan's FCM token
 * @param {string} originalGateName - Gate the fan was originally assigned to
 * @param {string} newGateName - Alternate gate to use
 * @param {string} newGateId - Gate ID for deep linking in the fan app
 * @returns {Promise<boolean>} True if sent successfully
 */
async function notifyGateChange(deviceToken, originalGateName, newGateName, newGateId) {
  return sendToDevice(
    deviceToken,
    {
      title: "Gate change",
      body: `Please use ${newGateName} — ${originalGateName} is now at capacity.`,
      data: {
        type: "gate_change",
        newGateId,
        newGateName,
        screen: "my_gate",
      },
    },
    "crowdFlowAgent.notifyGateChange"
  );
}

/**
 * Sends a wave exit notification to fans in a specific zone.
 * Used by the post-match wave staggering sequence.
 *
 * @param {string} zoneTopic - FCM topic for the zone (e.g. "zone_1_fans")
 * @param {number} waveNumber - Wave number (1, 2, or 3)
 * @param {string} exitInstruction - Specific exit instruction for this wave
 * @param {string} gateNames - Comma-separated gate names to use
 * @returns {Promise<boolean>} True if sent successfully
 */
async function notifyWaveExit(zoneTopic, waveNumber, exitInstruction, gateNames) {
  const isImmediate = waveNumber === 1;
  return sendToTopic(
    zoneTopic,
    {
      title: isImmediate ? "Exit now — your zone is open" : `Exit in ${waveNumber === 2 ? "4" : "8"} minutes`,
      body: exitInstruction || `Please exit via ${gateNames}. Walk calmly and follow staff.`,
      data: {
        type: "wave_exit",
        waveNumber: String(waveNumber),
        gateNames,
        screen: "exit_guide",
      },
    },
    "dashboardRoutes.waveExit"
  );
}

/**
 * Dispatches a task notification to a volunteer.
 *
 * @param {string} deviceToken - Volunteer's FCM token
 * @param {string} taskId - Firestore task document ID
 * @param {string} taskType - Type of task (e.g. "crowd_management", "sos_response")
 * @param {string} zone - Zone to report to
 * @param {string} instructions - Specific task instructions
 * @returns {Promise<boolean>} True if sent successfully
 */
async function notifyVolunteerTask(deviceToken, taskId, taskType, zone, instructions) {
  return sendToDevice(
    deviceToken,
    {
      title: `Task assigned — ${zone.replace("_", " ").toUpperCase()}`,
      body: instructions,
      data: {
        type: "volunteer_task",
        taskId,
        taskType,
        zone,
        screen: "task_detail",
      },
    },
    "crowdFlowAgent.notifyVolunteerTask"
  );
}

/**
 * Sends an SOS response notification to a security volunteer.
 * Includes the fan's map coordinates for navigation.
 *
 * @param {string} deviceToken - Security volunteer's FCM token
 * @param {string} sosId - Firestore SOS document ID
 * @param {number} fanLat - Fan's latitude
 * @param {number} fanLng - Fan's longitude
 * @param {string} zone - Zone where the SOS was raised
 * @returns {Promise<boolean>} True if sent successfully
 */
async function notifySecuritySos(deviceToken, sosId, fanLat, fanLng, zone) {
  const mapsLink = `https://www.google.com/maps/dir/?api=1&destination=${fanLat},${fanLng}&travelmode=walking`;

  return sendToDevice(
    deviceToken,
    {
      title: "🚨 SOS — Immediate response required",
      body: `Fan in distress at ${zone.replace("_", " ")}. Tap to navigate.`,
      data: {
        type: "sos_response",
        sosId,
        fanLat: String(fanLat),
        fanLng: String(fanLng),
        zone,
        mapsLink,
        screen: "sos_response",
      },
    },
    "emergencyAgent.notifySecuritySos"
  );
}

/**
 * Sends evacuation instructions to all volunteers listed in the evac plan.
 * Called after operator confirms the evacuation.
 *
 * @param {Array<{deviceToken: string, volunteerId: string, instruction: string}>} assignments
 *   Array of volunteer assignments from the Gemini evacuation plan
 * @returns {Promise<{sent: number, failed: number}>} Send result counts
 */
async function notifyEvacuationVolunteers(assignments) {
  if (!assignments || assignments.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const results = await Promise.allSettled(
    assignments.map(({ deviceToken, volunteerId, instruction }) =>
      sendToDevice(
        deviceToken,
        {
          title: "⚠️ EVACUATION — Report to position immediately",
          body: instruction || "Evacuation in progress. Report to your assigned position.",
          data: {
            type: "evacuation",
            volunteerId,
            instruction,
            screen: "evacuation_task",
          },
        },
        "emergencyAgent.notifyEvacuationVolunteers"
      )
    )
  );

  const sent = results.filter((r) => r.status === "fulfilled" && r.value === true).length;
  return { sent, failed: results.length - sent };
}

/**
 * Sends a fan-facing emergency message via zone topics.
 * Used during confirmed evacuations to update the fan PWA.
 *
 * @param {Array<string>} zoneTopics - FCM topics to message (e.g. ["zone_3_fans"])
 * @param {string} message - Emergency message text
 * @param {string} exitInstruction - Specific exit instruction
 * @returns {Promise<void>}
 */
async function notifyFansEmergency(zoneTopics, message, exitInstruction) {
  await Promise.allSettled(
    zoneTopics.map((topic) =>
      sendToTopic(
        topic,
        {
          title: "⚠️ Important stadium announcement",
          body: message,
          data: {
            type: "emergency",
            exitInstruction,
            screen: "exit_guide",
          },
        },
        "emergencyAgent.notifyFansEmergency"
      )
    )
  );
}

module.exports = {
  sendToDevice,
  sendToDevices,
  sendToTopic,
  notifyGateChange,
  notifyWaveExit,
  notifyVolunteerTask,
  notifySecuritySos,
  notifyEvacuationVolunteers,
  notifyFansEmergency,
};
