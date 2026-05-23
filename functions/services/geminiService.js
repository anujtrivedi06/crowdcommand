/**
 * @fileoverview Gemini 1.5 Flash API wrapper for CrowdCommand.
 * All agents call this service rather than the Vertex AI SDK directly.
 * Every call includes the system prompt from config.js, enforces JSON output,
 * and has a documented fallback for API failures.
 */

const { VertexAI } = require("@google-cloud/vertexai");
const config = require("../config");

let vertexClient = null;

/**
 * Returns a singleton VertexAI client.
 * @returns {VertexAI}
 */
function getVertexClient() {
  if (!vertexClient) {
    vertexClient = new VertexAI({
      project: config.project.id,
      location: config.project.vertexLocation,
    });
  }
  return vertexClient;
}

/**
 * Returns the generative model instance configured for JSON output.
 * @returns {import("@google-cloud/vertexai").GenerativeModel}
 */
function getModel() {
  return getVertexClient().getGenerativeModel({
    model: config.gemini.model,
    generationConfig: {
      maxOutputTokens: config.gemini.maxOutputTokens,
      temperature: config.gemini.temperature,
      responseMimeType: "application/json",
    },
    systemInstruction: {
      role: "system",
      parts: [{ text: config.geminiSystemPrompt }],
    },
  });
}

/**
 * Parses a raw Gemini response string into a JSON object.
 * Strips markdown code fences if present (defensive — model is instructed not to include them).
 *
 * @param {string} rawText - Raw text from Gemini content part
 * @returns {Object} Parsed JSON object
 * @throws {Error} If the text cannot be parsed as JSON
 */
function parseGeminiJson(rawText) {
  const cleaned = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

/**
 * Core Gemini call function. Sends a prompt and returns a parsed JSON object.
 * On any failure (network, quota, invalid JSON), returns the provided fallback.
 * Fallback behaviour is logged so operators know when AI reasoning was unavailable.
 *
 * @param {string} prompt - The user-turn prompt to send to Gemini
 * @param {Object} fallback - Safe default response to return on failure
 * @param {string} [callerName="unknown"] - Name of the calling agent for error logging
 * @returns {Promise<Object>} Parsed Gemini response or fallback
 */
async function callGemini(prompt, fallback, callerName = "unknown") {
  try {
    const model = getModel();
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const response = result.response;
    if (!response || !response.candidates || response.candidates.length === 0) {
      throw new Error("Empty candidates array in Gemini response");
    }

    const candidate = response.candidates[0];
    if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
      throw new Error("Empty content parts in Gemini candidate");
    }

    const rawText = candidate.content.parts[0].text;
    const parsed = parseGeminiJson(rawText);

    return parsed;
  } catch (err) {
    console.error(
      `[geminiService] API call failed — returning fallback. caller=${callerName} error=${err.message}`
    );
    // Return fallback with a flag so the audit logger can note AI was unavailable
    return {
      ...fallback,
      _geminiUnavailable: true,
      _fallbackReason: err.message,
    };
  }
}

// ─── Agent-specific call wrappers ────────────────────────────────────────────
// Each wrapper defines the prompt schema and the safe fallback for that agent.

/**
 * Calls Gemini for surge prediction analysis.
 *
 * @param {Object} context - Zone densities, rates of change, match phase, weather, volunteers
 * @returns {Promise<Object>} Surge prediction with affected_zones, estimated_minutes_to_critical,
 *   recommended_actions, risk_level, reasoning
 */
