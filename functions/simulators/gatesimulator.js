/**
 * @fileoverview Gate scan event simulator for CrowdCommand.
 * Runs as a Firebase Scheduled Function every 1 minute.
 * Generates realistic gate scan events across all 6 gates,
 * volume-scaled to the current match phase.
 * Occasionally injects synthetic fraud events so ticketingAgent
 * has data to detect during demos and testing.
 * All events are written to gate_scans — the ticketingAgent
 * onWrite trigger processes each one automatically.
 */

const admin = require("firebase-admin");
const { getDb, getMatchState } = require("../services/firestoreService");
const { logEvent, EVENT_TYPES } = require("../utils/auditLogger");
const config = require("../config");

/**
 * Number of gate scan events generated per minute per gate, by match phase.
 * Pre-match sees heavy scanning as fans arrive; in-match drops to near zero;
 * post-match has no entry scans.
 *
 * @type {Object.<string, number>}
 */
const SCANS_PER_GATE_PER_TICK = {
  "pre-match": 8,
  "in-match": 1,
  halftime: 3,
  "post-match": 0,
};

/**
 * Probability (0-1) of injecting a fraud event per tick per gate.
 * Low enough to be occasional, high enough to be demo-visible.
 * @type {number}
 */
const FRAUD_INJECTION_PROBABILITY = 0.04;

/**
 * Pool of synthetic fan IDs used by the simulator.
 * Real fans would be seeded from a ticketing database.
 * @type {Array<string>}
 */
const DEMO_FAN_IDS = Array.from({ length: 200 }, (_, i) => `fan_${String(i + 1).padStart(4, "0")}`);

/**
 * Pool of synthetic device IDs representing gate scanning terminals.
 * @type {Array<string>}
 */
const SCANNER_DEVICE_IDS = config.gates.map((g) => `scanner_${g.id}`);

/**
 * Picks a random element from an array.
 *
 * @template T
 * @param {Array<T>} arr
 * @returns {T}
 */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generates a plausible QR code string for a fan+gate combination.
 *
 * @param {string} fanId - Fan identifier
 * @param {string} gateId - Gate identifier
 * @returns {string} Synthetic QR code
 */
