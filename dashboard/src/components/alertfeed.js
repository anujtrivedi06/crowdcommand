import React, { useEffect, useRef, useState } from 'react';
import { useAgentAlerts, getAlertColour, getAlertLabel, ALERT_TYPE, SEVERITY } from '../hooks/useAgentAlerts';

/**
 * Returns a Tailwind border-left colour class for an alert type.
 * @param {string} type - Alert type.
 * @returns {string} Tailwind CSS class string.
 */
function borderClass(type) {
  const map = {
    [ALERT_TYPE.SURGE_PREDICTION]: 'border-orange-500',
    [ALERT_TYPE.WEATHER_REROUTE]: 'border-yellow-400',
    [ALERT_TYPE.SECURITY]: 'border-red-500',
    [ALERT_TYPE.FRAUD]: 'border-amber-500',
    [ALERT_TYPE.SOS]: 'border-red-600',
    [ALERT_TYPE.SOS_CLUSTER]: 'border-red-700',
    [ALERT_TYPE.EVACUATION]: 'border-red-700',
    [ALERT_TYPE.GATE_REROUTE]: 'border-blue-500',
    [ALERT_TYPE.SYSTEM]: 'border-gray-500',
  };
  return map[type] || 'border-gray-500';
}

/**
 * Returns a badge background + text colour class for a severity level.
 * @param {string} severity - SEVERITY value.
 * @returns {string} Tailwind CSS class string.
 */
function severityBadgeClass(severity) {
  const map = {
    [SEVERITY.CRITICAL]: 'bg-red-700 text-white',
    [SEVERITY.HIGH]: 'bg-red-500 text-white',
    [SEVERITY.MEDIUM]: 'bg-amber-500 text-white',
    [SEVERITY.LOW]: 'bg-gray-600 text-gray-200',
  };
  return map[severity] || 'bg-gray-600 text-gray-200';
}

/**
 * Icon character for each alert type.
 * @param {string} type - Alert type.
 * @returns {string} Emoji icon.
 */
function alertIcon(type) {
  const map = {
    [ALERT_TYPE.SURGE_PREDICTION]: '📈',
    [ALERT_TYPE.WEATHER_REROUTE]: '🌧️',
    [ALERT_TYPE.SECURITY]: '🔴',
    [ALERT_TYPE.FRAUD]: '⚠️',
    [ALERT_TYPE.SOS]: '🆘',
    [ALERT_TYPE.SOS_CLUSTER]: '🚨',
    [ALERT_TYPE.EVACUATION]: '🚪',
    [ALERT_TYPE.GATE_REROUTE]: '🔀',
    [ALERT_TYPE.SYSTEM]: 'ℹ️',
  };
  return map[type] || 'ℹ️';
}

/**
 * Formats a Firestore Timestamp or ISO string for display.
 * @param {object|string|null} ts - Timestamp value.
 * @returns {string} Formatted time string.
 */