async function predictSurge(context) {
  const prompt = `
Analyse the following stadium crowd data and predict surge risk.

Current zone densities (0-100%):
${JSON.stringify(context.zoneDensities, null, 2)}

Rate of change per zone (density points per reading):
${JSON.stringify(context.ratesOfChange, null, 2)}

Match phase: ${context.matchPhase}
Weather status: ${context.weatherStatus}
Active volunteers per zone: ${JSON.stringify(context.volunteersPerZone)}
Active alerts count: ${context.activeAlertCount}

Return a JSON object with exactly these fields:
{
  "affected_zones": ["zone_3"],
  "estimated_minutes_to_critical": 5,
  "recommended_actions": ["Redirect fans from Gate B to Gate A", "Deploy 2 volunteers to zone_3"],
  "risk_level": "high",
  "reasoning": "Zone 3 density is at 85% with an increasing rate of 4.2 points per reading..."
}

risk_level must be one of: low, medium, high, critical
`;

  const fallback = {
    affected_zones: [],
    estimated_minutes_to_critical: 10,
    recommended_actions: ["Manual inspection required — AI reasoning unavailable"],
    risk_level: "medium",
    reasoning: "Gemini unavailable — defaulting to medium risk. Manual review required.",
  };

  return callGemini(prompt, fallback, "crowdFlowAgent.predictSurge");
}

/**
 * Calls Gemini to assess weather risk and recommend rerouting.
 *
 * @param {Object} context - Weather event, zone config, fan distribution
 * @returns {Promise<Object>} Weather assessment with risk_level, affected_zones,
 *   reroute_to_zones, fan_message, reasoning
 */
async function assessWeatherRisk(context) {
  const prompt = `
Assess the weather risk for stadium crowd management.

Weather event: ${context.eventType} (severity: ${context.severity})
Current zone densities: ${JSON.stringify(context.zoneDensities)}
Covered zones: ${JSON.stringify(context.coveredZones)}
Open-air zones: ${JSON.stringify(context.openAirZones)}
Match phase: ${context.matchPhase}
Fan count in open zones: ${context.fansInOpenZones}

Return a JSON object with exactly these fields:
{
  "risk_level": "medium",
  "affected_zones": ["zone_3", "zone_5"],
  "reroute_to_zones": ["zone_7", "zone_9"],
  "fan_message": "Rain detected. Please move to covered areas at Gates A and F.",
  "staff_message": "Redirect fans from open zones 3, 5 to covered zones 7, 9 immediately.",
  "reasoning": "Lightning risk requires clearing all open-air zones within 10 minutes..."
}

risk_level must be one of: low, medium, high, critical
`;

  const fallback = {
    risk_level: "medium",
    affected_zones: [],
    reroute_to_zones: [],
    fan_message: "Please follow staff instructions for shelter.",
    staff_message: "Monitor weather conditions — AI assessment unavailable.",
    reasoning: "Gemini unavailable — defaulting to medium risk.",
  };

  return callGemini(prompt, fallback, "weatherAgent.assessWeatherRisk");
}

/**
 * Calls Gemini to generate a full evacuation plan.
 *
 * @param {Object} context - All zone data, gate statuses, volunteer positions, trigger reason
 * @returns {Promise<Object>} Evacuation plan with exits_to_open, exits_to_close,
 *   volunteer_assignments, pa_announcement_script, fan_app_message, risk_level, reasoning
 */
async function generateEvacuationPlan(context) {
  const prompt = `
Generate a complete evacuation plan for the stadium.

Emergency trigger: ${context.triggerReason}
Affected zone: ${context.affectedZone}
Match phase: ${context.matchPhase}

All zone densities:
${JSON.stringify(context.zoneDensities, null, 2)}

Gate statuses:
${JSON.stringify(context.gateStatuses, null, 2)}

Available volunteers (name, zone, location):
${JSON.stringify(context.volunteers, null, 2)}

Return a JSON object with exactly these fields:
{
  "exits_to_open": ["gate_a", "gate_f"],
  "exits_to_close": ["gate_c"],
  "volunteer_assignments": {
    "vol_001": "Direct fans at zone_3 to gate_a",
    "vol_002": "Assist elderly fans in zone_5"
  },
  "pa_announcement_script": "Attention all guests. Please proceed calmly to the nearest exit...",
  "fan_app_message": "Please exit via Gate A or Gate F. Follow staff instructions.",
  "risk_level": "critical",
  "reasoning": "SOS cluster in zone_3 indicates a potential crush forming..."
}
`;

  const fallback = {
    exits_to_open: ["gate_a", "gate_b", "gate_e", "gate_f"],
    exits_to_close: [],
    volunteer_assignments: {},
    pa_announcement_script:
      "Attention all guests. Please proceed calmly to the nearest exit. Do not run. Follow staff instructions.",
    fan_app_message: "Please exit calmly via the nearest gate. Follow staff instructions.",
    risk_level: "high",
    reasoning: "Gemini unavailable — defaulting to open all safe exits. Manual coordination required.",
  };

  return callGemini(prompt, fallback, "emergencyAgent.generateEvacuationPlan");
}

