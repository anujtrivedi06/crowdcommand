import React, { useState } from 'react';
import { useCollection } from '../hooks/useFirestore';
import { updateGateStatus } from '../services/api';

/**
 * Returns display config for a gate status value.
 * @param {string} status - Gate status string.
 * @returns {{ label: string, colour: string, dot: string }}
 */
function statusConfig(status) {
  const map = {
    open: { label: 'Open', colour: 'text-green-400', dot: 'bg-green-400', badge: 'bg-green-900 text-green-300' },
    closed: { label: 'Closed', colour: 'text-red-400', dot: 'bg-red-500', badge: 'bg-red-900 text-red-300' },
    rerouting: { label: 'Rerouting', colour: 'text-amber-400', dot: 'bg-amber-400 animate-pulse', badge: 'bg-amber-900 text-amber-300' },
    overloaded: { label: 'Overloaded', colour: 'text-red-500', dot: 'bg-red-600 animate-pulse', badge: 'bg-red-950 text-red-300' },
  };
  return map[status] || { label: status, colour: 'text-gray-400', dot: 'bg-gray-500', badge: 'bg-gray-700 text-gray-300' };
}

/**
 * Returns a width percentage style for the throughput bar.
 * @param {number} throughput - Current throughput 0–100.
 * @param {number} capacity - Gate capacity (scans/min).
 * @returns {string} CSS width percentage string.
 */
function throughputPercent(throughput, capacity) {
  if (!capacity || capacity === 0) return '0%';
  return `${Math.min(100, Math.round((throughput / capacity) * 100))}%`;
}

/**
 * Returns a Tailwind colour for a throughput level.
 * @param {number} pct - Percentage 0–100.
 * @returns {string} Tailwind bg class.
 */
function throughputBarColour(pct) {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-amber-400';
  return 'bg-green-500';
}

/**
 * GateCard — individual gate tile.
 * @param {object} props
 * @param {object} props.gate - Firestore gate document.
 * @param {function} props.onAction - Callback for manual status override.
 */
