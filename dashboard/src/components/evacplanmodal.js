import React, { useState, useEffect } from 'react';
import { useEvacPlan } from '../hooks/useFirestore';
import { confirmEvacPlan, rejectEvacPlan } from '../services/api';

/**
 * Formats a Firestore Timestamp or ISO string.
 * @param {object|string|null} ts
 * @returns {string}
 */
function formatTime(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Returns a risk level badge config.
 * @param {string} level
 * @returns {{ label: string, badgeClass: string }}
 */
function riskBadge(level) {
  const map = {
    low: { label: 'Low', badgeClass: 'bg-green-800 text-green-300' },
    medium: { label: 'Medium', badgeClass: 'bg-amber-800 text-amber-300' },
    high: { label: 'High', badgeClass: 'bg-red-800 text-red-300' },
    critical: { label: 'Critical', badgeClass: 'bg-red-700 text-white animate-pulse' },
  };
  return map[level?.toLowerCase()] || { label: level || '—', badgeClass: 'bg-gray-700 text-gray-300' };
}

/**
 * ConfirmDialog — secondary confirmation modal to prevent accidental
 * evacuation confirmation, shown when operator clicks Confirm.
 *
 * @param {object} props
 * @param {function} props.onConfirm - Called when operator confirms.
 * @param {function} props.onCancel - Called when operator cancels.
 * @param {boolean} props.busy - Whether the API call is in progress.
 */
function ConfirmDialog({ onConfirm, onCancel, busy }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80">
      <div className="bg-gray-900 border-2 border-red-600 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <div className="text-center mb-4">
          <div className="text-4xl mb-2">🚨</div>
          <h3 className="text-lg font-bold text-red-400">Confirm Evacuation</h3>
          <p className="text-sm text-gray-300 mt-2 leading-relaxed">
            This will immediately dispatch all assigned volunteers, push fan exit
            notifications, and activate the PA announcement. This action{' '}
            <strong className="text-white">cannot be undone</strong>.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <span className="animate-spin">⚙️</span> Executing…
              </>
            ) : (
              '✓ Confirm Evacuation'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * RejectDialog — prompts operator for a rejection reason before rejecting
 * the evacuation plan. Reason is logged to the audit trail.
 *
 * @param {object} props
 * @param {function} props.onReject - Called with the reason string.
 * @param {function} props.onCancel - Called when operator cancels.
 * @param {boolean} props.busy
 */
function RejectDialog({ onReject, onCancel, busy }) {
  const [reason, setReason] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <h3 className="text-base font-bold text-white mb-3">Reject Evacuation Plan</h3>
        <p className="text-xs text-gray-400 mb-3">
          Provide a reason for rejection. This will be logged to the audit trail.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. False alarm confirmed — situation resolved"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-sm text-white placeholder-gray-600 resize-none focus:outline-none focus:border-gray-500"
          rows={3}
        />
        <div className="flex gap-3 mt-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => reason.trim() && onReject(reason.trim())}
            disabled={busy || !reason.trim()}
            className="flex-1 py-2 rounded-lg bg-gray-600 hover:bg-gray-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {busy ? 'Rejecting…' : 'Reject Plan'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * EvacPlanModal — listens to Firestore `evacuation/current` and displays
 * a full-screen modal whenever an evacuation plan has status "pending_confirmation".
 * Operator must explicitly confirm or reject — the human-in-the-loop step
 * can never be bypassed. Rejection requires a written reason for the audit trail.
 *
 * @returns {JSX.Element|null}
 */
export default function EvacPlanModal() {
  const { evacPlan, loading } = useEvacPlan();
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [outcome, setOutcome] = useState(null); // 'confirmed' | 'rejected'

  // Reset outcome display after 5 seconds
  useEffect(() => {
    if (!outcome) return;
    const t = setTimeout(() => setOutcome(null), 5000);
    return () => clearTimeout(t);
  }, [outcome]);

  // Only render when there is a pending plan
  const isPending = evacPlan?.status === 'pending_confirmation';
  const isExecuting = evacPlan?.status === 'executing';

  if (loading || (!isPending && !isExecuting && !outcome)) return null;

  const plan = evacPlan || {};
  const risk = riskBadge(plan.risk_level);

  const exitsToOpen = Array.isArray(plan.exits_to_open) ? plan.exits_to_open : [];
  const exitsToClose = Array.isArray(plan.exits_to_close) ? plan.exits_to_close : [];
  const volunteerAssignments = plan.volunteer_assignments || {};
  const volunteerEntries = Object.entries(volunteerAssignments);

  /**
   * Execute the evacuation plan confirmation.
   */
  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await confirmEvacPlan('current', 'operator-dashboard');
      setOutcome('confirmed');
      setShowConfirmDialog(false);
    } catch (err) {
      console.error('[EvacPlanModal] confirmEvacPlan error:', err);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Reject the evacuation plan with a reason.
   * @param {string} reason
   */
  const handleReject = async (reason) => {
    setBusy(true);
    setError(null);
    try {
      await rejectEvacPlan('current', reason, 'operator-dashboard');
      setOutcome('rejected');
      setShowRejectDialog(false);
    } catch (err) {
      console.error('[EvacPlanModal] rejectEvacPlan error:', err);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Outcome feedback overlay (brief)
  if (outcome) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70 pointer-events-none">
        <div className={`rounded-xl px-8 py-6 text-center shadow-2xl ${outcome === 'confirmed' ? 'bg-green-900 border border-green-600' : 'bg-gray-800 border border-gray-600'}`}>
          <div className="text-4xl mb-2">{outcome === 'confirmed' ? '✅' : '🚫'}</div>
          <div className="text-lg font-bold text-white">
            {outcome === 'confirmed' ? 'Evacuation Executing' : 'Plan Rejected'}
          </div>
          <div className="text-sm text-gray-400 mt-1">
            {outcome === 'confirmed' ? 'All responders notified. PA active.' : 'Logged to audit trail.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Secondary dialogs */}
      {showConfirmDialog && (
        <ConfirmDialog
          onConfirm={handleConfirm}
          onCancel={() => setShowConfirmDialog(false)}
          busy={busy}
        />
      )}
      {showRejectDialog && (
        <RejectDialog
          onReject={handleReject}
          onCancel={() => setShowRejectDialog(false)}
          busy={busy}
        />
      )}

      {/* Main modal */}
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black bg-opacity-80 p-4">
        <div className="bg-gray-900 border-2 border-red-700 rounded-xl w-full max-w-2xl max-h-screen overflow-y-auto shadow-2xl">
          {/* Modal header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-red-900 bg-red-950 bg-opacity-50 rounded-t-xl">
            <div className="flex items-center gap-3">
              <span className="text-2xl animate-pulse">🚨</span>
              <div>
                <h2 className="text-base font-bold text-red-400 uppercase tracking-wide">
                  Evacuation Plan — Awaiting Confirmation
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Generated by Emergency Agent · {formatTime(plan.createdAt || plan.timestamp)}
                </p>
              </div>
            </div>
            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${risk.badgeClass}`}>
              {risk.label} Risk
            </span>
          </div>

          {/* Plan body */}
          <div className="px-5 py-4 space-y-4">
            {/* Trigger reason */}
            {plan.reason && (
              <div className="bg-red-950 bg-opacity-40 border border-red-900 rounded-lg px-3 py-2">
                <div className="text-xs text-gray-500 mb-0.5">Trigger reason</div>
                <div className="text-sm text-red-300 font-medium">{plan.reason}</div>
              </div>
            )}

            {/* Exits */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                  <span className="text-green-400">▶</span> Exits to Open
                </div>
                {exitsToOpen.length === 0 ? (
                  <div className="text-xs text-gray-600">None</div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {exitsToOpen.map((e) => (
                      <span key={e} className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded font-medium">{e}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="bg-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                  <span className="text-red-400">✕</span> Exits to Close
                </div>
                {exitsToClose.length === 0 ? (
                  <div className="text-xs text-gray-600">None</div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {exitsToClose.map((e) => (
                      <span key={e} className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded font-medium">{e}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* PA Announcement */}
            {plan.pa_announcement_script && (
              <div className="bg-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">📢 PA Announcement Script</div>
                <div className="text-sm text-amber-300 font-mono leading-relaxed">
                  "{plan.pa_announcement_script}"
                </div>
              </div>
            )}

            {/* Fan app message */}
            {plan.fan_app_message && (
              <div className="bg-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">📱 Fan App Message</div>
                <div className="text-sm text-blue-300">{plan.fan_app_message}</div>
              </div>
            )}

            {/* Volunteer assignments */}
            {volunteerEntries.length > 0 && (
              <div className="bg-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-2">👮 Volunteer Assignments ({volunteerEntries.length})</div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {volunteerEntries.map(([vid, task]) => (
                    <div key={vid} className="flex items-start gap-2 text-xs">
                      <span className="text-gray-400 font-mono flex-shrink-0">{vid}</span>
                      <span className="text-gray-300">{typeof task === 'string' ? task : JSON.stringify(task)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI reasoning */}
            {plan.reasoning && (
              <div className="bg-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">🤖 AI Reasoning</div>
                <div className="text-xs text-gray-400 italic leading-relaxed">{plan.reasoning}</div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="text-xs text-red-400 bg-red-950 border border-red-800 rounded px-3 py-2">
                Error: {error}
              </div>
            )}
          </div>

          {/* Action buttons — HUMAN-IN-THE-LOOP: operator must explicitly act */}
          <div className="px-5 py-4 border-t border-gray-700 bg-gray-950 rounded-b-xl">
            <p className="text-xs text-gray-500 mb-3 text-center">
              ⚠️ Human confirmation required. Evacuation will not execute until approved.
            </p>
            <div className="flex gap-3">
              <button
                disabled={busy || !isPending}
                onClick={() => setShowRejectDialog(true)}
                className="flex-1 py-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                ✕ Reject Plan
              </button>
              <button
                disabled={busy || !isPending}
                onClick={() => setShowConfirmDialog(true)}
                className="flex-1 py-3 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isExecuting ? (
                  <><span className="animate-spin">⚙️</span> Executing…</>
                ) : (
                  '✓ Confirm & Execute'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}