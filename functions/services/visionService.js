/**
 * @fileoverview Vision AI service for CrowdCommand CCTV anomaly detection.
 * Controlled by USE_MOCK_VISION flag in config.js.
 * When true (default): returns deterministic mock scores for reliable demo operation.
 * When false: calls the real Google Cloud Vision AI API with CCTV frame data.
 */

const vision = require("@google-cloud/vision");
const config = require("../config");

let visionClient = null;

/**
 * Returns a singleton Vision AI client.
 * Only instantiated when USE_MOCK_VISION is false.
 * @returns {vision.ImageAnnotatorClient}
 */
function getVisionClient() {
  if (!visionClient) {
    visionClient = new vision.ImageAnnotatorClient({
      projectId: config.project.id,
    });
  }
  return visionClient;
}

/**
 * @typedef {Object} CctvScore
 * @property {string} zoneId - Zone that was scored
 * @property {string} label - Detected label: "normal" or anomaly type
 * @property {number} score - Confidence score 0.0–1.0
 * @property {boolean} isAnomaly - True if score exceeds the alert threshold
 * @property {string} source - "mock" | "vision_api"
 * @property {string} isoTimestamp - When the score was generated
 */

/**
 * Generates a mock CCTV anomaly score for a zone.
 * Distribution: 85% chance "normal" with score 0.1, 15% chance anomaly with score 0.7–0.95.
 * Deterministic per zone per minute — uses zone number and minute floor as seed
 * so the dashboard doesn't flicker on every call within the same minute.
 *
 * @param {string} zoneId - Zone ID to score (e.g. "zone_7")
 * @returns {CctvScore} Mock score result
 */
function generateMockScore(zoneId) {
  const zoneNumber = parseInt(zoneId.replace("zone_", ""), 10) || 1;
  const minuteSeed = Math.floor(Date.now() / 60000);

  // Pseudo-random but stable within a minute window
  const seed = (zoneNumber * 1000 + minuteSeed) % 100;
  const isAnomaly = seed < 15; // 15% chance

  if (!isAnomaly) {
    return {
      zoneId,
      label: "normal",
      score: 0.1,
      isAnomaly: false,
      source: "mock",
      isoTimestamp: new Date().toISOString(),
    };
  }

  // Select anomaly label using zone number as stable index
  const labelIndex = zoneNumber % config.cctvAnomalyLabels.length;
  const label = config.cctvAnomalyLabels[labelIndex];

  // Score between 0.70 and 0.95
  const score = parseFloat((0.70 + (seed % 26) / 100).toFixed(2));

  return {
    zoneId,
    label,
    score,
    isAnomaly: score >= config.thresholds.cctvAnomalyScore,
    source: "mock",
    isoTimestamp: new Date().toISOString(),
  };
}

/**
 * Calls the real Google Cloud Vision AI API to analyse a CCTV frame.
 * Expects a base64-encoded JPEG or PNG frame from the camera feed.
 * Maps Vision AI label annotations to CrowdCommand anomaly categories.
 *
 * @param {string} zoneId - Zone ID being analysed
 * @param {string} base64Frame - Base64-encoded image frame
 * @returns {Promise<CctvScore>} Vision AI score result
 */
async function scoreWithVisionApi(zoneId, base64Frame) {
  try {
    const client = getVisionClient();

    const [result] = await client.labelDetection({
      image: { content: base64Frame },
    });

    const labels = result.labelAnnotations || [];

    // Map Vision AI labels to CrowdCommand anomaly categories
    const anomalyKeywords = {
      crowd_surge: ["crowd", "mob", "rush", "crush", "stampede", "surge"],
      abandoned_object: ["bag", "luggage", "package", "unattended", "abandoned"],
      aggression: ["fight", "violence", "aggression", "conflict", "altercation"],
    };

    let detectedLabel = "normal";
    let maxScore = 0.1;

    for (const annotation of labels) {
      const descLower = (annotation.description || "").toLowerCase();
      const confidence = annotation.score || 0;

      for (const [anomalyType, keywords] of Object.entries(anomalyKeywords)) {
        if (keywords.some((kw) => descLower.includes(kw))) {
          if (confidence > maxScore) {
            maxScore = confidence;
            detectedLabel = anomalyType;
          }
        }
      }
    }

    return {
      zoneId,
      label: detectedLabel,
      score: parseFloat(maxScore.toFixed(2)),
      isAnomaly: detectedLabel !== "normal" && maxScore >= config.thresholds.cctvAnomalyScore,
      source: "vision_api",
      isoTimestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error(
      `[visionService.scoreWithVisionApi] Vision API call failed. zoneId=${zoneId} error=${err.message}`
    );
    // Fall back to mock on API failure
    const mockResult = generateMockScore(zoneId);
    return { ...mockResult, source: "vision_api_fallback" };
  }
}

/**
 * Main entry point for CCTV frame scoring.
 * Routes to mock or real Vision AI based on USE_MOCK_VISION config flag.
 * This is the function called by securityAgent.js on its 30-second schedule.
 *
 * @param {string} zoneId - Zone ID to score
 * @param {string} [base64Frame] - Base64 image frame (required when USE_MOCK_VISION=false)
 * @returns {Promise<CctvScore>} Score result from mock or Vision AI
 */
async function scoreCCTVFrame(zoneId, base64Frame) {
  if (config.flags.useMockVision) {
    return generateMockScore(zoneId);
  }

  if (!base64Frame) {
    console.error(
      `[visionService.scoreCCTVFrame] USE_MOCK_VISION=false but no frame provided. zoneId=${zoneId} — falling back to mock`
    );
    return generateMockScore(zoneId);
  }

  return scoreWithVisionApi(zoneId, base64Frame);
}

/**
 * Scores all 12 stadium zones in a single batch call.
 * Used by the securityAgent scheduled function.
 * Runs all zone scores concurrently with Promise.allSettled for resilience.
 *
 * @param {Object} [frameMap={}] - Map of zoneId to base64Frame (for real Vision AI mode)
 * @returns {Promise<Array<CctvScore>>} Array of scores for all zones
 */
async function scoreAllZones(frameMap = {}) {
  const zoneIds = Object.keys(config.zoneCentres);

  const results = await Promise.allSettled(
    zoneIds.map((zoneId) => scoreCCTVFrame(zoneId, frameMap[zoneId]))
  );

  return results.map((result, i) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    // Individual zone failure — return a safe normal score
    console.error(
      `[visionService.scoreAllZones] Zone scoring failed. zoneId=${zoneIds[i]} error=${result.reason}`
    );
    return {
      zoneId: zoneIds[i],
      label: "normal",
      score: 0.0,
      isAnomaly: false,
      source: "error_fallback",
      isoTimestamp: new Date().toISOString(),
    };
  });
}

module.exports = {
  scoreCCTVFrame,
  scoreAllZones,
  generateMockScore,
};
