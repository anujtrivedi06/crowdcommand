import React, { useState } from 'react';
import { useCollection, useDocument } from '../hooks/useFirestore';

/**
 * Returns display config for a weather event type.
 * @param {string} type - Weather event type string.
 * @returns {{ icon: string, label: string, colour: string, bgClass: string, borderClass: string }}
 */
function weatherTypeConfig(type) {
  const map = {
    rain: {
      icon: '🌧️',
      label: 'Rain',
      colour: 'text-blue-400',
      bgClass: 'bg-blue-900 bg-opacity-30',
      borderClass: 'border-blue-700',
    },
    lightning: {
      icon: '⚡',
      label: 'Lightning',
      colour: 'text-yellow-400',
      bgClass: 'bg-yellow-900 bg-opacity-30',
      borderClass: 'border-yellow-600',
    },
    heatwave: {
      icon: '🌡️',
      label: 'Heatwave',
      colour: 'text-orange-400',
      bgClass: 'bg-orange-900 bg-opacity-30',
      borderClass: 'border-orange-600',
    },
    fog: {
      icon: '🌫️',
      label: 'Fog',
      colour: 'text-gray-400',
      bgClass: 'bg-gray-800',
      borderClass: 'border-gray-600',
    },
    clear: {
      icon: '☀️',
      label: 'Clear',
      colour: 'text-green-400',
      bgClass: 'bg-green-900 bg-opacity-20',
      borderClass: 'border-green-800',
    },
  };
  return (
    map[type?.toLowerCase()] || {
      icon: '🌤️',
      label: type || 'Unknown',
      colour: 'text-gray-400',
      bgClass: 'bg-gray-800',
      borderClass: 'border-gray-700',
    }
  );
}

/**
 * Returns display config for a risk level.
 * @param {string} level - Risk level string (low/medium/high/critical).
 * @returns {{ label: string, badgeClass: string, ringClass: string }}
 */
function riskConfig(level) {
  const map = {
    low: { label: 'Low Risk', badgeClass: 'bg-green-800 text-green-300', ringClass: '' },
    medium: { label: 'Medium Risk', badgeClass: 'bg-amber-800 text-amber-300', ringClass: 'ring-1 ring-amber-600' },
    high: { label: 'High Risk', badgeClass: 'bg-red-800 text-red-300', ringClass: 'ring-1 ring-red-600' },
    critical: {
      label: 'Critical Risk',
      badgeClass: 'bg-red-700 text-white animate-pulse',
      ringClass: 'ring-2 ring-red-500',
    },
  };
  return (
    map[level?.toLowerCase()] || {
      label: 'Unknown',
      badgeClass: 'bg-gray-700 text-gray-300',
      ringClass: '',
    }
  );
}

/**
 * Formats a Firestore Timestamp or ISO string.
 * @param {object|string|null} ts
 * @returns {string}
 */
