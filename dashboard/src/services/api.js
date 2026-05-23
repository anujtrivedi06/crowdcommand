/**
 * api.js — Dashboard service layer for calling Firebase Cloud Functions.
 * All functions return a Promise that resolves to the JSON response body.
 * Errors are caught and re-thrown with a meaningful message.
 */

import { getFunctionsBaseUrl } from '../firebase';

const FUNCTIONS_BASE_URL = process.env.REACT_APP_FUNCTIONS_BASE_URL || getFunctionsBaseUrl();

/**
 * Generic fetch wrapper with error handling.
 * @param {string} path - Function path relative to FUNCTIONS_BASE_URL.
 * @param {object} [options] - Fetch options (method, body, headers).
 * @returns {Promise<object>} Parsed JSON response.
 */
async function apiFetch(path, options = {}) {
  const url = `${FUNCTIONS_BASE_URL}${path}`;
  const defaults = {
    headers: { 'Content-Type': 'application/json' },
  };
  const config = { ...defaults, ...options };
  if (config.body && typeof config.body !== 'string') {
    config.body = JSON.stringify(config.body);
  }

  try {
    const res = await fetch(url, config);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || `HTTP ${res.status} from ${path}`);
    }
    return data;
  } catch (err) {
    console.error(`[api] ${path} failed:`, err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Dashboard routes
// ---------------------------------------------------------------------------

/**
 * Fetch current dashboard summary (zone counts, alert counts, match phase).
 * @returns {Promise<object>} Dashboard summary payload.
 */
export async function getDashboardSummary() {
  return apiFetch('/dashboardSummary');
}

/**
 * Fetch analytics metrics (peak density, avg gate throughput, SOS count, wave stats).
 * @returns {Promise<object>} Analytics payload.
 */
export async function getAnalytics() {
  return apiFetch('/getAnalytics');
}

/**
 * Trigger end-of-match wave exit staggering sequence.
 * @returns {Promise<object>} Wave sequence status.
 */
export async function triggerEndMatch() {
  return apiFetch('/endMatch', { method: 'POST' });
}

/**
 * Confirm a pending evacuation plan.
 * @param {string} planId - The evacuation document ID (usually "current").
 * @param {string} operatorId - ID of the operator confirming.
 * @returns {Promise<object>} Confirmation result.
 */
export async function confirmEvacPlan(planId, operatorId = 'operator-dashboard') {
  return apiFetch('/confirmEvacuation', {
    method: 'POST',
    body: { planId, operatorId },
  });
}

/**
 * Reject a pending evacuation plan.
 * @param {string} planId - The evacuation document ID.
 * @param {string} reason - Operator-provided rejection reason.
 * @param {string} operatorId - ID of the operator rejecting.
 * @returns {Promise<object>} Rejection result.
 */
export async function rejectEvacPlan(planId, reason, operatorId = 'operator-dashboard') {
  return apiFetch('/rejectEvacuation', {
    method: 'POST',
    body: { planId, reason, operatorId },
  });
}

// ---------------------------------------------------------------------------
// Demo controls
// ---------------------------------------------------------------------------

/**
 * Trigger a crowd surge at a specific gate/zone for demo purposes.
 * @param {string|number} zoneId - Zone identifier (e.g. "zone-3").
 * @returns {Promise<object>} Trigger result.
 */
export async function triggerSurge(zoneInput = 'zone_3') {
  const payload =
    typeof zoneInput === 'object' && zoneInput !== null
      ? {
          zoneId: zoneInput.zoneId || 'zone_3',
          density: zoneInput.density,
          trend: zoneInput.trend,
        }
      : { zoneId: zoneInput };

  return apiFetch('/triggerSurge', {
    method: 'POST',
    body: payload,
  });
}

/**
 * Trigger a weather alert event for demo purposes.
 * @param {string} [eventType='rain'] - Weather event type.
 * @returns {Promise<object>} Trigger result.
 */
export async function triggerWeatherAlert(weatherInput = 'rain') {
  const payload =
    typeof weatherInput === 'object' && weatherInput !== null
      ? {
          type: weatherInput.type || weatherInput.eventType || 'rain',
          severity: weatherInput.severity || 'moderate',
        }
      : { type: weatherInput };

  return apiFetch('/triggerWeatherAlert', {
    method: 'POST',
    body: payload,
  });
}

/**
 * Trigger a demo SOS for a pre-seeded fan at zone 5 centre coordinates.
 * @returns {Promise<object>} SOS trigger result including exit route.
 */
export async function triggerDemoSOS() {
  return apiFetch('/triggerDemoSos', { method: 'POST' });
}

/**
 * Trigger a security anomaly alert at a specific zone for demo purposes.
 * @param {string|number} zoneId - Zone to target (e.g. "zone-7").
 * @returns {Promise<object>} Trigger result.
 */
export async function triggerSecurityAlert(securityInput = 'zone_7') {
  const payload =
    typeof securityInput === 'object' && securityInput !== null
      ? {
          zoneId: securityInput.zoneId || 'zone_7',
          label: securityInput.label,
          score: securityInput.score,
        }
      : { zoneId: securityInput };

  return apiFetch('/triggerSecurityAlert', {
    method: 'POST',
    body: payload,
  });
}

/**
 * Reset all demo state: clear alerts, SOSes, fraud flags, set matchPhase to pre-match.
 * @returns {Promise<object>} Reset confirmation.
 */
export async function resetDemo() {
  return apiFetch('/resetDemo', { method: 'POST' });
}

// ---------------------------------------------------------------------------
// SOS routes
// ---------------------------------------------------------------------------

/**
 * Resolve an active SOS incident.
 * @param {string} sosId - The SOS document ID.
 * @param {string} resolvedBy - Volunteer or operator ID.
 * @returns {Promise<object>} Resolution result.
 */
export async function resolveSOS(sosId, resolvedBy) {
  return apiFetch('/resolveSOS', {
    method: 'POST',
    body: { sosId, resolvedBy },
  });
}

// ---------------------------------------------------------------------------
// Gate management
// ---------------------------------------------------------------------------

/**
 * Override a gate status manually from the dashboard.
 * @param {string} gateId - Gate identifier.
 * @param {string} status - New status: 'open' | 'closed' | 'rerouting'.
 * @param {string} [altGate] - Alternate gate to direct fans to (if rerouting).
 * @returns {Promise<object>} Gate update result.
 */
export async function updateGateStatus(gateId, status, altGate = null) {
  return apiFetch('/updateGate', {
    method: 'POST',
    body: { gateId, status, altGate },
  });
}

// ---------------------------------------------------------------------------
// Volunteer management
// ---------------------------------------------------------------------------

/**
 * Fetch current volunteer statuses.
 * @returns {Promise<Array>} Array of volunteer documents.
 */
export async function getVolunteers() {
  return apiFetch('/getVolunteers');
}

/**
 * Manually assign a volunteer to a zone task.
 * @param {string} volunteerId - Volunteer document ID.
 * @param {string} zoneId - Target zone.
 * @param {string} taskDescription - Task details.
 * @returns {Promise<object>} Assignment result.
 */
export async function assignVolunteer(volunteerId, zoneId, taskDescription) {
  return apiFetch('/assignVolunteer', {
    method: 'POST',
    body: { volunteerId, zoneId, taskDescription },
  });
}