function GateCard({ gate, onAction }) {
  const cfg = statusConfig(gate.status);
  const pct = Math.min(100, Math.round((gate.throughput / (gate.capacity || 100)) * 100));
  const barColour = throughputBarColour(pct);
  const [busy, setBusy] = useState(false);

  const handleOverride = async (newStatus, altGate = null) => {
    setBusy(true);
    try {
      await onAction(gate.id, newStatus, altGate);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`bg-gray-800 rounded-lg p-3 border ${gate.status === 'overloaded' ? 'border-red-700' : gate.status === 'rerouting' ? 'border-amber-700' : 'border-gray-700'} transition-all`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
          <span className="text-sm font-semibold text-white">{gate.name || gate.id}</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.badge}`}>
          {cfg.label}
        </span>
      </div>

      {/* Zone label */}
      {gate.zone && (
        <div className="text-xs text-gray-500 mb-2">{gate.zone}</div>
      )}

      {/* Throughput bar */}
      <div className="mb-2">
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>Throughput</span>
          <span className={pct >= 90 ? 'text-red-400 font-bold' : 'text-gray-400'}>
            {gate.throughput ?? 0} / {gate.capacity ?? 100} scans/min
          </span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-1.5 rounded-full transition-all duration-500 ${barColour}`}
            style={{ width: throughputPercent(gate.throughput ?? 0, gate.capacity ?? 100) }}
          />
        </div>
      </div>

      {/* Queue length */}
      {gate.queueLength != null && (
        <div className="text-xs text-gray-400 mb-2">
          Queue: <span className={gate.queueLength > 200 ? 'text-red-400 font-bold' : 'text-gray-300'}>
            {gate.queueLength} fans
          </span>
        </div>
      )}

      {/* Alt gate indicator */}
      {gate.altGate && gate.status === 'rerouting' && (
        <div className="text-xs text-amber-400 mb-2 font-medium">
          → Redirecting to {gate.altGate}
        </div>
      )}

      {/* Last scan */}
      {gate.lastScan && (
        <div className="text-xs text-gray-600 mb-2">
          Last scan: {new Date(gate.lastScan?.toDate ? gate.lastScan.toDate() : gate.lastScan).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-1 flex-wrap mt-1">
        {gate.status !== 'open' && (
          <button
            disabled={busy}
            onClick={() => handleOverride('open')}
            className="text-xs px-2 py-1 bg-green-800 hover:bg-green-700 text-green-300 rounded transition-colors disabled:opacity-50"
          >
            Open
          </button>
        )}
        {gate.status !== 'closed' && (
          <button
            disabled={busy}
            onClick={() => handleOverride('closed')}
            className="text-xs px-2 py-1 bg-red-800 hover:bg-red-700 text-red-300 rounded transition-colors disabled:opacity-50"
          >
            Close
          </button>
        )}
        {gate.status !== 'rerouting' && (
          <button
            disabled={busy}
            onClick={() => handleOverride('rerouting', gate.suggestedAlt || null)}
            className="text-xs px-2 py-1 bg-amber-800 hover:bg-amber-700 text-amber-300 rounded transition-colors disabled:opacity-50"
          >
            Reroute
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * GatePanel — displays all stadium gate statuses with real-time Firestore
 * updates. Operators can manually override gate status from this panel.
 *
 * @returns {JSX.Element}
 */
export default function GatePanel() {
  const { data: gates, loading, error } = useCollection('gates');
  const [actionError, setActionError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);

  /**
   * Handle a gate status override action.
   * @param {string} gateId
   * @param {string} newStatus
   * @param {string|null} altGate
   */
  const handleAction = async (gateId, newStatus, altGate) => {
    setActionError(null);
    setActionSuccess(null);
    try {
      await updateGateStatus(gateId, newStatus, altGate);
      setActionSuccess(`${gateId} set to ${newStatus}`);
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err) {
      console.error('[GatePanel] updateGateStatus error:', err);
      setActionError(err.message);
      setTimeout(() => setActionError(null), 5000);
    }
  };

  // Summary counts
  const openCount = gates.filter((g) => g.status === 'open').length;
  const closedCount = gates.filter((g) => g.status === 'closed').length;
  const reroutingCount = gates.filter((g) => g.status === 'rerouting').length;
  const overloadedCount = gates.filter((g) => g.status === 'overloaded').length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white">Gate Status</h2>
        <div className="flex gap-2 text-xs">
          {openCount > 0 && <span className="text-green-400">{openCount} open</span>}
          {reroutingCount > 0 && <span className="text-amber-400">{reroutingCount} rerouting</span>}
          {overloadedCount > 0 && <span className="text-red-400 font-bold animate-pulse">{overloadedCount} overloaded</span>}
          {closedCount > 0 && <span className="text-gray-500">{closedCount} closed</span>}
        </div>
      </div>

      {/* Feedback banners */}
      {actionSuccess && (
        <div className="mb-2 text-xs text-green-400 bg-green-900 bg-opacity-40 px-2 py-1 rounded">
          ✓ {actionSuccess}
        </div>
      )}
      {actionError && (
        <div className="mb-2 text-xs text-red-400 bg-red-900 bg-opacity-40 px-2 py-1 rounded">
          ✗ {actionError}
        </div>
      )}

      {/* Gate grid */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="text-center text-gray-500 text-xs py-8">Loading gates…</div>
        )}
        {error && (
          <div className="text-center text-red-500 text-xs py-4">Error: {error}</div>
        )}
        {!loading && gates.length === 0 && (
          <div className="text-center text-gray-600 text-xs py-8">No gate data available</div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {gates
            .slice()
            .sort((a, b) => {
              // Sort overloaded/rerouting first, then by gate name
              const priority = (g) =>
                g.status === 'overloaded' ? 0 : g.status === 'rerouting' ? 1 : g.status === 'closed' ? 3 : 2;
              return priority(a) - priority(b) || (a.name || a.id).localeCompare(b.name || b.id);
            })
            .map((gate) => (
              <GateCard key={gate.id} gate={gate} onAction={handleAction} />
            ))}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-2 text-xs text-gray-600 text-right">
        {gates.length} gates · real-time
      </div>
    </div>
  );
}