/**
 * @fileoverview Firebase Cloud Functions entry point for CrowdCommand.
 * Exports all HTTP functions, Firestore triggers, and Scheduled Functions.
 * Firebase deploys only the exports listed here.
 *
 * Function categories:
 *   HTTP   — Dashboard, fan PWA, SOS, analytics endpoints
 *   onWrite — Agent triggers listening to Firestore collection writes
 *   Scheduled — Simulators and cluster detector running on cron intervals
 */

const admin = require("firebase-admin");

// Initialise firebase-admin once at the top level.
// All services and agents import admin after this runs.
if (!admin.apps.length) {
  admin.initializeApp();
}

// ─── HTTP: Dashboard routes ───────────────────────────────────────────────────

const dashboardRoutes = require("./routers/dashboardroutes");

/** Returns current match state for dashboard polling. */
exports.getMatchState = dashboardRoutes.getMatchStateHandler;

/** Allows operator to manually set match phase for demo pacing. */
exports.setMatchPhase = dashboardRoutes.setMatchPhase;

/** Triggers the wave exit staggering sequence when the operator ends the match. */
exports.endMatch = dashboardRoutes.endMatch;

/** Confirms or rejects a pending evacuation plan. */
exports.confirmEvacuation = dashboardRoutes.confirmEvacuation;

/** Resets all demo state to pre-match baseline. */
exports.resetDemo = dashboardRoutes.resetDemo;

/** Demo trigger: force zone surge scenario. */
exports.triggerSurge = dashboardRoutes.triggerSurge;

/** Demo trigger: inject weather alert event. */
exports.triggerWeatherAlert = dashboardRoutes.triggerWeatherAlert;

/** Demo trigger: inject SOS from seeded fan persona. */
exports.triggerDemoSos = dashboardRoutes.triggerDemoSos;

/** Demo trigger: inject high-confidence security anomaly. */
exports.triggerSecurityAlert = dashboardRoutes.triggerSecurityAlert;

// ─── HTTP: Fan PWA routes ─────────────────────────────────────────────────────

const fanRoutes = require("./routers/fanroutes");

/** Returns personalised gate and match status for a fan. */
exports.fanStatus = fanRoutes.fanStatus;

/** Calculates a live exit route for a fan avoiding high-density zones. */
exports.exitRoute = fanRoutes.exitRoute;

/** Volunteer confirms receipt of a dispatched task. */
exports.confirmTask = fanRoutes.confirmTask;

/** Registers or refreshes a fan's FCM device token and zone topic subscription. */
exports.updateFcmToken = fanRoutes.updateFcmToken;

/** Returns lightweight match info for the fan PWA HomeScreen ticker. */
exports.fanMatchInfo = fanRoutes.fanMatchInfo;

// ─── HTTP: SOS routes ─────────────────────────────────────────────────────────

const sosRoutes = require("./routers/sosroutes");

/** Handles a fan SOS — writes to Firestore, dispatches security, returns exit route. */
exports.triggerSos = sosRoutes.triggerSos;

/** Marks an SOS as resolved and frees the assigned volunteer. */
exports.resolveSos = sosRoutes.resolveSos;

/** Returns all active SOS incidents for the dashboard SOSTracker. */
exports.activeSos = sosRoutes.activeSos;

// ─── HTTP: Analytics routes ───────────────────────────────────────────────────

const analyticsRoutes = require("./routers/analyticsRoutes");

/** Returns the 4 key stat cards for the AnalyticsTab component. */
exports.analyticsOverview = analyticsRoutes.analyticsOverview;

/** Returns per-zone density history for sparkline charts. */
exports.densityTimeline = analyticsRoutes.densityTimeline;

/** Returns agent signal counts grouped by agent name. */
exports.agentActivity = analyticsRoutes.agentActivity;

/** Returns a breakdown of alert types, SOS stats, and resolutions. */
exports.incidentSummary = analyticsRoutes.incidentSummary;

// ─── Firestore triggers: Agents ───────────────────────────────────────────────

const crowdFlowAgent = require("./Agents/crowdFlowAgent");
const ticketingAgent = require("./Agents/ticketingAgent");
const securityAgent = require("./Agents/securityAgent");
const weatherAgent = require("./Agents/weatherAgent");
const emergencyAgent = require("./Agents/emergencyAgent");
const orchestrator = require("./Agents/orchestrator");

/**
 * Crowd flow agent — fires on every zone density update.
 * Reads last 5 readings, calls Gemini if surge rate exceeds threshold,
 * writes surge_prediction alert and rerouting action to Firestore.
 */
exports.onZoneUpdate = crowdFlowAgent.onZoneUpdate;

/**
 * Ticketing fraud agent — fires on every gate scan document write.
 * Checks for duplicate QR, device rate abuse, and wrong-zone scans.
 */
exports.onGateScan = ticketingAgent.onGateScan;

/**
 * Weather agent — fires when a weather event document is written.
 * Calls Gemini to assess risk; writes weather_reroute signal if medium+.
 */
exports.onWeatherEvent = weatherAgent.onWeatherEvent;

/**
 * Emergency agent — fires when an emergency trigger document is written.
 * Calls Gemini for a full evacuation plan; writes pending_confirmation to Firestore.
 */
exports.onEmergencyTrigger = emergencyAgent.onEmergencyTrigger;

/**
 * Orchestrator — fires on every new agent signal document.
 * Collects all signals from the last 60 seconds, calls Gemini for a
 * unified ActionPlan, executes or surfaces for human confirmation.
 */
exports.onAgentSignal = orchestrator.onAgentSignal;

// ─── Scheduled: Simulators ────────────────────────────────────────────────────

const sensorSimulator = require("./simulators/sensorSimulator");
const gateSimulator = require("./simulators/gatesimulator");
const weatherSimulator = require("./simulators/weathersimulator");
const clusterDetector = require("./utils/clusterDetector");
const securityAgentScheduled = require("./Agents/securityAgent");

/**
 * Sensor simulator — runs every 1 minute.
 * Writes 12 zone density documents to Firestore, simulating a 5-second IoT interval.
 * Must always be running so the dashboard is never empty when a judge visits.
 */
exports.simulateSensors = sensorSimulator.simulateSensors;

/**
 * Gate simulator — runs every 1 minute.
 * Writes realistic gate scan events to gate_scans collection,
 * including occasional simulated fraud events for ticketingAgent to catch.
 */
exports.simulateGateScans = gateSimulator.simulateGateScans;

/**
 * Weather simulator — runs every 5 minutes.
 * Occasionally writes a weather event (rain/lightning/heatwave) to weather_events.
 * Frequency increases during demo mode to keep the dashboard active.
 */
exports.simulateWeather = weatherSimulator.simulateWeather;

/**
 * SOS cluster detector — runs every 1 minute.
 * Queries active SOSes from the last 2 minutes, groups by 50m radius.
 * Writes to emergency_triggers if 3+ SOSes cluster in one zone.
 */
exports.detectSosClusters = clusterDetector.detectSosClusters;

/**
 * CCTV anomaly scanner — runs every 30 seconds via a 1-minute scheduled function
 * that processes all 12 zones. Calls visionService.scoreCCTVFrame per zone.
 * Uses mock scoring (USE_MOCK_VISION=true) on hosted deployment.
 */
exports.scanCCTV = securityAgentScheduled.scanCCTV;