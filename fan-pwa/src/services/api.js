/**
 * api.js — HTTP client for the CrowdCommand Fan PWA.
 *
 * All calls target Firebase Cloud Functions exposed via the fanRoutes and
 * sosRoutes routers. The base URL is injected via a CRA environment variable
 * so the same codebase works locally (Functions emulator) and in production.
 *
 * Every function returns a plain JS object (parsed JSON) or throws an Error
 * with a human-readable message. Components catch errors and show localised
 * error strings via i18n.
 */

const BASE_URL =
  process.env.REACT_APP_FUNCTIONS_BASE_URL ||
  'https://us-central1-crowdcommand.cloudfunctions.net';

/**
 * Generic fetch wrapper with timeout and error normalisation.
 *
 * @param {string} path - URL path relative to BASE_URL
 * @param {RequestInit} [options={}] - fetch options
 * @param {number} [timeoutMs=8000] - request timeout in milliseconds
 * @returns {Promise<object>} Parsed JSON response body
 * @throws {Error} On network failure, timeout, or non-2xx HTTP status
 */
const apiFetch = async (path, options = {}, timeoutMs = 8000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...options,
    });

    clearTimeout(timer);

    if (!res.ok) {
      let message = `Request failed: ${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch (_) {}
      throw new Error(message);
    }

    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. Please check your connection.');
    }
    throw err;
  }
};

// ── Fan info ──────────────────────────────────────────────────────────────────

/**
 * Fetches personalised fan data including assigned gate, wave group, and
 * any active notifications for this fan.
 *
 * @param {string} fanId - fan identifier (from URL query param)
 * @returns {Promise<{ fanId: string, gateId: string, waveGroup: number, notifications: object[] }>}
 */
export const getFanInfo = (fanId) =>
  apiFetch(`/fanInfo?fanId=${encodeURIComponent(fanId)}`);

// ── Gate info ─────────────────────────────────────────────────────────────────

/**
 * Fetches current gate status, density, and any alternate gate assignment.
 *
 * @param {string} gateId - gate identifier
 * @returns {Promise<{ gateId: string, status: string, density: number, alternateGate: string|null }>}
 */
export const getGateStatus = (gateId) =>
  apiFetch(`/gateStatus?gateId=${encodeURIComponent(gateId)}`);

// ── Exit routing ──────────────────────────────────────────────────────────────

/**
 * Fetches the recommended exit route for a fan based on their zone and
 * current crowd density. Avoids zones above 70% density.
 *
 * @param {string} fanId - fan identifier
 * @param {string} gateId - fan's assigned gate / zone
 * @returns {Promise<{ exitGate: string, route: object[], estimatedMinutes: number, distanceMetres: number, weatherRerouted: boolean }>}
 */
export const getExitRoute = (fanId, gateId) =>
  apiFetch(
    `/exitRoute?fanId=${encodeURIComponent(fanId)}&gateId=${encodeURIComponent(gateId)}`
  );

// ── SOS ───────────────────────────────────────────────────────────────────────

/**
 * Submits an SOS alert for a fan. This is the primary emergency endpoint.
 *
 * The Cloud Function simultaneously:
 *  1. Writes the SOS to Firestore sos/{sosId}
 *  2. Calculates the nearest safe exit route
 *  3. Dispatches the 2 nearest available security personnel
 *  4. Returns the exit route in the HTTP response (target: < 3 seconds)
 *
 * @param {{ fanId: string, gateId: string, lat: number, lng: number }} payload
 * @returns {Promise<{ sosId: string, exitRoute: object, responderEta: number, message: string }>}
 */
export const submitSOS = (payload) =>
  apiFetch('/sos', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

// Backward-compatible alias used by existing UI components.
export const triggerSOS = submitSOS;

/**
 * Fetches the current status of an active SOS incident.
 * Used by SOSActive to poll for responder location updates and resolution.
 *
 * @param {string} sosId - SOS document ID
 * @returns {Promise<{ sosId: string, status: string, responderLocation: object|null, resolvedAt: string|null }>}
 */
export const getSOSStatus = (sosId) =>
  apiFetch(`/sosStatus?sosId=${encodeURIComponent(sosId)}`);

// ── Match state ───────────────────────────────────────────────────────────────

/**
 * Fetches the current match phase and wave sequence state.
 * Used by HomeScreen and ExitGuide to show phase-appropriate content.
 *
 * @returns {Promise<{ phase: string, waveSequence: object|null, activeAlertCount: number }>}
 */
export const getMatchState = () => apiFetch('/matchState');

// ── FCM token registration ────────────────────────────────────────────────────

/**
 * Registers an FCM device token for a fan so the backend can send
 * targeted push notifications (gate changes, wave exits, SOS updates).
 *
 * @param {{ fanId: string, fcmToken: string }} payload
 * @returns {Promise<{ success: boolean }>}
 */
export const registerFCMToken = (payload) =>
  apiFetch('/registerToken', {
    method: 'POST',
    body: JSON.stringify(payload),
  });