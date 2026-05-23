/**
 * @fileoverview Google Maps Platform service for CrowdCommand.
 * Handles exit route calculation for SOS responses, avoiding high-density zones.
 * Falls back to straight-line routing if the Maps API is unavailable.
 */

const axios = require("axios");
const config = require("../config");
const { findNearestGate, haversineDistance } = require("../utils/geoUtils");

/**
 * @typedef {Object} RouteStep
 * @property {string} instruction - Human-readable direction
 * @property {number} distanceMetres - Distance of this step
 * @property {{lat: number, lng: number}} startLocation - Step start coordinate
 * @property {{lat: number, lng: number}} endLocation - Step end coordinate
 */

/**
 * @typedef {Object} ExitRoute
 * @property {string} gateId - Recommended exit gate ID
 * @property {string} gateName - Human-readable gate name
 * @property {number} totalDistanceMetres - Total route distance
 * @property {number} estimatedWalkMinutes - Estimated walk time
 * @property {Array<RouteStep>} steps - Turn-by-turn steps
 * @property {Array<{lat: number, lng: number}>} polyline - Route polyline points
 * @property {string} source - "maps_api" | "fallback"
 */

/**
 * Calculates the safest exit route for a fan from their current position.
 * Selects the nearest gate that avoids zones with density above the safety threshold.
 * Makes a Google Maps Directions API call for turn-by-turn routing.
 * Falls back to straight-line route if the API fails.
 *
 * @param {number} fanLat - Fan's current latitude
 * @param {number} fanLng - Fan's current longitude
 * @param {Array<Object>} zoneDensities - Array of zone objects with id and density fields
 * @param {Object} [options] - Routing options
 * @param {number} [options.densityThreshold=70] - Zones above this density are avoided
 * @param {boolean} [options.coveredOnly=false] - If true, only route to covered gates
 * @returns {Promise<ExitRoute>} Calculated exit route
 */
async function calculateExitRoute(fanLat, fanLng, zoneDensities, options = {}) {
  const { densityThreshold = 70, coveredOnly = false } = options;

  // Identify which gates serve high-density zones — exclude those
  const highDensityZoneIds = zoneDensities
    .filter((z) => z.density >= densityThreshold)
    .map((z) => z.id);

  const excludeGates = config.gates
    .filter((g) => g.zones.some((z) => highDensityZoneIds.includes(z)))
    .map((g) => g.id);

  const targetGate = findNearestGate(fanLat, fanLng, { coveredOnly, excludeGates });

  // If all gates are excluded, fall back to nearest gate regardless of density
  const gate = targetGate || findNearestGate(fanLat, fanLng, {});

  if (!gate) {
    return buildFallbackRoute(fanLat, fanLng, null);
  }

  // Try Google Maps Directions API
  if (config.apis.googleMaps) {
    try {
      const url = "https://maps.googleapis.com/maps/api/directions/json";
      const params = {
        origin: `${fanLat},${fanLng}`,
        destination: `${gate.lat},${gate.lng}`,
        mode: "walking",
        key: config.apis.googleMaps,
      };

      const response = await axios.get(url, { params, timeout: 5000 });
      const data = response.data;

      if (data.status === "OK" && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const leg = route.legs[0];

        const steps = (leg.steps || []).map((step) => ({
          instruction: step.html_instructions.replace(/<[^>]*>/g, ""),
          distanceMetres: step.distance ? step.distance.value : 0,
          startLocation: step.start_location,
          endLocation: step.end_location,
        }));

        const polyline = decodePolyline(route.overview_polyline.points);

        return {
          gateId: gate.id,
          gateName: gate.name,
          totalDistanceMetres: leg.distance ? leg.distance.value : gate.distanceMetres,
          estimatedWalkMinutes: leg.duration ? Math.ceil(leg.duration.value / 60) : estimateWalkTime(gate.distanceMetres),
          steps,
          polyline,
          source: "maps_api",
          destinationLat: gate.lat,
          destinationLng: gate.lng,
        };
      }
    } catch (err) {
      console.error(
        `[mapsService.calculateExitRoute] Maps API call failed, using fallback. error=${err.message}`
      );
    }
  }

  return buildFallbackRoute(fanLat, fanLng, gate);
}

