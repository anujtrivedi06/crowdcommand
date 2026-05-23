import { useState, useEffect, useRef, useCallback } from 'react';
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  where,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Alert severity levels for display prioritisation.
 */
export const SEVERITY = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};

/**
 * Alert type categories for colour-coding in AlertFeed.
 */
export const ALERT_TYPE = {
  SURGE_PREDICTION: 'surge_prediction',
  WEATHER_REROUTE: 'weather_reroute',
  SECURITY: 'security',
  FRAUD: 'fraud',
  SOS: 'sos',
  SOS_CLUSTER: 'sos_cluster',
  EVACUATION: 'evacuation',
  GATE_REROUTE: 'gate_reroute',
  SYSTEM: 'system',
};

/**
 * Returns a CSS colour token for a given alert type.
 * @param {string} type - Alert type from ALERT_TYPE.
 * @returns {string} Tailwind colour class prefix.
 */
export function getAlertColour(type) {
  const map = {
    [ALERT_TYPE.SURGE_PREDICTION]: 'orange',
    [ALERT_TYPE.WEATHER_REROUTE]: 'yellow',
    [ALERT_TYPE.SECURITY]: 'red',
    [ALERT_TYPE.FRAUD]: 'amber',
    [ALERT_TYPE.SOS]: 'red',
    [ALERT_TYPE.SOS_CLUSTER]: 'red',
    [ALERT_TYPE.EVACUATION]: 'red',
    [ALERT_TYPE.GATE_REROUTE]: 'blue',
    [ALERT_TYPE.SYSTEM]: 'gray',
  };
  return map[type] || 'gray';
}

/**
 * Returns a human-readable label for an alert type.
 * @param {string} type - Alert type from ALERT_TYPE.
 * @returns {string} Display label.
 */
export function getAlertLabel(type) {
  const map = {
    [ALERT_TYPE.SURGE_PREDICTION]: 'Surge Prediction',
    [ALERT_TYPE.WEATHER_REROUTE]: 'Weather Reroute',
    [ALERT_TYPE.SECURITY]: 'Security Alert',
    [ALERT_TYPE.FRAUD]: 'Fraud Detected',
    [ALERT_TYPE.SOS]: 'SOS Incident',
    [ALERT_TYPE.SOS_CLUSTER]: 'SOS Cluster',
    [ALERT_TYPE.EVACUATION]: 'Evacuation',
    [ALERT_TYPE.GATE_REROUTE]: 'Gate Reroute',
    [ALERT_TYPE.SYSTEM]: 'System',
  };
  return map[type] || type;
}

/**
 * Merges and deduplicates alerts from multiple Firestore sources,
 * sorted by timestamp descending. Normalises each document to a
 * common shape so AlertFeed only needs to handle one format.
 *
 * @param {Array} alerts       - Documents from `alerts` collection.
 * @param {Array} securityAlerts - Documents from `security_alerts`.
 * @param {Array} fraudAlerts  - Documents from `fraud_alerts`.
 * @param {Array} sosList      - Documents from `sos` (active only).
 * @returns {Array} Merged, sorted, normalised alert array.
 */
function mergeAlerts(alerts, securityAlerts, fraudAlerts, sosList) {
  const normalise = (doc, typeOverride) => ({
    id: doc.id,
    type: typeOverride || doc.type || ALERT_TYPE.SYSTEM,
    severity: doc.severity || doc.risk_level || SEVERITY.MEDIUM,
    message:
      doc.message ||
      doc.reasoning ||
      doc.details ||
      doc.reason ||
      'No details available.',
    affectedZones: doc.affected_zones || doc.affectedZones || doc.zone ? [doc.zone] : [],
    timestamp: doc.timestamp || doc.createdAt || null,
    raw: doc,
  });

  const merged = [
    ...alerts.map((d) => normalise(d, d.type)),
    ...securityAlerts.map((d) => normalise(d, ALERT_TYPE.SECURITY)),
    ...fraudAlerts.map((d) => normalise(d, ALERT_TYPE.FRAUD)),
    ...sosList.map((d) => normalise(d, ALERT_TYPE.SOS)),
  ];

  // Deduplicate by id
  const seen = new Set();
  const unique = merged.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  // Sort newest first — handle Firestore Timestamps and plain dates
  unique.sort((a, b) => {
    const ta = a.timestamp?.toMillis ? a.timestamp.toMillis() : new Date(a.timestamp).getTime();
    const tb = b.timestamp?.toMillis ? b.timestamp.toMillis() : new Date(b.timestamp).getTime();
    return tb - ta;
  });

  return unique;
}

