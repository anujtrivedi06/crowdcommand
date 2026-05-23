import React, { useEffect, useState, useRef } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { t } from '../i18n';
import { getExitRoute } from '../services/api';

/**
 * ExitGuide component
 * Shows the fan's recommended exit route based on live crowd density.
 * Updates automatically via Firestore listeners when:
 *  - The orchestrator triggers a weather reroute
 *  - The wave exit sequence begins post-match
 *  - Zone densities shift significantly
 *
 * Renders a Google Maps embed with the exit route overlaid.
 * Falls back to a text-based route description if Maps fails to load.
 *
 * @param {{ fanId: string, gateId: string, lang: string }} props
 * @returns {JSX.Element}
 */
const ExitGuide = ({ fanId, gateId, lang }) => {
  const [exitRoute, setExitRoute] = useState(null);
  const [waveState, setWaveState] = useState(null);
  const [matchPhase, setMatchPhase] = useState('pre-match');
  const [weatherRerouted, setWeatherRerouted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mapRef = useRef(null);
  const fetchedRef = useRef(false);

  // ── Match state + wave sequence listener ─────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'config', 'matchState'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setMatchPhase(data.phase || 'pre-match');
        }
      },
      (err) => console.error('[ExitGuide] matchState listener error:', err.message)
    );
    return () => unsub();
  }, []);

  // ── Wave sequence listener ────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'config', 'waveSequence'),
      (snap) => {
        if (snap.exists()) setWaveState(snap.data());
      },
      (err) => console.error('[ExitGuide] waveSequence listener error:', err.message)
    );
    return () => unsub();
  }, []);

  // ── Weather reroute signal listener ──────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'config', 'weatherReroute'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setWeatherRerouted(data.active === true);
          // Re-fetch exit route when weather reroute activates
          if (data.active && fanId && gateId) {
            fetchExitRoute();
          }
        }
      },
      (err) => console.error('[ExitGuide] weatherReroute listener error:', err.message)
    );
    return () => unsub();
  }, [fanId, gateId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch exit route ──────────────────────────────────────────────────────
  const fetchExitRoute = async () => {
    if (!fanId || !gateId) return;
    setLoading(true);
    setError(null);
    try {
      const route = await getExitRoute(fanId, gateId);
      setExitRoute(route);
    } catch (err) {
      console.error('[ExitGuide] fetchExitRoute error:', err.message);
      setError(t('generic.error', lang));
      // Fallback route — always show something
      setExitRoute({
        exitGate: gateId,
        estimatedMinutes: 5,
        distanceMetres: 350,
        steps: ['Head to nearest exit sign', 'Follow green arrows', 'Exit via Gate ' + gateId],
        weatherRerouted: false,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      fetchExitRoute();
    }
  }, [fanId, gateId]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Determines if the fan's zone is cleared to exit in the wave sequence.
   * @returns {{ canExit: boolean, waveNumber: number|null, waitMinutes: number|null }}
   */
  const getWaveStatus = () => {
    if (!waveState || matchPhase !== 'post-match') {
      return { canExit: true, waveNumber: null, waitMinutes: null };
    }
    const zoneNum = parseInt(gateId, 10);
    const now = Date.now();

    // Wave 1: zones 1-4 — immediate
    if (zoneNum >= 1 && zoneNum <= 4) {
      return { canExit: true, waveNumber: 1, waitMinutes: 0 };
    }
    // Wave 2: zones 5-8 — after 4 minutes
    if (zoneNum >= 5 && zoneNum <= 8) {
      const wave2Time = waveState.startedAt?.toMillis?.() + 4 * 60 * 1000;
      const remaining = Math.max(0, Math.ceil((wave2Time - now) / 60000));
      return { canExit: now >= wave2Time, waveNumber: 2, waitMinutes: remaining };
    }
    // Wave 3: zones 9-12 — after 8 minutes
    const wave3Time = waveState.startedAt?.toMillis?.() + 8 * 60 * 1000;
    const remaining = Math.max(0, Math.ceil((wave3Time - now) / 60000));
    return { canExit: now >= wave3Time, waveNumber: 3, waitMinutes: remaining };
  };

  const waveStatus = getWaveStatus();
  const mapsApiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
  const stadiumLat = 12.9793;
  const stadiumLng = 77.5996;

  // Build Maps embed URL centred on the stadium
  const mapsEmbedUrl = mapsApiKey
    ? `https://www.google.com/maps/embed/v1/place?key=${mapsApiKey}&q=M+Chinnaswamy+Stadium+Bengaluru&zoom=17`
    : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm p-8">
        <div className="flex flex-col items-center gap-3">
          <span className="text-2xl animate-bounce">🗺️</span>
          <span className="animate-pulse">{t('exit.loadingMap', lang)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-6">
      {/* Header */}
      <h1 className="text-xl font-bold text-white">{t('exit.title', lang)}</h1>

      {/* Wave status banner — shown post-match */}
      {matchPhase === 'post-match' && waveState && (
        <div
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
            waveStatus.canExit
              ? 'border-green-600 bg-green-900/30 text-green-300'
              : 'border-amber-600 bg-amber-900/30 text-amber-300'
          }`}
        >
          <span className="text-2xl">{waveStatus.canExit ? '🚶' : '⏳'}</span>
          <div>
            {waveStatus.waveNumber && (
              <p className="text-[10px] uppercase tracking-wide font-semibold opacity-70 mb-0.5">
                Wave {waveStatus.waveNumber}
              </p>
            )}
            <p className="text-sm font-bold">
              {waveStatus.canExit
                ? t('exit.wave.go', lang)
                : `${t('exit.wave.waiting', lang)} — ${waveStatus.waitMinutes} min`}
            </p>
          </div>
        </div>
      )}

      {/* Weather reroute notice */}
      {weatherRerouted && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-blue-600 bg-blue-900/30 text-blue-300">
          <span className="text-xl">🌧️</span>
          <p className="text-sm">{t('exit.weatherReroute', lang)}</p>
        </div>
      )}

      {/* Google Maps embed */}
      <div className="rounded-xl overflow-hidden border border-gray-700 bg-gray-800" style={{ height: '220px' }}>
        {mapsEmbedUrl ? (
          <iframe
            ref={mapRef}
            title="Exit route map"
            src={mapsEmbedUrl}
            width="100%"
            height="220"
            style={{ border: 0 }}
            allowFullScreen={false}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        ) : (
          /* Fallback: static stadium illustration */
          <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-500">
            <span className="text-4xl">🏟️</span>
            <span className="text-xs text-center px-4">
              M. Chinnaswamy Stadium<br />
              {stadiumLat.toFixed(4)}°N, {stadiumLng.toFixed(4)}°E
            </span>
          </div>
        )}
      </div>

      {/* Route summary card */}
      {exitRoute && (
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">
            {t('exit.yourRoute', lang)}
          </p>

          {/* Key metrics row */}
          <div className="flex gap-4 mb-4">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">{t('exit.estimatedTime', lang)}</span>
              <span className="text-xl font-bold text-white">
                {exitRoute.estimatedMinutes ?? '—'}{' '}
                <span className="text-sm font-normal text-gray-400">{t('exit.minutes', lang)}</span>
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">{t('exit.distance', lang)}</span>
              <span className="text-xl font-bold text-white">
                {exitRoute.distanceMetres ?? '—'}{' '}
                <span className="text-sm font-normal text-gray-400">{t('exit.metres', lang)}</span>
              </span>
            </div>
            <div className="flex flex-col ml-auto items-end">
              <span className="text-xs text-gray-500">Exit gate</span>
              <span className="text-xl font-bold text-green-400">
                {t('generic.gate', lang)} {exitRoute.exitGate ?? gateId}
              </span>
            </div>
          </div>

          {/* Step-by-step directions */}
          {exitRoute.steps && exitRoute.steps.length > 0 && (
            <ol className="space-y-2">
              {exitRoute.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-700 text-white text-[10px] font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-sm text-gray-300 leading-snug">{step}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* General guidance */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 space-y-2">
        {[
          { icon: '🟢', key: 'exit.followSigns' },
          { icon: '⛔', key: 'exit.avoidZone' },
        ].map(({ icon, key }) => (
          <div key={key} className="flex items-center gap-3">
            <span className="text-lg">{icon}</span>
            <span className="text-sm text-gray-300">{t(key, lang)}</span>
          </div>
        ))}
      </div>

      {/* Error notice */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-900/30 border border-red-700 rounded-xl">
          <span>⚠️</span>
          <div className="flex-1">
            <p className="text-xs text-red-300">{error}</p>
          </div>
          <button
            onClick={fetchExitRoute}
            className="text-xs text-blue-400 underline"
          >
            {t('generic.retry', lang)}
          </button>
        </div>
      )}

      {/* Live indicator */}
      <div className="flex items-center gap-2 text-xs text-gray-500 justify-center">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        {t('generic.liveUpdates', lang)}
      </div>
    </div>
  );
};

export default ExitGuide;