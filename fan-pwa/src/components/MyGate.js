import React, { useEffect, useState } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { t } from '../i18n';

/**
 * MyGate component
 * Shows the fan's assigned gate with real-time status, density, and entry
 * instructions. If the gate is closed or overcrowded, displays the alternate
 * gate assigned by the crowdFlowAgent via Firestore.
 *
 * Data is sourced from:
 *  - Firestore `zones/{gateId}` — density, trend, status, alternateGate
 *  - Firestore `gates/{gateId}` — gate open/closed status and queue time
 *
 * @param {{ fanId: string, gateId: string, lang: string }} props
 * @returns {JSX.Element}
 */
const MyGate = ({ fanId, gateId, lang }) => {
  const [zoneData, setZoneData] = useState(null);
  const [gateStatus, setGateStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  // ── Zone density listener ─────────────────────────────────────────────────
  useEffect(() => {
    if (!gateId) return;
    const unsub = onSnapshot(
      doc(db, 'zones', String(gateId)),
      (snap) => {
        if (snap.exists()) setZoneData({ id: snap.id, ...snap.data() });
        setLoading(false);
      },
      (err) => {
        console.error('[MyGate] zone listener error:', err.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [gateId]);

  // ── Gate operational status listener ─────────────────────────────────────
  useEffect(() => {
    if (!gateId) return;
    const unsub = onSnapshot(
      doc(db, 'gates', String(gateId)),
      (snap) => {
        if (snap.exists()) setGateStatus({ id: snap.id, ...snap.data() });
      },
      (err) => console.error('[MyGate] gate status listener error:', err.message)
    );
    return () => unsub();
  }, [gateId]);

  const density = zoneData?.density || 0;
  const trend = zoneData?.trend || 'stable';
  const isOpen = gateStatus?.isOpen !== false; // default open if no data
  const alternateGate = zoneData?.alternateGate || gateStatus?.alternateGate;
  const isCrowded = density >= 80;
  const queueMinutes = gateStatus?.estimatedQueueMinutes || null;

  /**
   * Derives the gate status key for i18n.
   * @returns {string}
   */
  const statusKey = () => {
    if (!isOpen || (isCrowded && alternateGate)) return 'gate.status.closed';
    if (density >= 60) return 'gate.status.busy';
    return 'gate.status.open';
  };

  /**
   * Returns border + bg colour classes for the status banner.
   * @returns {string}
   */
  const statusStyle = () => {
    if (!isOpen || (isCrowded && alternateGate))
      return 'border-red-600 bg-red-900/30 text-red-300';
    if (density >= 60) return 'border-amber-500 bg-amber-900/30 text-amber-300';
    return 'border-green-600 bg-green-900/30 text-green-300';
  };

  /**
   * Returns a colour class for the density percentage text.
   * @param {number} d
   * @returns {string}
   */
  const densityColor = (d) => {
    if (d >= 75) return 'text-red-400';
    if (d >= 50) return 'text-amber-400';
    return 'text-green-400';
  };

  const trendIcon =
    trend === 'increasing' ? '↑' : trend === 'decreasing' ? '↓' : '→';
  const trendColor =
    trend === 'increasing'
      ? 'text-red-400'
      : trend === 'decreasing'
      ? 'text-green-400'
      : 'text-gray-400';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm p-8">
        <span className="animate-pulse">{t('app.loading', lang)}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-6">
      {/* Header */}
      <h1 className="text-xl font-bold text-white">{t('gate.title', lang)}</h1>

      {/* Gate number hero card */}
      <div className="bg-gray-800 rounded-2xl p-5 border border-gray-700 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">
            {t('gate.assigned', lang)}
          </p>
          <p className="text-6xl font-black text-white leading-none">
            {gateId}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {t('generic.gate', lang)} {gateId} · {t('generic.zone', lang)} {gateId}
          </p>
        </div>

        {/* Density ring */}
        <div className="flex flex-col items-center gap-1">
          <DensityRing density={density} />
          <span className="text-[10px] text-gray-500">{t('gate.density', lang)}</span>
          <span className={`text-sm font-bold ${trendColor}`}>{trendIcon}</span>
        </div>
      </div>

      {/* Status banner */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${statusStyle()}`}>
        <span className="text-2xl">
          {!isOpen || (isCrowded && alternateGate) ? '🔴' : density >= 60 ? '🟡' : '🟢'}
        </span>
        <div>
          <p className="text-sm font-bold">{t(statusKey(), lang)}</p>
          {queueMinutes && (
            <p className="text-xs opacity-70 mt-0.5">
              ~{queueMinutes} min queue
            </p>
          )}
        </div>
      </div>

      {/* Alternate gate notice */}
      {alternateGate && (isCrowded || !isOpen) && (
        <div className="flex items-center gap-3 px-4 py-4 bg-blue-900/30 border border-blue-600 rounded-xl">
          <span className="text-2xl">🔀</span>
          <div>
            <p className="text-xs text-blue-300 uppercase tracking-wide font-semibold mb-0.5">
              {t('gate.alternate', lang)}
            </p>
            <p className="text-2xl font-black text-white">
              {t('generic.gate', lang)} {alternateGate}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Assigned by CrowdCommand AI
            </p>
          </div>
        </div>
      )}

      {/* Density detail row */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
        <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">
          {t('gate.density', lang)}
        </p>
        <div className="flex items-center gap-3 mb-2">
          <span className={`text-3xl font-bold ${densityColor(density)}`}>
            {density}%
          </span>
          <div className="flex-1">
            <div className="w-full bg-gray-700 rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all duration-700 ${
                  density >= 75
                    ? 'bg-red-500'
                    : density >= 50
                    ? 'bg-amber-500'
                    : 'bg-green-500'
                }`}
                style={{ width: `${density}%` }}
              />
            </div>
          </div>
        </div>
        <div className="flex justify-between text-[10px] text-gray-500">
          <span>0%</span>
          <span className="text-amber-500">50% busy</span>
          <span className="text-red-500">75% critical</span>
          <span>100%</span>
        </div>
      </div>

      {/* Entry instructions */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
        <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">
          {t('gate.instructions', lang)}
        </p>
        <ul className="space-y-3">
          {[
            { icon: '🎟️', key: 'gate.scanTicket' },
            { icon: '🔍', key: 'gate.noMetalObjects' },
          ].map(({ icon, key }) => (
            <li key={key} className="flex items-start gap-3">
              <span className="text-lg flex-shrink-0">{icon}</span>
              <span className="text-sm text-gray-300 leading-snug">
                {t(key, lang)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Live indicator */}
      <div className="flex items-center gap-2 text-xs text-gray-500 justify-center">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        {t('generic.liveUpdates', lang)}
      </div>
    </div>
  );
};

/**
 * DensityRing renders an SVG circular progress ring for a density percentage.
 *
 * @param {{ density: number }} props
 * @returns {JSX.Element}
 */
const DensityRing = ({ density }) => {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const fill = ((100 - density) / 100) * circ;
  const color =
    density >= 75 ? '#ef4444' : density >= 50 ? '#f59e0b' : '#22c55e';

  return (
    <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
      <circle cx="36" cy="36" r={r} fill="none" stroke="#374151" strokeWidth="7" />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="7"
        strokeDasharray={circ}
        strokeDashoffset={fill}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.7s ease' }}
      />
      <text
        x="36"
        y="36"
        textAnchor="middle"
        dominantBaseline="central"
        className="rotate-90"
        style={{
          fill: color,
          fontSize: '14px',
          fontWeight: 'bold',
          transform: 'rotate(90deg)',
          transformOrigin: '36px 36px',
        }}
      >
        {density}%
      </text>
    </svg>
  );
};

export default MyGate;