/**
 * useAgentAlerts — subscribes to all alert-related Firestore collections
 * and returns a unified, sorted, normalised alert stream.
 *
 * @param {object} options
 * @param {number} [options.maxAlerts=60]  - Maximum alerts to keep in state.
 * @param {boolean} [options.activeOnly=false] - If true, only return alerts from last 30 minutes.
 * @returns {{
 *   alerts: Array,
 *   criticalCount: number,
 *   unreadCount: number,
 *   markAllRead: function,
 *   loading: boolean,
 *   error: string|null
 * }}
 */
export function useAgentAlerts({ maxAlerts = 60, activeOnly = false } = {}) {
  const [alerts, setAlerts] = useState([]);
  const [securityAlerts, setSecurityAlerts] = useState([]);
  const [fraudAlerts, setFraudAlerts] = useState([]);
  const [sosList, setSosList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [readIds, setReadIds] = useState(new Set());

  const loadingFlags = useRef({ alerts: true, security: true, fraud: true, sos: true });

  const checkAllLoaded = useCallback(() => {
    const flags = loadingFlags.current;
    if (!flags.alerts && !flags.security && !flags.fraud && !flags.sos) {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const windowStart = activeOnly
      ? Timestamp.fromMillis(Date.now() - 30 * 60 * 1000)
      : null;

    // --- alerts collection ---
    const alertConstraints = [orderBy('timestamp', 'desc'), limit(maxAlerts)];
    if (windowStart) alertConstraints.push(where('timestamp', '>=', windowStart));
    const alertsUnsub = onSnapshot(
      query(collection(db, 'alerts'), ...alertConstraints),
      (snap) => {
        setAlerts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        loadingFlags.current.alerts = false;
        checkAllLoaded();
      },
      (err) => {
        console.error('[useAgentAlerts] alerts error:', err);
        setError(err.message);
        loadingFlags.current.alerts = false;
        checkAllLoaded();
      }
    );

    // --- security_alerts collection ---
    const secConstraints = [orderBy('timestamp', 'desc'), limit(30)];
    const secUnsub = onSnapshot(
      query(collection(db, 'security_alerts'), ...secConstraints),
      (snap) => {
        setSecurityAlerts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        loadingFlags.current.security = false;
        checkAllLoaded();
      },
      (err) => {
        console.error('[useAgentAlerts] security_alerts error:', err);
        loadingFlags.current.security = false;
        checkAllLoaded();
      }
    );

    // --- fraud_alerts collection ---
    const fraudConstraints = [orderBy('timestamp', 'desc'), limit(30)];
    const fraudUnsub = onSnapshot(
      query(collection(db, 'fraud_alerts'), ...fraudConstraints),
      (snap) => {
        setFraudAlerts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        loadingFlags.current.fraud = false;
        checkAllLoaded();
      },
      (err) => {
        console.error('[useAgentAlerts] fraud_alerts error:', err);
        loadingFlags.current.fraud = false;
        checkAllLoaded();
      }
    );

    // --- sos collection (active only) ---
    const sosUnsub = onSnapshot(
      query(
        collection(db, 'sos'),
        where('status', '==', 'active'),
        orderBy('createdAt', 'desc'),
        limit(20)
      ),
      (snap) => {
        setSosList(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        loadingFlags.current.sos = false;
        checkAllLoaded();
      },
      (err) => {
        console.error('[useAgentAlerts] sos error:', err);
        loadingFlags.current.sos = false;
        checkAllLoaded();
      }
    );

    return () => {
      alertsUnsub();
      secUnsub();
      fraudUnsub();
      sosUnsub();
    };
  }, [maxAlerts, activeOnly, checkAllLoaded]);

  const merged = mergeAlerts(alerts, securityAlerts, fraudAlerts, sosList).slice(0, maxAlerts);

  const criticalCount = merged.filter(
    (a) => a.severity === SEVERITY.CRITICAL || a.type === ALERT_TYPE.SOS_CLUSTER || a.type === ALERT_TYPE.EVACUATION
  ).length;

  const unreadCount = merged.filter((a) => !readIds.has(a.id)).length;

  const markAllRead = useCallback(() => {
    setReadIds(new Set(merged.map((a) => a.id)));
  }, [merged]);

  return {
    alerts: merged,
    criticalCount,
    unreadCount,
    markAllRead,
    loading,
    error,
  };
}