/**
 * Calls Gemini for the orchestrator to synthesise multiple agent signals into an ActionPlan.
 *
 * @param {Object} context - Match state, zone densities, all recent agent signals
 * @returns {Promise<Object>} ActionPlan with priority, actionType, targetZones,
 *   messageToFans, messageToStaff, rationale, requiresHumanConfirmation
 */
async function synthesiseActionPlan(context) {
  const prompt = `
You are the master orchestrator for a stadium crowd management system.
Synthesise the following agent signals into a single prioritised action plan.

Current timestamp: ${context.timestamp}
Match phase: ${context.matchPhase}
Zone densities: ${JSON.stringify(context.zoneDensities)}
Active alerts: ${context.activeAlertCount}
Active SOS count: ${context.activeSosCount}
Weather status: ${context.weatherStatus}

Recent agent signals (last 60 seconds):
${JSON.stringify(context.recentSignals, null, 2)}

Return a JSON object with exactly these fields:
{
  "priority": 3,
  "actionType": "gate_reroute",
  "targetZones": ["zone_3", "zone_4"],
  "messageToFans": "Gate 3 is at capacity. Please use Gate A.",
  "messageToStaff": "Deploy volunteers to zone_3 immediately. Reroute to gate_a.",
  "rationale": "Zone 3 surge prediction + weather signal together indicate...",
  "requiresHumanConfirmation": false
}

priority must be 1 (lowest) to 5 (highest — life safety).
requiresHumanConfirmation must be true for any action involving evacuation, gate closure, or risk_level critical.
actionType must be one of: gate_reroute, volunteer_dispatch, fan_notification, evacuation, weather_reroute, monitor_only.
`;

  const fallback = {
    priority: 2,
    actionType: "monitor_only",
    targetZones: [],
    messageToFans: "",
    messageToStaff: "AI orchestrator unavailable — monitor all zones manually.",
    rationale: "Gemini unavailable — defaulting to manual monitoring mode.",
    requiresHumanConfirmation: true,
  };

  return callGemini(prompt, fallback, "orchestrator.synthesiseActionPlan");
}

/**
 * Calls Gemini to assess a CCTV anomaly score and recommend security response.
 *
 * @param {Object} context - Zone ID, anomaly label, score, current density, nearby volunteers
 * @returns {Promise<Object>} Security assessment with severity, recommended_response,
 *   escalate_to_orchestrator, reasoning
 */
async function assessCctvAnomaly(context) {
  const prompt = `
Assess a CCTV anomaly detection result for stadium security.

Zone: ${context.zoneId}
Anomaly label: ${context.anomalyLabel}
Confidence score: ${context.score} (threshold for alert: 0.7)
Current zone density: ${context.density}%
Available volunteers in zone: ${context.volunteersInZone}
Match phase: ${context.matchPhase}

Return a JSON object with exactly these fields:
{
  "severity": "high",
  "recommended_response": "Dispatch 2 security personnel to zone_7 immediately",
  "escalate_to_orchestrator": true,
  "reasoning": "Aggression label with score 0.89 in a zone at 72% density requires immediate response..."
}

severity must be one of: low, medium, high, critical
escalate_to_orchestrator should be true for high or critical severity
`;

  const fallback = {
    severity: "medium",
    recommended_response: "Manual security check required — AI unavailable.",
    escalate_to_orchestrator: false,
    reasoning: "Gemini unavailable — flagging for manual review.",
  };

  return callGemini(prompt, fallback, "securityAgent.assessCctvAnomaly");
}

module.exports = {
  callGemini,
  predictSurge,
  assessWeatherRisk,
  generateEvacuationPlan,
  synthesiseActionPlan,
  assessCctvAnomaly,
};
