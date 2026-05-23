import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useZones } from '../hooks/useFirestore';

const MAPS_API_KEY = process.env.REACT_APP_GOOGLE_MAPS_API_KEY || '';

/**
 * Stadium zone polygon definitions for M. Chinnaswamy Stadium, Bengaluru.
 * Each zone has a centre lat/lng and a rough bounding polygon.
 * Zones are arranged in a ring around the stadium perimeter.
 * @type {Array<{id: string, label: string, center: {lat, lng}, polygon: Array<{lat, lng}>}>}
 */
const ZONE_DEFINITIONS = [
  {
    id: 'zone-1', label: 'Zone 1 (North Stand)', gate: 'Gate 1',
    center: { lat: 12.9792, lng: 77.5998 },
    polygon: [
      { lat: 12.9800, lng: 77.5990 }, { lat: 12.9800, lng: 77.6006 },
      { lat: 12.9793, lng: 77.6006 }, { lat: 12.9793, lng: 77.5990 },
    ],
  },
  {
    id: 'zone-2', label: 'Zone 2 (North-East)', gate: 'Gate 2',
    center: { lat: 12.9791, lng: 77.6010 },
    polygon: [
      { lat: 12.9798, lng: 77.6006 }, { lat: 12.9798, lng: 77.6018 },
      { lat: 12.9786, lng: 77.6018 }, { lat: 12.9786, lng: 77.6006 },
    ],
  },
  {
    id: 'zone-3', label: 'Zone 3 (East Upper)', gate: 'Gate 3',
    center: { lat: 12.9783, lng: 77.6015 },
    polygon: [
      { lat: 12.9790, lng: 77.6010 }, { lat: 12.9790, lng: 77.6022 },
      { lat: 12.9778, lng: 77.6022 }, { lat: 12.9778, lng: 77.6010 },
    ],
  },
  {
    id: 'zone-4', label: 'Zone 4 (East Lower)', gate: 'Gate 4',
    center: { lat: 12.9774, lng: 77.6013 },
    polygon: [
      { lat: 12.9780, lng: 77.6008 }, { lat: 12.9780, lng: 77.6020 },
      { lat: 12.9768, lng: 77.6020 }, { lat: 12.9768, lng: 77.6008 },
    ],
  },
  {
    id: 'zone-5', label: 'Zone 5 (South-East)', gate: 'Gate 5',
    center: { lat: 12.9765, lng: 77.6008 },
    polygon: [
      { lat: 12.9772, lng: 77.6002 }, { lat: 12.9772, lng: 77.6015 },
      { lat: 12.9758, lng: 77.6015 }, { lat: 12.9758, lng: 77.6002 },
    ],
  },
  {
    id: 'zone-6', label: 'Zone 6 (South Stand)', gate: 'Gate 6',
    center: { lat: 12.9760, lng: 77.5998 },
    polygon: [
      { lat: 12.9766, lng: 77.5990 }, { lat: 12.9766, lng: 77.6005 },
      { lat: 12.9754, lng: 77.6005 }, { lat: 12.9754, lng: 77.5990 },
    ],
  },
  {
    id: 'zone-7', label: 'Zone 7 (South-West)', gate: 'Gate 7',
    center: { lat: 12.9763, lng: 77.5984 },
    polygon: [
      { lat: 12.9770, lng: 77.5978 }, { lat: 12.9770, lng: 77.5992 },
      { lat: 12.9756, lng: 77.5992 }, { lat: 12.9756, lng: 77.5978 },
    ],
  },
  {
    id: 'zone-8', label: 'Zone 8 (West Lower)', gate: 'Gate 8',
    center: { lat: 12.9772, lng: 77.5978 },
    polygon: [
      { lat: 12.9779, lng: 77.5972 }, { lat: 12.9779, lng: 77.5985 },
      { lat: 12.9765, lng: 77.5985 }, { lat: 12.9765, lng: 77.5972 },
    ],
  },
  {
    id: 'zone-9', label: 'Zone 9 (West Upper)', gate: 'Gate 9',
    center: { lat: 12.9781, lng: 77.5974 },
    polygon: [
      { lat: 12.9788, lng: 77.5968 }, { lat: 12.9788, lng: 77.5981 },
      { lat: 12.9774, lng: 77.5981 }, { lat: 12.9774, lng: 77.5968 },
    ],
  },
  {
    id: 'zone-10', label: 'Zone 10 (North-West)', gate: 'Gate 10',
    center: { lat: 12.9789, lng: 77.5977 },
    polygon: [
      { lat: 12.9796, lng: 77.5972 }, { lat: 12.9796, lng: 77.5985 },
      { lat: 12.9782, lng: 77.5985 }, { lat: 12.9782, lng: 77.5972 },
    ],
  },
  {
    id: 'zone-11', label: 'Zone 11 (VIP Pavilion)', gate: 'Gate 11',
    center: { lat: 12.9793, lng: 77.5985 },
    polygon: [
      { lat: 12.9799, lng: 77.5980 }, { lat: 12.9799, lng: 77.5992 },
      { lat: 12.9787, lng: 77.5992 }, { lat: 12.9787, lng: 77.5980 },
    ],
  },
  {
    id: 'zone-12', label: 'Zone 12 (Media & Press)', gate: 'Gate 12',
    center: { lat: 12.9795, lng: 77.5993 },
    polygon: [
      { lat: 12.9801, lng: 77.5988 }, { lat: 12.9801, lng: 77.5999 },
      { lat: 12.9789, lng: 77.5999 }, { lat: 12.9789, lng: 77.5988 },
    ],
  },
];

