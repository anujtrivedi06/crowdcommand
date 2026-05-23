import React, { useState } from 'react';
import { triggerSurge, triggerWeatherAlert, triggerDemoSOS, triggerSecurityAlert, triggerEndMatch, resetDemo } from '../services/api';

/**
 * DemoControls component
 * A collapsible panel of clearly labelled trigger buttons for the Phase 2 live demo.
 * Each button fires a specific scenario flow end-to-end so the judge can see the full
 * system response without manual setup.
 *
 * This panel is intentionally visible and labelled — it demonstrates reliable demo
 * tooling, which is itself an engineering skill.
 *
 * @returns {JSX.Element}
 */
const DemoControls = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState({});
  const [results, setResults] = useState({});

  /**
   * Wraps an API call with loading state and result feedback.
   * @param {string} key - unique key for this button
   * @param {Function} apiFn - async function to call
   */
  const run = async (key, apiFn) => {
    setLoading((prev) => ({ ...prev, [key]: true }));
    setResults((prev) => ({ ...prev, [key]: null }));
    try {
      const res = await apiFn();
      setResults((prev) => ({
        ...prev,
        [key]: { ok: true, msg: res?.message || 'Done' },
      }));
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [key]: { ok: false, msg: err?.message || 'Error' },
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const BUTTONS = [
    {
      key: 'surge',
      label: 'Trigger surge at Gate 3',
      icon: '🔴',
      description: 'Sets zone 3 density to 85%, triggers surge prediction + gate rerouting',
      color: 'border-red-600 hover:bg-red-900/40 text-red-300',
      badgeColor: 'bg-red-700',
      action: () => triggerSurge({ zoneId: 3, density: 85, trend: 'increasing' }),
    },
    {
      key: 'weather',
      label: 'Trigger weather alert',
      icon: '🌧️',
      description: 'Writes rain event → weather agent → orchestrator → reroutes fans to covered exits',
      color: 'border-amber-600 hover:bg-amber-900/40 text-amber-300',
      badgeColor: 'bg-amber-700',
      action: () => triggerWeatherAlert({ type: 'rain', severity: 'high' }),
    },
    {
      key: 'sos',
      label: 'Trigger SOS (demo fan)',
      icon: '🆘',
      description: 'Fires full SOS flow for demo fan at zone 5 centre — shows SOSActive screen & responder animation',
      color: 'border-red-500 hover:bg-red-950/50 text-red-200',
      badgeColor: 'bg-red-600',
      action: () =>
        triggerDemoSOS({
          fanId: 'demo-fan-001',
          gateId: 5,
          lat: 12.9793,
          lng: 77.5996,
        }),
    },
    {
      key: 'security',
      label: 'Trigger security alert',
      icon: '🛡️',
      description: 'Writes high-score CCTV anomaly to zone 7 → security alert in feed',
      color: 'border-orange-600 hover:bg-orange-900/40 text-orange-300',
      badgeColor: 'bg-orange-700',
      action: () =>
        triggerSecurityAlert({
          zoneId: 7,
          label: 'crowd_surge',
          score: 0.91,
        }),
    },
    {
      key: 'endmatch',
      label: 'End match',
      icon: '🏁',
      description: 'Sets matchPhase → post-match, starts wave exit staggering sequence across 3 waves',
      color: 'border-green-600 hover:bg-green-900/40 text-green-300',
      badgeColor: 'bg-green-700',
      action: () => triggerEndMatch(),
    },
    {
      key: 'reset',
      label: 'Reset demo',
      icon: '🔄',
      description: 'Clears all alerts, SOSes, fraud flags — resets all zones to pre-match densities',
      color: 'border-gray-500 hover:bg-gray-700/60 text-gray-300',
      badgeColor: 'bg-gray-600',
      action: () => resetDemo(),
    },
  ];

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 w-80 bg-gray-900 border border-yellow-500/70 rounded-xl shadow-2xl transition-all duration-300 ${
        collapsed ? 'h-12 overflow-hidden' : ''
      }`}
      role="region"
      aria-label="Demo controls panel"
    >
      {/* Header bar */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-yellow-500/20 hover:bg-yellow-500/30 rounded-t-xl transition-colors"
        aria-expanded={!collapsed}
        title="Toggle demo controls panel"
      >
        <div className="flex items-center gap-2">
          <span className="text-yellow-400 font-bold text-sm tracking-wide">⚡ Demo Controls</span>
          <span className="text-[10px] bg-yellow-500 text-black font-bold px-1.5 py-0.5 rounded-full uppercase">
            Judging
          </span>
        </div>
        <span className="text-yellow-400 text-xs">{collapsed ? '▲' : '▼'}</span>
      </button>

      {/* Buttons */}
      {!collapsed && (
        <div className="p-3 space-y-2 max-h-[70vh] overflow-y-auto">
          <p className="text-[10px] text-gray-500 leading-snug mb-2">
            These buttons trigger specific demo scenarios end-to-end. Each fires real Firestore writes
            and agent flows — not mocks.
          </p>

          {BUTTONS.map((btn) => {
            const isLoading = loading[btn.key];
            const result = results[btn.key];

            return (
              <div key={btn.key} className="flex flex-col gap-1">
                <button
                  onClick={() => run(btn.key, btn.action)}
                  disabled={isLoading}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${btn.color} ${
                    isLoading ? 'opacity-60 cursor-wait' : 'cursor-pointer'
                  }`}
                  title={btn.description}
                >
                  <span className="text-lg flex-shrink-0">{btn.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold leading-tight">{btn.label}</span>
                      {isLoading && (
                        <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-[10px] text-gray-500 leading-snug mt-0.5 truncate">
                      {btn.description}
                    </p>
                  </div>
                </button>

                {/* Result feedback */}
                {result && (
                  <div
                    className={`text-[10px] px-3 py-1 rounded-md ${
                      result.ok
                        ? 'bg-green-900/40 text-green-400 border border-green-700/40'
                        : 'bg-red-900/40 text-red-400 border border-red-700/40'
                    }`}
                  >
                    {result.ok ? '✓' : '✗'} {result.msg}
                  </div>
                )}
              </div>
            );
          })}

          {/* Demo sequence reminder */}
          <div className="mt-3 bg-gray-800 rounded-lg p-3 border border-gray-700">
            <p className="text-[10px] text-yellow-400 font-semibold mb-1">Demo sequence</p>
            <ol className="text-[10px] text-gray-400 space-y-0.5 list-decimal list-inside leading-snug">
              <li>Surge at Gate 3 → surge alert + rerouting</li>
              <li>SOS (demo fan) → SOSActive + responder</li>
              <li>Weather alert → covered exit rerouting</li>
              <li>End match → wave exit staggering</li>
              <li>Show Audit Trail → full accountability log</li>
              <li>Reset demo → clean state for next judge</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
};

export default DemoControls;