function formatTime(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Single alert row component.
 * @param {object} props
 * @param {object} props.alert - Normalised alert object from useAgentAlerts.
 * @param {boolean} props.isNew - Whether this alert arrived in the last 10 seconds.
 * @param {boolean} props.expanded - Whether the detail panel is open.
 * @param {function} props.onToggle - Toggle expand/collapse.
 */
function AlertRow({ alert, isNew, expanded, onToggle }) {
  const colour = getAlertColour(alert.type);
  const zones = Array.isArray(alert.affectedZones) && alert.affectedZones.length > 0
    ? alert.affectedZones.join(', ')
    : null;

  return (
    <div
      className={`border-l-4 ${borderClass(alert.type)} bg-gray-800 rounded-r-lg mb-2 cursor-pointer transition-all duration-200 ${isNew ? 'ring-1 ring-white ring-opacity-20' : ''}`}
      onClick={onToggle}
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <span className="text-base mt-0.5 select-none">{alertIcon(alert.type)}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${severityBadgeClass(alert.severity)}`}>
              {(alert.severity || 'medium').toUpperCase()}
            </span>
            <span className={`text-xs font-medium text-${colour}-400`}>
              {getAlertLabel(alert.type)}
            </span>
            {isNew && (
              <span className="text-xs bg-white text-gray-900 font-bold px-1 rounded animate-pulse">NEW</span>
            )}
            <span className="ml-auto text-xs text-gray-500 whitespace-nowrap">{formatTime(alert.timestamp)}</span>
          </div>
          <p className="text-xs text-gray-300 mt-1 line-clamp-2 leading-relaxed">
            {alert.message}
          </p>
          {zones && (
            <div className="text-xs text-gray-500 mt-0.5">Zones: {zones}</div>
          )}
        </div>
        <span className="text-gray-600 text-xs mt-1 select-none">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-gray-700 text-xs text-gray-400 space-y-1">
          <div><span className="text-gray-500">Alert ID:</span> <span className="font-mono">{alert.id}</span></div>
          {alert.raw?.recommended_actions && (
            <div>
              <span className="text-gray-500">Recommended actions:</span>
              <ul className="list-disc list-inside ml-2 mt-0.5 space-y-0.5">
                {(Array.isArray(alert.raw.recommended_actions)
                  ? alert.raw.recommended_actions
                  : [alert.raw.recommended_actions]
                ).map((a, i) => (
                  <li key={i} className="text-gray-300">{a}</li>
                ))}
              </ul>
            </div>
          )}
          {alert.raw?.estimated_minutes_to_critical != null && (
            <div><span className="text-gray-500">Est. time to critical:</span> <strong className="text-amber-400">{alert.raw.estimated_minutes_to_critical} min</strong></div>
          )}
          {alert.raw?.reasoning && (
            <div><span className="text-gray-500">AI reasoning:</span> <span className="italic text-gray-400">{alert.raw.reasoning}</span></div>
          )}
          {alert.raw?.fanId && (
            <div><span className="text-gray-500">Fan ID:</span> {alert.raw.fanId}</div>
          )}
          {alert.raw?.fraudType && (
            <div><span className="text-gray-500">Fraud type:</span> <span className="text-amber-400">{alert.raw.fraudType}</span></div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * AlertFeed — real-time scrolling feed of all agent alerts from Firestore.
 * Colour-coded by type, expandable rows, with unread badge and filter tabs.
 *
 * @returns {JSX.Element}
 */
export default function AlertFeed() {
  const { alerts, criticalCount, unreadCount, markAllRead, loading } = useAgentAlerts({ maxAlerts: 50 });
  const [expandedId, setExpandedId] = useState(null);
  const [filter, setFilter] = useState('all');
  const [newIds, setNewIds] = useState(new Set());
  const prevIdsRef = useRef(new Set());
  const feedRef = useRef(null);

  // Track newly arriving alerts for the NEW badge
  useEffect(() => {
    const currentIds = new Set(alerts.map((a) => a.id));
    const arrivedIds = new Set();
    currentIds.forEach((id) => {
      if (!prevIdsRef.current.has(id)) arrivedIds.add(id);
    });
    if (arrivedIds.size > 0) {
      setNewIds((prev) => new Set([...prev, ...arrivedIds]));
      // Clear NEW badge after 10 seconds
      const timer = setTimeout(() => {
        setNewIds((prev) => {
          const next = new Set(prev);
          arrivedIds.forEach((id) => next.delete(id));
          return next;
        });
      }, 10000);
      return () => clearTimeout(timer);
    }
    prevIdsRef.current = currentIds;
  }, [alerts]);

  const FILTERS = [
    { key: 'all', label: 'All' },
    { key: ALERT_TYPE.SOS, label: 'SOS' },
    { key: ALERT_TYPE.SECURITY, label: 'Security' },
    { key: ALERT_TYPE.SURGE_PREDICTION, label: 'Surge' },
    { key: ALERT_TYPE.FRAUD, label: 'Fraud' },
    { key: ALERT_TYPE.WEATHER_REROUTE, label: 'Weather' },
  ];

  const filtered = filter === 'all' ? alerts : alerts.filter((a) => a.type === filter);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white">Agent Alerts</h2>
          {criticalCount > 0 && (
            <span className="bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full animate-pulse">
              {criticalCount} CRITICAL
            </span>
          )}
          {unreadCount > 0 && (
            <span className="bg-gray-600 text-gray-200 text-xs px-1.5 py-0.5 rounded-full">
              {unreadCount} new
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Mark all read
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${
              filter === f.key
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Feed */}
      <div ref={feedRef} className="flex-1 overflow-y-auto pr-1 space-y-0" style={{ maxHeight: 420 }}>
        {loading && (
          <div className="text-center text-gray-500 text-xs py-8">Loading alerts…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-center text-gray-600 text-xs py-8">
            <div className="text-2xl mb-1">✅</div>
            No alerts — all zones nominal
          </div>
        )}
        {filtered.map((alert) => (
          <AlertRow
            key={alert.id}
            alert={alert}
            isNew={newIds.has(alert.id)}
            expanded={expandedId === alert.id}
            onToggle={() => setExpandedId(expandedId === alert.id ? null : alert.id)}
          />
        ))}
      </div>

      {/* Footer count */}
      <div className="mt-2 text-xs text-gray-600 text-right">
        {filtered.length} alert{filtered.length !== 1 ? 's' : ''}
        {filter !== 'all' ? ` · filtered by ${filter}` : ''}
      </div>
    </div>
  );
}