function formatTime(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * WeatherWidget — displays the current and recent weather events for
 * M. Chinnaswamy Stadium with Gemini risk reasoning. Reflects weather
 * agent signals in real time via Firestore onSnapshot.
 *
 * @returns {JSX.Element}
 */
export default function WeatherWidget() {
  const { data: weatherEvents, loading } = useCollection('weather_events');
  const { data: weatherSignal } = useDocument('agent_signals/weather_latest');
  const [expandReasoning, setExpandReasoning] = useState(false);

  // Most recent event is first after sorting by timestamp desc
  const sorted = [...weatherEvents].sort((a, b) => {
    const ta = a.timestamp?.toMillis ? a.timestamp.toMillis() : new Date(a.timestamp || 0).getTime();
    const tb = b.timestamp?.toMillis ? b.timestamp.toMillis() : new Date(b.timestamp || 0).getTime();
    return tb - ta;
  });

  const latest = sorted[0] || null;
  const eventType = latest?.eventType || latest?.type || 'clear';
  const riskLevel = latest?.riskLevel || weatherSignal?.severity || 'low';
  const reasoning = latest?.reasoning || weatherSignal?.payload?.reasoning || null;
  const recommendation = latest?.recommendation || weatherSignal?.payload?.recommendation || null;
  const affectedZones = latest?.affectedZones || weatherSignal?.affectedZones || [];

  const typeCfg = weatherTypeConfig(eventType);
  const risk = riskConfig(riskLevel);

  // Stadium weather stats (from latest event or defaults)
  const temp = latest?.temperature ?? 28;
  const humidity = latest?.humidity ?? 62;
  const windSpeed = latest?.windSpeed ?? 12;
  const visibility = latest?.visibility ?? 'Good';

  return (
    <div className={`rounded-lg border p-3 transition-all ${typeCfg.bgClass} ${typeCfg.borderClass} ${risk.ringClass}`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{typeCfg.icon}</span>
          <div>
            <div className={`text-sm font-semibold ${typeCfg.colour}`}>{typeCfg.label}</div>
            <div className="text-xs text-gray-500">M. Chinnaswamy Stadium</div>
          </div>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${risk.badgeClass}`}>
          {risk.label}
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-1 mb-2">
        {[
          { label: 'Temp', value: `${temp}°C` },
          { label: 'Humidity', value: `${humidity}%` },
          { label: 'Wind', value: `${windSpeed} km/h` },
          { label: 'Visibility', value: visibility },
        ].map(({ label, value }) => (
          <div key={label} className="bg-gray-900 bg-opacity-50 rounded p-1.5 text-center">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-xs font-semibold text-white">{value}</div>
          </div>
        ))}
      </div>

      {/* Affected zones */}
      {affectedZones.length > 0 && (
        <div className="text-xs text-gray-400 mb-2">
          Affected zones:{' '}
          <span className={`font-medium ${typeCfg.colour}`}>
            {affectedZones.join(', ')}
          </span>
        </div>
      )}

      {/* Recommendation */}
      {recommendation && (
        <div className="text-xs text-amber-300 bg-amber-900 bg-opacity-30 rounded px-2 py-1 mb-2 border border-amber-800">
          ⚡ {recommendation}
        </div>
      )}

      {/* Gemini reasoning (collapsible) */}
      {reasoning && (
        <div className="mt-1">
          <button
            onClick={() => setExpandReasoning(!expandReasoning)}
            className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 transition-colors"
          >
            <span>AI reasoning</span>
            <span>{expandReasoning ? '▲' : '▼'}</span>
          </button>
          {expandReasoning && (
            <div className="mt-1 text-xs text-gray-400 italic bg-gray-900 bg-opacity-50 rounded p-2 leading-relaxed">
              {reasoning}
            </div>
          )}
        </div>
      )}

      {/* Recent events list */}
      {sorted.length > 1 && (
        <div className="mt-2 pt-2 border-t border-gray-700">
          <div className="text-xs text-gray-600 mb-1">Recent events</div>
          <div className="space-y-0.5">
            {sorted.slice(1, 4).map((evt) => {
              const cfg = weatherTypeConfig(evt.eventType || evt.type);
              return (
                <div key={evt.id} className="flex items-center gap-2 text-xs text-gray-500">
                  <span>{cfg.icon}</span>
                  <span className={cfg.colour}>{cfg.label}</span>
                  <span className="ml-auto">{formatTime(evt.timestamp)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Timestamp */}
      {latest && (
        <div className="mt-2 text-xs text-gray-600 text-right">
          Updated {formatTime(latest.timestamp)}
        </div>
      )}

      {loading && !latest && (
        <div className="text-xs text-gray-600 text-center py-2">Loading weather…</div>
      )}

      {!loading && !latest && (
        <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
          <span>☀️</span>
          <span>No weather events — conditions nominal</span>
        </div>
      )}
    </div>
  );
}