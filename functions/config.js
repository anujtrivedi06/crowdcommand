/**
 * @fileoverview Central configuration for all CrowdCommand Cloud Functions.
 * All environment variables and constants are sourced from here.
 * Agents and services import from this file rather than reading process.env directly.
 */

/**
 * @typedef {Object} StadiumConfig
 * @property {string} name - Stadium name
 * @property {number} capacity - Total fan capacity
 * @property {number} zones - Number of zones
 * @property {number} lat - Stadium latitude
 * @property {number} lng - Stadium longitude
 */

/**
 * @typedef {Object} ThresholdConfig
 * @property {number} sosCluster - Number of concurrent SOSes to trigger evacuation
 * @property {number} sosClusterWindowMinutes - Time window for SOS cluster detection
 * @property {number} sosClusterRadiusMetres - Radius for SOS cluster grouping
 * @property {number} surgeRate - Density increase per reading to trigger surge alert
 * @property {number} gateCapacity - Gate fill percentage to trigger rerouting
 * @property {number} cctvAnomalyScore - Vision AI score above which to raise alert
 */

const config = {
  /** Google Cloud project identifiers */
  project: {
    id: process.env.GOOGLE_CLOUD_PROJECT || "crowdcommand",
    firebaseId: process.env.FIREBASE_PROJECT_ID || "crowdcommand",
    vertexLocation: process.env.VERTEX_AI_LOCATION || "us-central1",
  },

  /** Gemini model configuration */
  gemini: {
    model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
    maxOutputTokens: 2048,
    temperature: 0.2, // Low temperature for consistent structured JSON output
  },

  /** External API keys */
  apis: {
    googleMaps: process.env.GOOGLE_MAPS_API_KEY || "",
    fcmServerKey: process.env.FCM_SERVER_KEY || "",
    weather: process.env.WEATHER_API_KEY || "",
  },

  /** Feature flags */
  flags: {
    useMockVision: process.env.USE_MOCK_VISION !== "false", // Default true
    demoMode: process.env.DEMO_MODE !== "false", // Default true
  },

  /** Stadium physical configuration */
  stadium: {
    name: process.env.STADIUM_NAME || "M. Chinnaswamy Stadium",
    capacity: parseInt(process.env.STADIUM_CAPACITY || "35000", 10),
    zones: parseInt(process.env.STADIUM_ZONES || "12", 10),
    lat: parseFloat(process.env.STADIUM_LAT || "12.9792"),
    lng: parseFloat(process.env.STADIUM_LNG || "77.5994"),
  },

  /** Detection and response thresholds — all documented in README section 8 */
  thresholds: {
    sosCluster: parseInt(process.env.SOS_CLUSTER_THRESHOLD || "3", 10),
    sosClusterWindowMinutes: parseInt(
      process.env.SOS_CLUSTER_WINDOW_MINUTES || "2",
      10
    ),
    sosClusterRadiusMetres: parseInt(
      process.env.SOS_CLUSTER_RADIUS_METRES || "50",
      10
    ),
    surgeRate: parseInt(process.env.SURGE_RATE_THRESHOLD || "4", 10),
    gateCapacity: parseInt(process.env.GATE_CAPACITY_THRESHOLD || "80", 10),
    cctvAnomalyScore: 0.7,
  },

  /** Wave exit staggering delays */
  waveStaggering: {
    wave1ZoneIds: ["zone_1", "zone_2", "zone_3", "zone_4"],
    wave2ZoneIds: ["zone_5", "zone_6", "zone_7", "zone_8"],
    wave3ZoneIds: ["zone_9", "zone_10", "zone_11", "zone_12"],
    wave2DelayMinutes: parseInt(process.env.WAVE_2_DELAY_MINUTES || "4", 10),
    wave3DelayMinutes: parseInt(process.env.WAVE_3_DELAY_MINUTES || "8", 10),
  },

  /** Firestore collection names — single source of truth */
  collections: {
    zones: "zones",
    alerts: "alerts",
    agentSignals: "agent_signals",
    actions: "actions",
    sos: "sos",
    emergencyTriggers: "emergency_triggers",
    evacuation: "evacuation",
    volunteers: "volunteers",
    volunteerTasks: "volunteer_tasks",
    gateScans: "gate_scans",
    fraudAlerts: "fraud_alerts",
    securityAlerts: "security_alerts",
    weatherEvents: "weather_events",
    auditLog: "audit_log",
    config: "config",
    waveSequence: "wave_sequence",
  },

  /** Firestore document IDs for singleton documents */
  documents: {
    matchState: "matchState",
    evacuationCurrent: "current",
    actionsCurrent: "current",
  },

  /** Match phase values */
  matchPhases: {
    prePre: "pre-match",
    inMatch: "in-match",
    halftime: "halftime",
    postMatch: "post-match",
  },

  /** Zone centre coordinates for M. Chinnaswamy Stadium (approximate) */
  zoneCentres: {
    zone_1: { lat: 12.9802, lng: 77.5984 },
    zone_2: { lat: 12.9802, lng: 77.5994 },
    zone_3: { lat: 12.9802, lng: 77.6004 },
    zone_4: { lat: 12.9797, lng: 77.6009 },
    zone_5: { lat: 12.9792, lng: 77.6009 },
    zone_6: { lat: 12.9787, lng: 77.6009 },
    zone_7: { lat: 12.9782, lng: 77.6004 },
    zone_8: { lat: 12.9782, lng: 77.5994 },
    zone_9: { lat: 12.9782, lng: 77.5984 },
    zone_10: { lat: 12.9787, lng: 77.5979 },
    zone_11: { lat: 12.9792, lng: 77.5979 },
    zone_12: { lat: 12.9797, lng: 77.5979 },
  },

  /** Gate configuration */
  gates: [
    {
      id: "gate_a",
      name: "Gate A",
      zones: ["zone_1", "zone_2"],
      covered: true,
      lat: 12.9808,
      lng: 77.5994,
    },
    {
      id: "gate_b",
      name: "Gate B",
      zones: ["zone_3", "zone_4"],
      covered: true,
      lat: 12.9802,
      lng: 77.6014,
    },
    {
      id: "gate_c",
      name: "Gate C",
      zones: ["zone_5", "zone_6"],
      covered: false,
      lat: 12.9782,
      lng: 77.6014,
    },
    {
      id: "gate_d",
      name: "Gate D",
      zones: ["zone_7", "zone_8"],
      covered: false,
      lat: 12.9776,
      lng: 77.5994,
    },
    {
      id: "gate_e",
      name: "Gate E",
      zones: ["zone_9", "zone_10"],
      covered: true,
      lat: 12.9782,
      lng: 77.5974,
    },
    {
      id: "gate_f",
      name: "Gate F",
      zones: ["zone_11", "zone_12"],
      covered: true,
      lat: 12.9802,
      lng: 77.5974,
    },
  ],

  /** CCTV anomaly labels the Vision AI mock can generate */
  cctvAnomalyLabels: ["crowd_surge", "abandoned_object", "aggression"],

  /** System prompt used for ALL Gemini calls — imported by geminiService */
  geminiSystemPrompt: `You are an AI safety agent for CrowdCommand, a stadium crowd management system at M. Chinnaswamy Stadium, Bengaluru. The stadium holds 35,000 fans across 12 zones. You must always prioritise fan safety above operational efficiency. When uncertain, recommend caution. Always return valid JSON matching the schema provided. If you cannot complete the request, return the schema with a safe default action and explain in the reasoning field. Never return markdown — return only the raw JSON object.`,
};

module.exports = config;
