import React, { useEffect, useRef, useState } from 'react';
import { useActiveSOS } from '../hooks/useFirestore';
import { resolveSOS } from '../services/api';

const MAPS_API_KEY = process.env.REACT_APP_GOOGLE_MAPS_API_KEY || '';

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
 * Returns elapsed seconds since a Firestore Timestamp or ISO string.
 * @param {object|string|null} ts
 * @returns {number}
 */
function elapsedSeconds(ts) {
  if (!ts) return 0;
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
}

/**
 * Formats elapsed seconds as mm:ss.
 * @param {number} secs
 * @returns {string}
 */
function formatElapsed(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Loads the Google Maps JS API once.
 * @param {string} apiKey
 * @returns {Promise<void>}
 */
function loadMapsScript(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) { resolve(); return; }
    const existing = document.getElementById('gmap-script');
    if (existing) { existing.addEventListener('load', resolve); return; }
    const script = document.createElement('script');
    script.id = 'gmap-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(script);
  });
}

/**
 * SOSTracker — displays all active SOS incidents as pulsing red markers on a
 * Google Maps embed. Shows incident details and allows operators to resolve.
 *
 * @returns {JSX.Element}
 */
export default function SOSTracker() {
  const { sosList, loading } = useActiveSOS();
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const infoWindowRef = useRef(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  const [selectedSOS, setSelectedSOS] = useState(null);
  const [resolving, setResolving] = useState(null);
  const [elapsed, setElapsed] = useState({});

  // Tick elapsed timers every second
  useEffect(() => {
    const interval = setInterval(() => {
      const updated = {};
      sosList.forEach((s) => {
        updated[s.id] = elapsedSeconds(s.createdAt);
      });
      setElapsed(updated);
    }, 1000);
    return () => clearInterval(interval);
  }, [sosList]);

  // Load Maps script
  useEffect(() => {
    if (!MAPS_API_KEY) { setMapsError(true); return; }
    loadMapsScript(MAPS_API_KEY)
      .then(() => setMapsReady(true))
      .catch(() => setMapsError(true));
  }, []);

  // Initialise map
  useEffect(() => {
    if (!mapsReady || !mapRef.current || mapInstanceRef.current) return;
    const map = new window.google.maps.Map(mapRef.current, {
      center: { lat: 12.9780, lng: 77.5995 },
      zoom: 16,
      mapTypeId: 'roadmap',
      disableDefaultUI: false,
      zoomControl: true,
      streetViewControl: false,
      mapTypeControl: false,
    });
    mapInstanceRef.current = map;
    infoWindowRef.current = new window.google.maps.InfoWindow();
  }, [mapsReady]);

  // Sync SOS markers with Firestore data
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    const map = mapInstanceRef.current;
    const currentIds = new Set(sosList.map((s) => s.id));

    // Remove stale markers
    Object.keys(markersRef.current).forEach((id) => {
      if (!currentIds.has(id)) {
        markersRef.current[id].setMap(null);
        delete markersRef.current[id];
      }
    });

    // Add or update markers
    sosList.forEach((sos) => {
      const lat = sos.location?.lat ?? sos.lat;
      const lng = sos.location?.lng ?? sos.lng;
      if (!lat || !lng) return;

      if (!markersRef.current[sos.id]) {
        // Create pulsing red marker using a custom SVG icon
        const marker = new window.google.maps.Marker({
          position: { lat, lng },
          map,
          title: `SOS — ${sos.fanId || sos.id}`,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: '#ef4444',
            fillOpacity: 0.9,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
          animation: window.google.maps.Animation.BOUNCE,
          zIndex: 999,
        });

        marker.addListener('click', () => {
          setSelectedSOS(sos.id === selectedSOS ? null : sos.id);
          const content = `
            <div style="font-family:sans-serif;min-width:180px;color:#111">
              <strong style="color:#ef4444">🆘 SOS Incident</strong><br/>
              <span style="font-size:12px">Fan: ${sos.fanId || 'Unknown'}</span><br/>
              <span style="font-size:12px">Zone: ${sos.zone || '—'}</span><br/>
              <span style="font-size:11px;color:#666">Reported: ${formatTime(sos.createdAt)}</span>
            </div>`;
          infoWindowRef.current.setContent(content);
          infoWindowRef.current.open(map, marker);
        });

        markersRef.current[sos.id] = marker;
      } else {
        // Update position if changed
        markersRef.current[sos.id].setPosition({ lat, lng });
      }
    });

    // Auto-fit bounds if there are active SOSes
    if (sosList.length > 0) {
      const bounds = new window.google.maps.LatLngBounds();
      sosList.forEach((sos) => {
        const lat = sos.location?.lat ?? sos.lat;
        const lng = sos.location?.lng ?? sos.lng;
        if (lat && lng) bounds.extend({ lat, lng });
      });
      if (!bounds.isEmpty()) map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
    }
  }, [sosList, mapsReady]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Resolve an SOS incident.
   * @param {string} sosId
   */
  const handleResolve = async (sosId) => {
    setResolving(sosId);
    try {
      await resolveSOS(sosId, 'operator-dashboard');
    } catch (err) {
      console.error('[SOSTracker] resolveSOS error:', err);
    } finally {
      setResolving(null);
    }
  };

  const activeCount = sosList.length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white">SOS Tracker</h2>
          {activeCount > 0 && (
            <span className="bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
              {activeCount} ACTIVE
            </span>
          )}
        </div>
        {activeCount === 0 && !loading && (
          <span className="text-xs text-green-400">All clear</span>
        )}
      </div>

      {/* Map */}
      <div className="relative rounded-lg overflow-hidden mb-3" style={{ height: 220 }}>
        {(!mapsReady || loading) && (
          <div className="absolute inset-0 bg-gray-900 flex items-center justify-center z-10">
            <span className="text-gray-500 text-xs">
              {mapsError ? 'Map unavailable — set REACT_APP_GOOGLE_MAPS_API_KEY' : 'Loading map…'}
            </span>
          </div>
        )}
        {mapsError && activeCount > 0 && (
          <div className="absolute inset-0 bg-gray-900 flex items-center justify-center z-10">
            <div className="text-center">
              <div className="text-red-500 text-2xl mb-1">📍</div>
              <div className="text-xs text-gray-400">{activeCount} active SOS — map unavailable</div>
            </div>
          </div>
        )}
        <div ref={mapRef} className="w-full h-full" />
        {activeCount === 0 && mapsReady && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-600 text-xs bg-gray-900 bg-opacity-70 px-2 py-1 rounded">
              No active SOS incidents
            </span>
          </div>
        )}
      </div>

      {/* Incident list */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {loading && (
          <div className="text-center text-gray-500 text-xs py-4">Loading…</div>
        )}
        {!loading && sosList.length === 0 && (
          <div className="text-center text-gray-600 text-xs py-4">
            <div className="text-xl mb-1">✅</div>
            No active SOS incidents
          </div>
        )}
        {sosList.map((sos) => {
          const secs = elapsed[sos.id] ?? elapsedSeconds(sos.createdAt);
          const isUrgent = secs > 120; // 2 min without resolution
          return (
            <div
              key={sos.id}
              className={`bg-gray-800 rounded-lg p-3 border ${isUrgent ? 'border-red-600' : 'border-gray-700'} cursor-pointer`}
              onClick={() => setSelectedSOS(selectedSOS === sos.id ? null : sos.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-red-500 text-base animate-pulse">🆘</span>
                  <div>
                    <div className="text-xs font-semibold text-white">
                      Fan: {sos.fanId || sos.id.slice(0, 8)}
                    </div>
                    <div className="text-xs text-gray-400">
                      Zone {sos.zone || '—'} · {formatTime(sos.createdAt)}
                    </div>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`text-xs font-mono font-bold ${isUrgent ? 'text-red-400' : 'text-amber-400'}`}>
                    {formatElapsed(secs)}
                  </div>
                  <div className="text-xs text-gray-600">elapsed</div>
                </div>
              </div>

              {/* Responders */}
              {sos.assignedSecurity && sos.assignedSecurity.length > 0 && (
                <div className="mt-1 text-xs text-blue-400">
                  👮 Responding: {sos.assignedSecurity.join(', ')}
                </div>
              )}

              {/* Expanded detail */}
              {selectedSOS === sos.id && (
                <div className="mt-2 pt-2 border-t border-gray-700 space-y-1 text-xs text-gray-400">
                  {sos.location && (
                    <div>Coords: {sos.location.lat?.toFixed(5)}, {sos.location.lng?.toFixed(5)}</div>
                  )}
                  {sos.exitRoute && (
                    <div className="text-green-400">Exit route: {sos.exitRoute}</div>
                  )}
                  <div>Status: <span className="text-white">{sos.status}</span></div>
                  <button
                    disabled={resolving === sos.id}
                    onClick={(e) => { e.stopPropagation(); handleResolve(sos.id); }}
                    className="mt-1 w-full text-xs px-2 py-1 bg-green-800 hover:bg-green-700 text-green-300 rounded transition-colors disabled:opacity-50"
                  >
                    {resolving === sos.id ? 'Resolving…' : '✓ Mark Resolved'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="mt-2 text-xs text-gray-600 text-right">
        {activeCount} active · real-time
      </div>
    </div>
  );
}