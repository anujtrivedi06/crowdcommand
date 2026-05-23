/**
 * @fileoverview Geospatial utility functions for CrowdCommand.
 * Used by SOS routing, volunteer dispatch, and cluster detection.
 * All coordinates are in decimal degrees (WGS84).
 */

const config = require("../config");

/**
 * Calculates the Haversine distance between two GPS coordinates.
 * More accurate than Euclidean distance for geographic points.
 *
 * @param {number} lat1 - Latitude of point A in decimal degrees
 * @param {number} lng1 - Longitude of point A in decimal degrees
 * @param {number} lat2 - Latitude of point B in decimal degrees
 * @param {number} lng2 - Longitude of point B in decimal degrees
 * @returns {number} Distance in metres
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in metres
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculates Euclidean (flat-earth) distance between two points.
 * Faster than Haversine; acceptable for small distances (<1km) within a stadium.
 * Used for quick volunteer proximity sorting.
 *
 * @param {number} lat1 - Latitude of point A
 * @param {number} lng1 - Longitude of point A
 * @param {number} lat2 - Latitude of point B
 * @param {number} lng2 - Longitude of point B
 * @returns {number} Approximate distance in metres
 */
function euclideanDistance(lat1, lng1, lat2, lng2) {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos((lat1 * Math.PI) / 180);
  const dy = (lat2 - lat1) * metersPerDegreeLat;
  const dx = (lng2 - lng1) * metersPerDegreeLng;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Checks whether a GPS coordinate falls within a circular geofence.
 *
 * @param {number} pointLat - Latitude of the point to test
 * @param {number} pointLng - Longitude of the point to test
 * @param {number} centreLat - Latitude of the geofence centre
 * @param {number} centreLng - Longitude of the geofence centre
 * @param {number} radiusMetres - Geofence radius in metres
 * @returns {boolean} True if the point is within the geofence
 */
function isWithinGeofence(pointLat, pointLng, centreLat, centreLng, radiusMetres) {
  const distance = haversineDistance(pointLat, pointLng, centreLat, centreLng);
  return distance <= radiusMetres;
}

/**
 * Determines which stadium zone a given GPS coordinate belongs to.
 * Finds the zone whose centre is closest to the coordinate.
 *
 * @param {number} lat - Latitude of the point
 * @param {number} lng - Longitude of the point
 * @returns {string|null} Zone ID (e.g. "zone_3") or null if outside stadium bounds
 */
function getZoneForCoordinate(lat, lng) {
  const stadiumRadiusMetres = 300; // M. Chinnaswamy Stadium approximate radius

  // First check if within stadium bounds at all
  const distanceFromCentre = haversineDistance(
    lat,
    lng,
    config.stadium.lat,
    config.stadium.lng
  );

  if (distanceFromCentre > stadiumRadiusMetres) {
    return null;
  }

  let closestZone = null;
  let minDistance = Infinity;

  for (const [zoneId, centre] of Object.entries(config.zoneCentres)) {
    const dist = euclideanDistance(lat, lng, centre.lat, centre.lng);
    if (dist < minDistance) {
      minDistance = dist;
      closestZone = zoneId;
    }
  }

  return closestZone;
}

/**
 * Finds the N nearest volunteers to a target location.
 * Filters by status and optionally by role before sorting by distance.
 *
 * @param {Array<Object>} volunteers - Array of volunteer documents from Firestore
 * @param {number} targetLat - Latitude of the target location
 * @param {number} targetLng - Longitude of the target location
 * @param {number} count - Number of nearest volunteers to return
 * @param {Object} [options] - Filter options
 * @param {string} [options.status="available"] - Required volunteer status
 * @param {string} [options.role] - Required volunteer role (e.g. "security")
 * @returns {Array<Object>} Sorted array of up to `count` volunteers with distance field added
 */
function findNearestVolunteers(volunteers, targetLat, targetLng, count, options = {}) {
  const { status = "available", role } = options;

  const filtered = volunteers.filter((v) => {
    if (v.status !== status) return false;
    if (role && v.role !== role) return false;
    if (!v.location || v.location.lat == null || v.location.lng == null) return false;
    return true;
  });

  const withDistances = filtered.map((v) => ({
    ...v,
    distanceMetres: euclideanDistance(
      targetLat,
      targetLng,
      v.location.lat,
      v.location.lng
    ),
  }));

  withDistances.sort((a, b) => a.distanceMetres - b.distanceMetres);

  return withDistances.slice(0, count);
}

/**
 * Groups an array of coordinate points into clusters by proximity.
 * Uses a simple radius-based grouping: any point within radiusMetres of an
 * existing cluster centre is added to that cluster.
 *
 * @param {Array<Object>} points - Array of objects with lat and lng fields
 * @param {number} radiusMetres - Maximum distance to be considered part of a cluster
 * @returns {Array<Array<Object>>} Array of clusters, each cluster is an array of points
 */
function clusterByProximity(points, radiusMetres) {
  if (!points || points.length === 0) return [];

  const clusters = [];
  const assigned = new Set();

  for (let i = 0; i < points.length; i++) {
    if (assigned.has(i)) continue;

    const cluster = [points[i]];
    assigned.add(i);

    for (let j = i + 1; j < points.length; j++) {
      if (assigned.has(j)) continue;

      const dist = haversineDistance(
        points[i].lat,
        points[i].lng,
        points[j].lat,
        points[j].lng
      );

      if (dist <= radiusMetres) {
        cluster.push(points[j]);
        assigned.add(j);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

/**
 * Calculates the centroid (geographic centre) of a set of points.
 *
 * @param {Array<Object>} points - Array of objects with lat and lng fields
 * @returns {{lat: number, lng: number}} Centroid coordinates
 */
function calculateCentroid(points) {
  if (!points || points.length === 0) {
    return { lat: config.stadium.lat, lng: config.stadium.lng };
  }

  const sum = points.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 }
  );

  return {
    lat: sum.lat / points.length,
    lng: sum.lng / points.length,
  };
}

/**
 * Finds the nearest gate to a given coordinate, optionally filtered by coverage.
 *
 * @param {number} lat - Latitude of the point
 * @param {number} lng - Longitude of the point
 * @param {Object} [options] - Filter options
 * @param {boolean} [options.coveredOnly=false] - If true, only return covered gates
 * @param {Array<string>} [options.excludeGates=[]] - Gate IDs to exclude from results
 * @returns {Object|null} Nearest gate config object or null if none found
 */
function findNearestGate(lat, lng, options = {}) {
  const { coveredOnly = false, excludeGates = [] } = options;

  let gates = config.gates.filter((g) => !excludeGates.includes(g.id));
  if (coveredOnly) {
    gates = gates.filter((g) => g.covered);
  }

  if (gates.length === 0) return null;

  let nearest = null;
  let minDist = Infinity;

  for (const gate of gates) {
    const dist = euclideanDistance(lat, lng, gate.lat, gate.lng);
    if (dist < minDist) {
      minDist = dist;
      nearest = { ...gate, distanceMetres: dist };
    }
  }

  return nearest;
}

/**
 * Linearly interpolates between two coordinates.
 * Used for animating a responder moving toward a fan in SOSActive.
 *
 * @param {number} lat1 - Start latitude
 * @param {number} lng1 - Start longitude
 * @param {number} lat2 - End latitude
 * @param {number} lng2 - End longitude
 * @param {number} t - Interpolation factor (0.0 = start, 1.0 = end)
 * @returns {{lat: number, lng: number}} Interpolated coordinate
 */
function lerpCoordinate(lat1, lng1, lat2, lng2, t) {
  const clampedT = Math.max(0, Math.min(1, t));
  return {
    lat: lat1 + (lat2 - lat1) * clampedT,
    lng: lng1 + (lng2 - lng1) * clampedT,
  };
}

module.exports = {
  haversineDistance,
  euclideanDistance,
  isWithinGeofence,
  getZoneForCoordinate,
  findNearestVolunteers,
  clusterByProximity,
  calculateCentroid,
  findNearestGate,
  lerpCoordinate,
};