function generateQrCode(fanId, gateId) {
  return `QR-${fanId}-${gateId}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

/**
 * Builds a single legitimate gate scan document.
 *
 * @param {Object} gate - Gate config object from config.gates
 * @param {string} fanId - Fan identifier
 * @param {string} deviceId - Scanner device identifier
 * @param {string} matchPhase - Current match phase
 * @returns {Object} Firestore-ready gate scan document
 */
function buildLegitScan(gate, fanId, deviceId, matchPhase) {
  const assignedZone = pick(gate.zones);
  return {
    fanId,
    gate: gate.id,
    gateName: gate.name,
    zone: assignedZone,
    assignedZone,           // Same as zone — no mismatch
    deviceId,
    qrCode: generateQrCode(fanId, gate.id),
    matchPhase,
    isSimulated: true,
    isFraud: false,
    scannedAt: admin.firestore.FieldValue.serverTimestamp(),
    isoTimestamp: new Date().toISOString(),
  };
}

/**
 * Builds a duplicate QR fraud scan — reuses a QR code that was
 * already generated for this gate in this tick, triggering the
 * ticketingAgent duplicate check.
 *
 * @param {Object} gate - Gate config object
 * @param {string} deviceId - Scanner device identifier
 * @param {string} existingQrCode - QR code to duplicate
 * @param {string} matchPhase - Current match phase
 * @returns {Object} Firestore-ready gate scan document with fraud flag
 */
function buildDuplicateQrScan(gate, deviceId, existingQrCode, matchPhase) {
  return {
    fanId: `fraud_fan_${Math.random().toString(36).slice(2, 6)}`,
    gate: gate.id,
    gateName: gate.name,
    zone: pick(gate.zones),
    assignedZone: pick(gate.zones),
    deviceId,
    qrCode: existingQrCode,   // Duplicate — triggers fraud detection
    matchPhase,
    isSimulated: true,
    isFraud: true,
    fraudType: "duplicate_qr",
    scannedAt: admin.firestore.FieldValue.serverTimestamp(),
    isoTimestamp: new Date().toISOString(),
  };
}

/**
 * Builds a zone mismatch fraud scan — fan assigned to zone_1 scanning at gate_d (zone_7).
 *
 * @param {Object} gate - Gate config object (the wrong gate)
 * @param {string} fanId - Fan identifier
 * @param {string} deviceId - Scanner device identifier
 * @param {string} matchPhase - Current match phase
 * @returns {Object} Firestore-ready gate scan document with zone mismatch
 */
function buildZoneMismatchScan(gate, fanId, deviceId, matchPhase) {
  // Assign the fan to a zone that this gate does NOT serve
  const nonGateZones = Object.keys(config.zoneCentres).filter(
    (zId) => !gate.zones.includes(zId)
  );
  const assignedZone = pick(nonGateZones);

  return {
    fanId,
    gate: gate.id,
    gateName: gate.name,
    zone: pick(gate.zones),   // Zone this gate serves
    assignedZone,             // Fan's ticket says a different zone
    deviceId,
    qrCode: generateQrCode(fanId, gate.id),
    matchPhase,
    isSimulated: true,
    isFraud: true,
    fraudType: "zone_mismatch",
    scannedAt: admin.firestore.FieldValue.serverTimestamp(),
    isoTimestamp: new Date().toISOString(),
  };
}

/**
 * Main simulator function — called by the Scheduled Function every minute.
 * Generates scan events for all gates scaled to the current match phase,
 * with occasional fraud injections.
 *
 * @returns {Promise<void>}
 */
async function runGateSimulator() {
  try {
    const matchState = await getMatchState();
    const phase = matchState.phase || config.matchPhases.prePre;
    const scansPerGate = SCANS_PER_GATE_PER_TICK[phase] ?? 0;

    if (scansPerGate === 0) {
      console.log(`[gateSimulator] Phase=${phase} — no scans generated.`);
      return;
    }

    const db = getDb();
    const batch = db.batch();
    let totalScans = 0;
    let fraudScans = 0;

    for (const gate of config.gates) {
      const deviceId = `scanner_${gate.id}`;
      const generatedQrCodes = [];

      for (let i = 0; i < scansPerGate; i++) {
        const fanId = pick(DEMO_FAN_IDS);
        const scan = buildLegitScan(gate, fanId, deviceId, phase);
        generatedQrCodes.push(scan.qrCode);

        const ref = db.collection(config.collections.gateScans).doc();
        batch.set(ref, scan);
        totalScans++;
      }

      // Occasional fraud injection per gate
      if (Math.random() < FRAUD_INJECTION_PROBABILITY && generatedQrCodes.length > 0) {
        const fraudType = Math.random() < 0.5 ? "duplicate_qr" : "zone_mismatch";

        let fraudScan;
        if (fraudType === "duplicate_qr") {
          fraudScan = buildDuplicateQrScan(
            gate,
            deviceId,
            pick(generatedQrCodes),
            phase
          );
        } else {
          fraudScan = buildZoneMismatchScan(gate, pick(DEMO_FAN_IDS), deviceId, phase);
        }

        const fraudRef = db.collection(config.collections.gateScans).doc();
        batch.set(fraudRef, fraudScan);
        fraudScans++;
        totalScans++;
      }
    }

    await batch.commit();

    await logEvent(
      EVENT_TYPES.SIMULATOR_TICK,
      "gateSimulator",
      { phase, totalScans, fraudScans, gateCount: config.gates.length },
      `Gate simulator tick — ${totalScans} scans written (${fraudScans} fraud injections)`,
      ""
    );

    console.log(
      `[gateSimulator] Tick complete. phase=${phase} totalScans=${totalScans} fraudScans=${fraudScans}`
    );
  } catch (err) {
    console.error(`[gateSimulator.runGateSimulator] error=${err.message}`, err);
  }
}

/**
 * Writes a single synthetic gate scan for a specific fan.
 * Used by integration tests and the demo reset flow to seed known scan data.
 *
 * @param {string} fanId - Fan identifier
 * @param {string} gateId - Gate ID to scan at
 * @param {Object} [overrides={}] - Optional field overrides for the scan document
 * @returns {Promise<string|null>} New scan document ID or null on failure
 */
async function writeSingleScan(fanId, gateId, overrides = {}) {
  try {
    const gate = config.gates.find((g) => g.id === gateId);
    if (!gate) {
      console.error(`[gateSimulator.writeSingleScan] Unknown gateId=${gateId}`);
      return null;
    }

    const matchState = await getMatchState();
    const scan = {
      ...buildLegitScan(gate, fanId, `scanner_${gateId}`, matchState.phase),
      ...overrides,
    };

    const ref = await getDb().collection(config.collections.gateScans).add(scan);
    return ref.id;
  } catch (err) {
    console.error(
      `[gateSimulator.writeSingleScan] fanId=${fanId} gateId=${gateId} error=${err.message}`
    );
    return null;
  }
}

module.exports = { runGateSimulator, writeSingleScan, SCANS_PER_GATE_PER_TICK };