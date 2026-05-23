import React, { useEffect, useRef, useState } from 'react';
import { useFirestore } from '../hooks/useFirestore';

/**
 * AuditTrail component
 * Displays a live scrolling feed of all system events from the audit_log collection.
 * Events are colour-coded by type: blue=agent actions, amber=operator decisions,
 * red=emergency events, green=resolutions.
 *
 * @returns {JSX.Element}
 */
const AuditTrail = () => {
  const { data: auditEvents, loading } = useFirestore('audit_log', {
    orderBy: ['timestamp', 'desc'],
    limit: 100,
  });

  const [filter, setFilter] = useState('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef(null);
  const prevCountRef = useRef(0);

  // Auto-scroll to top (newest) when new events arrive
  useEffect(() => {
    if (autoScroll && auditEvents && auditEvents.length !== prevCountRef.current) {
      prevCountRef.current = auditEvents.length;
      if (listRef.current) {
        listRef.current.scrollTop = 0;
      }
    }
  }, [auditEvents, autoScroll]);

  /**
   * Returns Tailwind colour classes based on event type.
   * @param {string} eventType
   * @returns {{ border: string, bg: string, badge: string, text: string }}
   */
  const getEventStyle = (eventType) => {
    const type = (eventType || '').toLowerCase();
    if (type.includes('emergency') || type.includes('sos') || type.includes('evacuation')) {
      return {
        border: 'border-red-500',
        bg: 'bg-red-950/40',
        badge: 'bg-red-600 text-white',
        dot: 'bg-red-500',
        label: 'Emergency',
      };
    }
    if (type.includes('operator') || type.includes('confirm') || type.includes('reject') || type.includes('human')) {
      return {
        border: 'border-amber-500',
        bg: 'bg-amber-950/40',
        badge: 'bg-amber-500 text-black',
        dot: 'bg-amber-400',
        label: 'Operator',
      };
    }
    if (type.includes('resolv') || type.includes('clear') || type.includes('complete') || type.includes('wave_exit')) {
      return {
        border: 'border-green-500',
        bg: 'bg-green-950/40',
        badge: 'bg-green-600 text-white',
        dot: 'bg-green-500',
        label: 'Resolution',
      };
    }
    // Default: agent action (blue)
    return {
      border: 'border-blue-500',
      bg: 'bg-blue-950/40',
      badge: 'bg-blue-600 text-white',
      dot: 'bg-blue-500',
      label: 'Agent',
    };
  };

  /**
   * Returns the filter category for an event.
   * @param {string} eventType
   * @returns {string}
   */
  const getFilterCategory = (eventType) => {
    const s = getEventStyle(eventType);
    return s.label.toLowerCase();
  };

  const FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'emergency', label: 'Emergency' },
    { key: 'operator', label: 'Operator' },
    { key: 'resolution', label: 'Resolution' },
    { key: 'agent', label: 'Agent' },
  ];

  const filtered = (auditEvents || []).filter((ev) => {
    if (filter === 'all') return true;
    return getFilterCategory(ev.eventType) === filter;
  });

  /**
   * Formats a Firestore timestamp or ISO string to a readable time.
   * @param {any} ts
   * @returns {string}
   */
  const formatTime = (ts) => {
    if (!ts) return '--:--:--';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString('en-IN', { hour12: false });
  };

  /**
   * Formats a Firestore timestamp to a date string.
   * @param {any} ts
   * @returns {string}
   */
  const formatDate = (ts) => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-wide">Audit Trail</span>
          {!loading && (
            <span className="text-xs text-gray-400 bg-gray-700 px-2 py-0.5 rounded-full">
              {(auditEvents || []).length} events
            </span>
          )}
        </div>
        {/* Auto-scroll toggle */}
        <button
          onClick={() => setAutoScroll((v) => !v)}
          className={`text-xs px-3 py-1 rounded-full border transition-colors ${
            autoScroll
              ? 'border-blue-500 text-blue-400 bg-blue-900/30'
              : 'border-gray-600 text-gray-400 bg-gray-700'
          }`}
          title="Toggle auto-scroll to newest events"
        >
          {autoScroll ? '⬆ Live' : '⏸ Paused'}
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-3 py-2 bg-gray-850 border-b border-gray-700 overflow-x-auto">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs px-3 py-1 rounded-full whitespace-nowrap transition-colors ${
              filter === f.key
                ? 'bg-white text-gray-900 font-semibold'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Event list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto"
        onScroll={(e) => {
          // Disable auto-scroll if user scrolls down
          if (e.target.scrollTop > 50) setAutoScroll(false);
          else setAutoScroll(true);
        }}
      >
        {loading && (
          <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
            Loading audit trail…
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500 text-sm gap-2">
            <span className="text-2xl">📋</span>
            <span>No events yet</span>
          </div>
        )}

        {!loading &&
          filtered.map((ev, idx) => {
            const style = getEventStyle(ev.eventType);
            const isNew = idx === 0;
            return (
              <div
                key={ev.id || idx}
                className={`flex gap-3 px-4 py-3 border-b border-gray-800 ${style.bg} border-l-2 ${style.border} ${
                  isNew ? 'animate-pulse-once' : ''
                } hover:brightness-110 transition-all`}
              >
                {/* Dot + time column */}
                <div className="flex flex-col items-center gap-1 min-w-[52px]">
                  <span className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${style.dot}`} />
                  <span className="text-[10px] text-gray-400 font-mono leading-tight text-center">
                    {formatTime(ev.timestamp)}
                  </span>
                  <span className="text-[9px] text-gray-600 font-mono leading-tight text-center">
                    {formatDate(ev.timestamp)}
                  </span>
                </div>

                {/* Content column */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {/* Event type badge */}
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${style.badge}`}>
                      {ev.eventType || 'unknown'}
                    </span>
                    {/* Agent name */}
                    {ev.agent && (
                      <span className="text-[10px] text-gray-400 bg-gray-700 px-2 py-0.5 rounded-full">
                        {ev.agent}
                      </span>
                    )}
                  </div>

                  {/* Outcome / summary */}
                  {ev.outcome && (
                    <p className="text-xs text-gray-200 leading-snug mb-1 truncate" title={ev.outcome}>
                      {ev.outcome}
                    </p>
                  )}

                  {/* Payload details (collapsed inline) */}
                  {ev.payload && (
                    <PayloadPreview payload={ev.payload} />
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {/* Footer — live indicator */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 border-t border-gray-700 text-xs text-gray-400">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span>Live — immutable log • Firestore audit_log collection</span>
      </div>
    </div>
  );
};

/**
 * PayloadPreview renders a compact summary of an event payload object.
 * Shows key-value pairs for important fields, truncating long values.
 *
 * @param {{ payload: object }} props
 * @returns {JSX.Element|null}
 */
const PayloadPreview = ({ payload }) => {
  const [expanded, setExpanded] = useState(false);

  if (!payload || typeof payload !== 'object') return null;

  const entries = Object.entries(payload).filter(
    ([k]) => !['id', 'timestamp', 'createdAt', 'updatedAt'].includes(k)
  );

  if (entries.length === 0) return null;

  const preview = entries.slice(0, expanded ? entries.length : 3);

  return (
    <div className="mt-1">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {preview.map(([key, val]) => (
          <span key={key} className="text-[10px] text-gray-500">
            <span className="text-gray-400">{key}:</span>{' '}
            <span className="text-gray-300 font-mono">
              {typeof val === 'object' ? JSON.stringify(val).slice(0, 40) : String(val).slice(0, 40)}
            </span>
          </span>
        ))}
      </div>
      {entries.length > 3 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[10px] text-blue-400 hover:text-blue-300 mt-0.5"
        >
          {expanded ? '▲ less' : `▼ +${entries.length - 3} more`}
        </button>
      )}
    </div>
  );
};

export default AuditTrail;