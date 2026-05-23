import { useState, useEffect, useRef } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  limit,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Generic real-time Firestore collection listener.
 * @param {string} collectionPath - Firestore collection path.
 * @param {Array} queryConstraints - Optional Firestore query constraints.
 * @returns {{ data: Array, loading: boolean, error: string|null }}
 */
export function useCollection(collectionPath, queryConstraints = []) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!collectionPath) return;

    let q;
    try {
      q = query(collection(db, collectionPath), ...queryConstraints);
    } catch (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setData(docs);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error(`[useCollection] Error on ${collectionPath}:`, err);
        setError(err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionPath]);

  return { data, loading, error };
}

/**
 * Backward-compatible generic hook alias used by older components.
 * @param {string} collectionPath - Firestore collection path.
 * @param {{ where?: Array<[string, import('firebase/firestore').WhereFilterOp, any]>, orderBy?: [string, 'asc'|'desc'] }} [options]
 * @returns {{ data: Array, loading: boolean, error: string|null }}
 */
export function useFirestore(collectionPath, options = {}) {
  const constraints = [];

  if (Array.isArray(options.where)) {
    options.where.forEach(([field, op, value]) => {
      constraints.push(where(field, op, value));
    });
  }

  if (Array.isArray(options.orderBy) && options.orderBy.length > 0) {
    const [field, direction = 'desc'] = options.orderBy;
    constraints.push(orderBy(field, direction));
  }

  return useCollection(collectionPath, constraints);
}

/**
 * Real-time Firestore single document listener.
 * @param {string} docPath - Full Firestore document path (e.g. "config/matchState").
 * @returns {{ data: object|null, loading: boolean, error: string|null }}
 */
export function useDocument(docPath) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!docPath) return;

    const ref = doc(db, docPath);
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        if (snapshot.exists()) {
          setData({ id: snapshot.id, ...snapshot.data() });
        } else {
          setData(null);
        }
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error(`[useDocument] Error on ${docPath}:`, err);
        setError(err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [docPath]);

  return { data, loading, error };
}

/**
 * Real-time listener for the zones collection (all 12 zones).
 * @returns {{ zones: Array, loading: boolean, error: string|null }}
 */
export function useZones() {
  const { data, loading, error } = useCollection('zones');
  return { zones: data, loading, error };
}

/**
 * Real-time listener for the alerts collection, newest first, capped at 50.
 * @returns {{ alerts: Array, loading: boolean, error: string|null }}
 */
export function useAlerts() {
  const constraintsRef = useRef([orderBy('timestamp', 'desc'), limit(50)]);
  const { data, loading, error } = useCollection('alerts', constraintsRef.current);
  return { alerts: data, loading, error };
}

/**
 * Real-time listener for active SOS incidents.
 * @returns {{ sosList: Array, loading: boolean, error: string|null }}
 */
export function useActiveSOS() {
  const constraintsRef = useRef([
    where('status', '==', 'active'),
    orderBy('createdAt', 'desc'),
  ]);
  const { data, loading, error } = useCollection('sos', constraintsRef.current);
  return { sosList: data, loading, error };
}

/**
 * Real-time listener for volunteer documents.
 * @returns {{ volunteers: Array, loading: boolean, error: string|null }}
 */
export function useVolunteers() {
  const { data, loading, error } = useCollection('volunteers');
  return { volunteers: data, loading, error };
}

/**
 * Real-time listener for the audit log, newest first, capped at 100.
 * @returns {{ auditLog: Array, loading: boolean, error: string|null }}
 */
export function useAuditLog() {
  const constraintsRef = useRef([orderBy('timestamp', 'desc'), limit(100)]);
  const { data, loading, error } = useCollection('audit_log', constraintsRef.current);
  return { auditLog: data, loading, error };
}

/**
 * Real-time listener for the current evacuation plan.
 * @returns {{ evacPlan: object|null, loading: boolean, error: string|null }}
 */
export function useEvacPlan() {
  const { data, loading, error } = useDocument('evacuation/current');
  return { evacPlan: data, loading, error };
}

/**
 * Real-time listener for match state config.
 * @returns {{ matchState: object|null, loading: boolean, error: string|null }}
 */
export function useMatchState() {
  const { data, loading, error } = useDocument('config/matchState');
  return { matchState: data, loading, error };
}

/**
 * Real-time listener for security alerts, newest first, capped at 30.
 * @returns {{ securityAlerts: Array, loading: boolean, error: string|null }}
 */
export function useSecurityAlerts() {
  const constraintsRef = useRef([orderBy('timestamp', 'desc'), limit(30)]);
  const { data, loading, error } = useCollection('security_alerts', constraintsRef.current);
  return { securityAlerts: data, loading, error };
}

/**
 * Real-time listener for fraud alerts, newest first, capped at 30.
 * @returns {{ fraudAlerts: Array, loading: boolean, error: string|null }}
 */
export function useFraudAlerts() {
  const constraintsRef = useRef([orderBy('timestamp', 'desc'), limit(30)]);
  const { data, loading, error } = useCollection('fraud_alerts', constraintsRef.current);
  return { fraudAlerts: data, loading, error };
}

/**
 * Real-time listener for the current actions document.
 * @returns {{ currentAction: object|null, loading: boolean, error: string|null }}
 */
export function useCurrentAction() {
  const { data, loading, error } = useDocument('actions/current');
  return { currentAction: data, loading, error };
}

/**
 * Real-time listener for the wave sequence document.
 * @returns {{ waveSequence: object|null, loading: boolean, error: string|null }}
 */
export function useWaveSequence() {
  const { data, loading, error } = useDocument('config/wave_sequence');
  return { waveSequence: data, loading, error };
}