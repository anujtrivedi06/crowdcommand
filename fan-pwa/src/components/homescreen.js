import React, { useEffect, useState } from 'react';
import { db } from '../firebase';
import { collection, doc, onSnapshot, query, where, limit, orderBy } from 'firebase/firestore';
import { t } from '../i18n';
import { getMatchState } from '../services/api';

/**
 * HomeScreen component
 * The landing screen of the fan PWA. Shows:
 * - Stadium name and match phase
 * - Fan's assigned gate with current density
 * - Active alerts relevant to the fan's zone
 * - Stadium occupancy indicator
 *
 * All data is sourced from Firestore via real-time onSnapshot listeners
 * so the screen always reflects the current stadium state without refresh.
 *
 * @param {{ fanId: string, gateId: string, lang: string }} props
 * @returns {JSX.Element}
 */
const HomeScreen = ({ fanId, gateId, lang }) => {
  const [matchState, setMatchState] = useState(null);
  const [gateData, setGateData] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  // ── Match state listener ──────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'config', 'matchState'),
      (snap) => {
        if (snap.exists()) setMatchState(snap.data());
        setLoading(false);
      },
      (err) => {
        console.error('[HomeScreen] matchState listener error:', err.message);
        // Fallback: fetch once via HTTP
        getMatchState()
          .then((data) => setMatchState(data))
          .catch(() => {})
          .finally(() => setLoading(false));
      }
    );
    return () => unsub();
  }, []);

  // ── Gate data listener ────────────────────────────────────────────────────
  useEffect(() => {
    if (!gateId) return;
    const unsub = onSnapshot(
      doc(db, 'zones', String(gateId)),
      (snap) => {
        if (snap.exists()) setGateData({ id: snap.id, ...snap.data() });
      },
      (err) => console.error('[HomeScreen] gate listener error:', err.message)
    );
    return () => unsub();
  }, [gateId]);

  // ── Active alerts listener (limited to 3 most recent) ────────────────────
  useEffect(() => {
    const q = query(
      collection(db, 'alerts'),
      where('status', '==', 'active'),
      orderBy('timestamp', 'desc'),
      limit(3)
    );
    const unsub = onSnapshot(
      q,
      (snap) => setAlerts(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('[HomeScreen] alerts listener error:', err.message)
    );
    return () => unsub();
  }, []);

  /**
   * Returns the match phase translation key.
   * @param {string} phase
   * @returns {string}
   */
  const phaseKey = (phase) => {
    if (phase === 'in-match') return 'home.phase.inmatch';
    if (phase === 'post-match') return 'home.phase.postmatch';
    return 'home.phase.prematch';
  };

  /**
   * Returns Tailwind colour class for a phase indicator.
   * @param {string} phase
   * @returns {string}
   */
  const phaseColor = (phase) => {
    if (phase === 'in-match') return 'text-green-400 bg-green-900/30 border-green-700';
    if (phase === 'post-match') return 'text-amber-400 bg-amber-900/30 border-amber-700';
    return 'text-blue-400 bg-blue-900/30 border-blue-700';
  };

  /**
   * Returns colour class for density value.
   * @param {number} density
   * @returns {string}
   */
  const densityColor = (density) => {
    if (density >= 75) return 'text-red-400';
    if (density >= 50) return 'text-amber-400';
    return 'text-green-400';
  };

  const phase = matchState?.phase || 'pre-match';
  const occupancy = matchState?.currentOccupancy || 0;
  const occupancyPct = Math.round((occupancy / 35000) * 100);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        <span className="animate-pulse">{t('app.loading', lang)}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-6">
      {/* Stadium header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-white leading-tight">
          {t('home.title', lang)}
        </h1>
        <p className="text-sm text-gray-400">{t('home.stadium', lang)}</p>
      </div>

      {/* Match phase badge */}
      <div
        className={`flex items-center gap-2 px-4 py-3 rounded-xl border ${phaseColor(phase)}`}
      >
        <span className="text-lg">
          {phase === 'in-match' ? '🟢' : phase === 'post-match' ? '🏁' : '🔵'}
        </span>
        <div>
          <p className="text-[10px] uppercase tracking-wider opacity-70 font-semibold">
            {t('home.matchStatus', lang)}
          </p>
          <p className="text-sm font-bold">{t(phaseKey(phase), lang)}</p>
        </div>
      </div>

      {/* Fan ID + gate card */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-gray-400 uppercase tracking-wide">
            {t('home.fanId', lang)}
          </span>
          <span className="text-xs font-mono text-gray-300 bg-gray-700 px-2 py-0.5 rounded">
            {fanId}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">{t('home.gateInfo', lang)}</p>
            <p className="text-3xl font-bold text-white">
              {t('generic.gate', lang)} {gateId}
            </p>
          </div>
          {gateData && (
            <div className="flex flex-col items-end gap-1">
              <span
                className={`text-2xl font-bold ${densityColor(gateData.density || 0)}`}
              >
                {gateData.density || 0}%
              </span>
              <span className="text-[10px] text-gray-500">
                {t('gate.density', lang)}
              </span>
              {/* Trend indicator */}
              <span
                className={`text-xs ${
                  gateData.trend === 'increasing'
                    ? 'text-red-400'
                    : gateData.trend === 'decreasing'
                    ? 'text-green-400'
                    : 'text-gray-400'
                }`}
              >
                {gateData.trend === 'increasing'
                  ? '↑ Rising'
                  : gateData.trend === 'decreasing'
                  ? '↓ Easing'
                  : '→ Stable'}
              </span>
            </div>
          )}
        </div>

        {/* Density bar */}
        {gateData && (
          <div className="mt-3 w-full bg-gray-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-700 ${
                (gateData.density || 0) >= 75
                  ? 'bg-red-500'
                  : (gateData.density || 0) >= 50
                  ? 'bg-amber-500'
                  : 'bg-green-500'
              }`}
              style={{ width: `${gateData.density || 0}%` }}
            />
          </div>
        )}
      </div>

      {/* Stadium occupancy */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
        <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">
          {t('home.capacity', lang)}
        </p>
        <div className="flex items-end gap-2 mb-2">
          <span className="text-2xl font-bold text-white">
            {occupancy.toLocaleString('en-IN')}
          </span>
          <span className="text-sm text-gray-400 mb-0.5">/ 35,000</span>
          <span
            className={`ml-auto text-lg font-bold ${
              occupancyPct >= 85
                ? 'text-red-400'
                : occupancyPct >= 60
                ? 'text-amber-400'
                : 'text-green-400'
            }`}
          >
            {occupancyPct}%
          </span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-700 ${
              occupancyPct >= 85
                ? 'bg-red-500'
                : occupancyPct >= 60
                ? 'bg-amber-500'
                : 'bg-green-500'
            }`}
            style={{ width: `${occupancyPct}%` }}
          />
        </div>
      </div>

      {/* Active alerts */}
      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">
          {alerts.length > 0 ? t('home.alerts', lang) : t('home.noAlerts', lang)}
        </p>
        {alerts.length === 0 && (
          <div className="flex items-center gap-2 px-4 py-3 bg-green-900/20 border border-green-700/40 rounded-xl">
            <span className="text-lg">✅</span>
            <span className="text-sm text-green-400">{t('home.noAlerts', lang)}</span>
          </div>
        )}
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className="flex items-start gap-3 px-4 py-3 bg-amber-900/20 border border-amber-700/40 rounded-xl mb-2"
          >
            <span className="text-lg flex-shrink-0">⚠️</span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-300 capitalize">
                {(alert.type || 'alert').replace(/_/g, ' ')}
              </p>
              <p className="text-xs text-gray-300 leading-snug mt-0.5 line-clamp-2">
                {alert.message || alert.reasoning || ''}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default HomeScreen;