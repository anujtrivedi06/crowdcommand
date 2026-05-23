import React, { useEffect, useRef, useState } from 'react';
import { useVolunteers } from '../hooks/useFirestore';

const MAPS_API_KEY = process.env.REACT_APP_MAPS_API_KEY || '';

/**
 * Returns marker colour config for a volunteer status.
 * @param {string} status - Volunteer status.
 * @param {string} role - Volunteer role.
 * @returns {{ fillColor: string, label: string, badgeClass: string }}
 */
function volunteerStyle(status, role) {
  const isSecurtiy = role === 'security';
  const map = {
    available: {
      fillColor: '#22c55e',
      label: 'Available',
      badgeClass: 'bg-green-900 text-green-300',
    },
    assigned: {
      fillColor: '#f59e0b',
      label: 'Assigned',
      badgeClass: 'bg-amber-900 text-amber-300',
    },
    responding: {
      fillColor: '#ef4444',
      label: 'Responding',
      badgeClass: 'bg-red-900 text-red-300',
    },
  };
  return map[status] || { fillColor: '#6b7280', label: status, badgeClass: 'bg-gray-700 text-gray-300' };
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
 * VolunteerMap — renders all 20 volunteers as colour-coded dots on a Google
 * Maps embed. Green = available, amber = assigned, red = responding.
 * Clicking a dot shows name, zone, role, and current task.
 *
 * @returns {JSX.Element}
 */
export default function VolunteerMap() {
  const { volunteers, loading } = useVolunteers();
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const infoWindowRef = useRef(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedId, setSelectedId] = useState(null);

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

  // Sync volunteer markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const currentIds = new Set(volunteers.map((v) => v.id));

    // Remove stale markers
    Object.keys(markersRef.current).forEach((id) => {
      if (!currentIds.has(id)) {
        markersRef.current[id].setMap(null);
        delete markersRef.current[id];
      }
    });

    volunteers.forEach((vol) => {
      const lat = vol.location?.lat ?? vol.lat;
      const lng = vol.location?.lng ?? vol.lng;
      if (!lat || !lng) return;

      const style = volunteerStyle(vol.status, vol.role);
      const isResponding = vol.status === 'responding';

      if (!markersRef.current[vol.id]) {
        const marker = new window.google.maps.Marker({
          position: { lat, lng },
          map,
          title: vol.name || vol.id,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: vol.role === 'security' ? 9 : 7,
            fillColor: style.fillColor,
            fillOpacity: 0.9,
            strokeColor: vol.role === 'security' ? '#ffffff' : '#374151',
            strokeWeight: vol.role === 'security' ? 2 : 1,
          },
          animation: isResponding ? window.google.maps.Animation.BOUNCE : null,
          zIndex: isResponding ? 100 : 10,
        });

        marker.addListener('click', () => {
          setSelectedId(vol.id);
          const content = `
            <div style="font-family:sans-serif;min-width:160px;color:#111">
              <strong>${vol.name || vol.id}</strong>
              <span style="font-size:11px;margin-left:6px;color:${style.fillColor}">${style.label}</span><br/>
              <span style="font-size:12px">Role: ${vol.role || 'volunteer'}</span><br/>
              <span style="font-size:12px">Zone: ${vol.zone || '—'}</span><br/>
              ${vol.currentTask ? `<span style="font-size:11px;color:#555">Task: ${vol.currentTask}</span>` : ''}
            </div>`;
          infoWindowRef.current.setContent(content);
          infoWindowRef.current.open(map, marker);
        });

        markersRef.current[vol.id] = marker;
      } else {
        const marker = markersRef.current[vol.id];
        marker.setPosition({ lat, lng });
        marker.setIcon({
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: vol.role === 'security' ? 9 : 7,
          fillColor: style.fillColor,
          fillOpacity: 0.9,
          strokeColor: vol.role === 'security' ? '#ffffff' : '#374151',
          strokeWeight: vol.role === 'security' ? 2 : 1,
        });
        marker.setAnimation(isResponding ? window.google.maps.Animation.BOUNCE : null);
      }
    });
  }, [volunteers, mapsReady]);

  // Summary counts
  const available = volunteers.filter((v) => v.status === 'available').length;
  const assigned = volunteers.filter((v) => v.status === 'assigned').length;
  const responding = volunteers.filter((v) => v.status === 'responding').length;
  const security = volunteers.filter((v) => v.role === 'security').length;

  // Filtered list for sidebar
  const filtered = filterStatus === 'all'
    ? volunteers
    : volunteers.filter((v) => v.status === filterStatus);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-white">Volunteer Map</h2>
        <div className="flex gap-2 text-xs">
          <span className="text-green-400">{available} avail</span>
          <span className="text-amber-400">{assigned} assigned</span>
          {responding > 0 && <span className="text-red-400 font-bold animate-pulse">{responding} responding</span>}
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-3 mb-2 text-xs">
        {[
          { colour: '#22c55e', label: 'Available' },
          { colour: '#f59e0b', label: 'Assigned' },
          { colour: '#ef4444', label: 'Responding' },
        ].map(({ colour, label }) => (
          <span key={label} className="flex items-center gap-1 text-gray-400">
            <span style={{ background: colour, width: 8, height: 8, borderRadius: '50%', display: 'inline-block' }} />
            {label}
          </span>
        ))}
        <span className="text-gray-500 ml-auto">{security} security staff</span>
      </div>

      {/* Map */}
      <div className="relative rounded-lg overflow-hidden mb-2" style={{ height: 220 }}>
        {(!mapsReady || loading) && !mapsError && (
          <div className="absolute inset-0 bg-gray-900 flex items-center justify-center z-10">
            <span className="text-gray-500 text-xs">Loading map…</span>
          </div>
        )}
        {mapsError && (
          <div className="absolute inset-0 bg-gray-900 flex items-center justify-center z-10">
            <div className="text-center">
              <div className="text-3xl mb-1">👤</div>
              <div className="text-xs text-gray-400">Map unavailable</div>
              <div className="text-xs text-gray-600">Set REACT_APP_MAPS_API_KEY</div>
            </div>
          </div>
        )}
        <div ref={mapRef} className="w-full h-full" />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-2">
        {['all', 'available', 'assigned', 'responding'].map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`text-xs px-2 py-0.5 rounded capitalize transition-colors ${
              filterStatus === s ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Volunteer list */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {loading && <div className="text-xs text-gray-500 text-center py-4">Loading volunteers…</div>}
        {!loading && filtered.length === 0 && (
          <div className="text-xs text-gray-600 text-center py-4">No volunteers in this filter</div>
        )}
        {filtered.map((vol) => {
          const style = volunteerStyle(vol.status, vol.role);
          return (
            <div
              key={vol.id}
              className={`flex items-center gap-2 px-2 py-1.5 rounded bg-gray-800 hover:bg-gray-750 cursor-pointer ${selectedId === vol.id ? 'ring-1 ring-indigo-500' : ''}`}
              onClick={() => setSelectedId(selectedId === vol.id ? null : vol.id)}
            >
              <span
                style={{ background: style.fillColor, width: 8, height: 8, borderRadius: '50%', flexShrink: 0 }}
                className={vol.status === 'responding' ? 'animate-pulse' : ''}
              />
              <span className="text-xs text-white truncate flex-1">{vol.name || vol.id}</span>
              <span className="text-xs text-gray-500">{vol.zone || '—'}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${style.badgeClass}`}>
                {style.label}
              </span>
              {vol.role === 'security' && (
                <span className="text-xs text-blue-400">🛡</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="mt-2 text-xs text-gray-600 text-right">
        {volunteers.length} volunteers · real-time
      </div>
    </div>
  );
}