/**
 * Returns a hex fill colour for a density value.
 * @param {number} density - Zone density 0–100.
 * @returns {string} Hex colour string.
 */
function densityToColour(density) {
  if (density >= 75) return '#ef4444'; // red
  if (density >= 50) return '#f59e0b'; // amber
  return '#22c55e';                    // green
}

/**
 * Returns fill opacity scaled with density.
 * @param {number} density - Zone density 0–100.
 * @returns {number} Opacity between 0.25 and 0.75.
 */
function densityToOpacity(density) {
  return 0.25 + (density / 100) * 0.5;
}

/**
 * Loads the Google Maps JavaScript API script once.
 * @param {string} apiKey - Google Maps API key.
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
 * CrowdHeatmap — renders a Google Maps embed with per-zone polygon overlays
 * colour-coded by live crowd density from Firestore. Clicking a zone shows
 * a density popup with trend and alert count.
 *
 * @returns {JSX.Element}
 */
export default function CrowdHeatmap() {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const polygonsRef = useRef({});
  const infoWindowRef = useRef(null);

  const { zones, loading } = useZones();
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  const [selectedZone, setSelectedZone] = useState(null);

  // Build a lookup map from zoneId -> Firestore document
  const zoneDataMap = {};
  zones.forEach((z) => { zoneDataMap[z.id] = z; });

  // Load Google Maps script
  useEffect(() => {
    if (!MAPS_API_KEY) { setMapsError(true); return; }
    loadMapsScript(MAPS_API_KEY)
      .then(() => setMapsReady(true))
      .catch(() => setMapsError(true));
  }, []);

  // Initialise map once script is ready
  useEffect(() => {
    if (!mapsReady || !mapRef.current || mapInstanceRef.current) return;

    const map = new window.google.maps.Map(mapRef.current, {
      center: { lat: 12.9780, lng: 77.5995 },
      zoom: 16,
      mapTypeId: 'satellite',
      disableDefaultUI: false,
      zoomControl: true,
      streetViewControl: false,
      mapTypeControl: false,
    });

    mapInstanceRef.current = map;
    infoWindowRef.current = new window.google.maps.InfoWindow();

    // Draw initial polygons for all 12 zones
    ZONE_DEFINITIONS.forEach((zoneDef) => {
      const poly = new window.google.maps.Polygon({
        paths: zoneDef.polygon,
        strokeColor: '#ffffff',
        strokeOpacity: 0.8,
        strokeWeight: 1.5,
        fillColor: '#22c55e',
        fillOpacity: 0.3,
        map,
      });

      poly.addListener('click', (e) => {
        setSelectedZone(zoneDef.id);
        const data = zoneDataMap[zoneDef.id];
        const density = data?.density ?? '—';
        const trend = data?.trend ?? 'unknown';
        const trendIcon = trend === 'increasing' ? '↑' : trend === 'decreasing' ? '↓' : '→';
        const content = `
          <div style="font-family:sans-serif;min-width:160px">
            <strong style="font-size:13px">${zoneDef.label}</strong><br/>
            <span style="font-size:12px">Gate: ${zoneDef.gate}</span><br/>
            <span style="font-size:18px;font-weight:bold;color:${densityToColour(density)}">${density}%</span>
            <span style="font-size:11px;margin-left:4px">${trendIcon} ${trend}</span>
          </div>`;
        infoWindowRef.current.setContent(content);
        infoWindowRef.current.setPosition(e.latLng);
        infoWindowRef.current.open(map);
      });

      polygonsRef.current[zoneDef.id] = poly;
    });
  }, [mapsReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update polygon colours whenever zone data changes
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    ZONE_DEFINITIONS.forEach((zoneDef) => {
      const poly = polygonsRef.current[zoneDef.id];
      if (!poly) return;
      const data = zoneDataMap[zoneDef.id];
      const density = data?.density ?? 0;
      poly.setOptions({
        fillColor: densityToColour(density),
        fillOpacity: densityToOpacity(density),
      });
    });
  }, [zones]); // eslint-disable-line react-hooks/exhaustive-deps

  // Legend component
  const Legend = () => (
    <div className="absolute bottom-4 left-4 bg-gray-900 bg-opacity-90 rounded-lg p-3 text-xs text-white space-y-1 z-10">
      <div className="font-semibold mb-1 text-gray-300">Crowd Density</div>
      {[
        { colour: '#22c55e', label: 'Low (< 50%)' },
        { colour: '#f59e0b', label: 'Medium (50–75%)' },
        { colour: '#ef4444', label: 'High (> 75%)' },
      ].map(({ colour, label }) => (
        <div key={label} className="flex items-center gap-2">
          <span style={{ background: colour, width: 12, height: 12, display: 'inline-block', borderRadius: 2 }} />
          {label}
        </div>
      ))}
    </div>
  );

  // Zone summary bar
  const ZoneSummaryBar = () => {
    const high = zones.filter((z) => (z.density ?? 0) >= 75).length;
    const med = zones.filter((z) => (z.density ?? 0) >= 50 && (z.density ?? 0) < 75).length;
    const low = zones.filter((z) => (z.density ?? 0) < 50).length;
    return (
      <div className="flex gap-4 text-xs px-1 mt-2">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /><span className="text-gray-300">Critical: <strong className="text-white">{high}</strong></span></span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /><span className="text-gray-300">Medium: <strong className="text-white">{med}</strong></span></span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /><span className="text-gray-300">Low: <strong className="text-white">{low}</strong></span></span>
        <span className="ml-auto text-gray-500">M. Chinnaswamy Stadium · {zones.length}/12 zones live</span>
      </div>
    );
  };

  if (mapsError) {
    return (
      <div className="w-full h-full flex flex-col">
        <ZoneSummaryBar />
        <div className="flex-1 bg-gray-800 rounded-lg flex items-center justify-center mt-2">
          <div className="text-center text-gray-400 space-y-2">
            <div className="text-4xl">🗺️</div>
            <div className="text-sm">Google Maps unavailable</div>
            <div className="text-xs text-gray-500">Set REACT_APP_GOOGLE_MAPS_API_KEY</div>
            {/* Fallback grid view */}
            <div className="grid grid-cols-4 gap-2 mt-4">
              {ZONE_DEFINITIONS.map((zd) => {
                const data = zoneDataMap[zd.id];
                const density = data?.density ?? 0;
                return (
                  <div
                    key={zd.id}
                    className="rounded p-2 text-center cursor-pointer"
                    style={{ background: densityToColour(density) + '44', border: `1px solid ${densityToColour(density)}` }}
                    onClick={() => setSelectedZone(zd.id === selectedZone ? null : zd.id)}
                  >
                    <div className="text-xs font-bold" style={{ color: densityToColour(density) }}>{density}%</div>
                    <div className="text-xs text-gray-300">{zd.gate}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      <ZoneSummaryBar />
      <div className="relative flex-1 mt-2 rounded-lg overflow-hidden">
        {(loading || !mapsReady) && (
          <div className="absolute inset-0 z-20 bg-gray-900 flex items-center justify-center rounded-lg">
            <div className="text-center space-y-2">
              <div className="animate-spin text-3xl">⚙️</div>
              <div className="text-gray-400 text-sm">Loading heatmap…</div>
            </div>
          </div>
        )}
        <div ref={mapRef} className="w-full h-full" style={{ minHeight: 360 }} />
        {mapsReady && <Legend />}
      </div>
    </div>
  );
}