/**
 * Builds a straight-line fallback route when the Maps API is unavailable.
 *
 * @param {number} fanLat - Fan latitude
 * @param {number} fanLng - Fan longitude
 * @param {Object|null} gate - Target gate config object
 * @returns {ExitRoute} Fallback route with minimal steps
 */
function buildFallbackRoute(fanLat, fanLng, gate) {
  if (!gate) {
    return {
      gateId: "gate_a",
      gateName: "Gate A",
      totalDistanceMetres: 150,
      estimatedWalkMinutes: 3,
      steps: [{ instruction: "Proceed to the nearest exit following staff directions", distanceMetres: 150, startLocation: { lat: fanLat, lng: fanLng }, endLocation: { lat: fanLat, lng: fanLng } }],
      polyline: [{ lat: fanLat, lng: fanLng }],
      source: "fallback",
      destinationLat: fanLat,
      destinationLng: fanLng,
    };
  }

  const distanceMetres = haversineDistance(fanLat, fanLng, gate.lat, gate.lng);

  return {
    gateId: gate.id,
    gateName: gate.name,
    totalDistanceMetres: Math.round(distanceMetres),
    estimatedWalkMinutes: estimateWalkTime(distanceMetres),
    steps: [
      {
        instruction: `Head to ${gate.name} — follow the green signs or staff directions`,
        distanceMetres: Math.round(distanceMetres),
        startLocation: { lat: fanLat, lng: fanLng },
        endLocation: { lat: gate.lat, lng: gate.lng },
      },
    ],
    polyline: [
      { lat: fanLat, lng: fanLng },
      { lat: gate.lat, lng: gate.lng },
    ],
    source: "fallback",
    destinationLat: gate.lat,
    destinationLng: gate.lng,
  };
}

/**
 * Estimates walk time based on distance, assuming 1.2 m/s walking speed in a crowd.
 *
 * @param {number} distanceMetres - Distance in metres
 * @returns {number} Estimated walk time in minutes (minimum 1)
 */
function estimateWalkTime(distanceMetres) {
  const walkSpeedMetresPerSecond = 1.2;
  return Math.max(1, Math.ceil(distanceMetres / walkSpeedMetresPerSecond / 60));
}

/**
 * Decodes a Google Maps encoded polyline string into an array of coordinates.
 * Reference: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 *
 * @param {string} encoded - Encoded polyline string
 * @returns {Array<{lat: number, lng: number}>} Decoded coordinate array
 */
function decodePolyline(encoded) {
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

/**
 * Returns the nearest gate information for a given coordinate.
 * Lightweight wrapper used by the fan PWA ExitGuide without full routing.
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {Object} [options] - Options passed to findNearestGate
 * @returns {Object|null} Nearest gate config object
 */
function getNearestGate(lat, lng, options = {}) {
  return findNearestGate(lat, lng, options);
}

/**
 * Builds a Google Maps embed URL for rendering in the fan PWA.
 * Used by SOSActive and ExitGuide components.
 *
 * @param {number} originLat - Fan origin latitude
 * @param {number} originLng - Fan origin longitude
 * @param {number} destLat - Destination latitude
 * @param {number} destLng - Destination longitude
 * @returns {string} Google Maps embed URL
 */
function buildMapsEmbedUrl(originLat, originLng, destLat, destLng) {
  const apiKey = config.apis.googleMaps;
  if (!apiKey) {
    return `https://www.google.com/maps/dir/${originLat},${originLng}/${destLat},${destLng}/`;
  }
  return (
    `https://www.google.com/maps/embed/v1/directions` +
    `?key=${apiKey}` +
    `&origin=${originLat},${originLng}` +
    `&destination=${destLat},${destLng}` +
    `&mode=walking`
  );
}

module.exports = {
  calculateExitRoute,
  getNearestGate,
  buildMapsEmbedUrl,
  decodePolyline,
  estimateWalkTime,
};
