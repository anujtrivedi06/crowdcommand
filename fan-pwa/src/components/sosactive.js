import React, { useState, useEffect, useRef } from 'react';
import { t } from '../i18n';

/**
 * SOSActive component — rendered after a successful SOS submission.
 * Shows the exit route on a Google Maps embed, "Security is on the way"
 * status, and animates a security responder dot moving toward the fan
 * using linear interpolation over 90 seconds.
 *
 * @param {Object} props
 * @param {string} props.sosId — active SOS document ID
 * @param {Object} props.exitRoute — exit route object from SOS response { steps, exitGate, distance }
 * @param {string} props.fanId — fan identifier
 * @param {string} props.lang — active language key (en/hi/kn)
 * @param {number} props.fanLat — fan latitude
 * @param {number} props.fanLng — fan longitude
 */
export default function SOSActive({ sosId, exitRoute, fanId, lang, fanLat, fanLng }) {
  const [elapsed, setElapsed] = useState(0); // seconds since SOS confirmed
  const [responderProgress, setResponderProgress] = useState(0); // 0–1 lerp factor
  const [pulseActive, setPulseActive] = useState(true);
  const intervalRef = useRef(null);
  const RESPONSE_DURATION = 90; // seconds for responder animation

  // Stadium security start position (north stand — offset from fan)
  const securityStartLat = (fanLat || 12.9784) + 0.0008;
  const securityStartLng = (fanLng || 77.5996) - 0.0005;
  const fanLatFinal = fanLat || 12.9784;
  const fanLngFinal = fanLng || 77.5996;

  // Linear interpolation of responder position
  const responderLat = securityStartLat + (fanLatFinal - securityStartLat) * responderProgress;
  const responderLng = securityStartLng + (fanLngFinal - securityStartLng) * responderProgress;

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        const progress = Math.min(next / RESPONSE_DURATION, 1);
        setResponderProgress(progress);
        if (progress >= 1) clearInterval(intervalRef.current);
        return next;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, []);

  // Pulse toggle for status indicator
  useEffect(() => {
    const pulseTimer = setInterval(() => {
      setPulseActive((p) => !p);
    }, 800);
    return () => clearInterval(pulseTimer);
  }, []);

  const estimatedArrival = Math.max(0, Math.round((RESPONSE_DURATION - elapsed) / 60));
  const arrivalSeconds = Math.max(0, RESPONSE_DURATION - elapsed);

  const mapsUrl = `https://www.google.com/maps/embed/v1/directions?key=${
    process.env.REACT_APP_MAPS_API_KEY || ''
  }&origin=${fanLatFinal},${fanLngFinal}&destination=${
    exitRoute?.exitLat || fanLatFinal + 0.001
  },${exitRoute?.exitLng || fanLngFinal + 0.001}&mode=walking`;

  const responderTimeLabel =
    arrivalSeconds <= 10
      ? t('sos_active_arriving', lang)
      : arrivalSeconds < 60
      ? `${arrivalSeconds}s`
      : `~${estimatedArrival + 1} min`;

  return (
    <div style={styles.screen}>
      {/* Status bar */}
      <div style={styles.statusBar}>
        <div style={styles.statusLeft}>
          <div
            style={{
              ...styles.pulseDot,
              background: pulseActive ? '#E74C3C' : '#c0392b',
              boxShadow: pulseActive ? '0 0 0 6px rgba(231,76,60,0.25)' : 'none',
            }}
          />
          <div>
            <p style={styles.statusTitle}>{t('sos_active_title', lang)}</p>
            <p style={styles.statusSub}>
              {t('sos_active_id', lang)}: {sosId?.slice(-6) || '------'}
            </p>
          </div>
        </div>
        <div style={styles.etaBox}>
          <p style={styles.etaLabel}>{t('sos_active_eta', lang)}</p>
          <p style={styles.etaValue}>{responderTimeLabel}</p>
        </div>
      </div>

      {/* Security on the way banner */}
      <div style={styles.banner}>
        <span style={styles.bannerIcon}>🚨</span>
        <div>
          <p style={styles.bannerTitle}>{t('sos_active_help_title', lang)}</p>
          <p style={styles.bannerBody}>{t('sos_active_help_body', lang)}</p>
        </div>
      </div>

      {/* Responder progress bar */}
      <div style={styles.progressSection}>
        <div style={styles.progressRow}>
          <span style={styles.progressLabel}>{t('sos_active_responder', lang)}</span>
          <span style={styles.progressPct}>{Math.round(responderProgress * 100)}%</span>
        </div>
        <div style={styles.progressTrack}>
          <div
            style={{
              ...styles.progressFill,
              width: `${responderProgress * 100}%`,
            }}
          />
        </div>
        <div style={styles.progressSteps}>
          <span>{t('sos_active_dispatched', lang)}</span>
          <span>{t('sos_active_enroute', lang)}</span>
          <span>{t('sos_active_arriving', lang)}</span>
        </div>
      </div>

      {/* Map embed */}
      <div style={styles.mapSection}>
        <p style={styles.mapLabel}>{t('sos_active_your_exit', lang)}</p>
        <div style={styles.mapFrame}>
          {process.env.REACT_APP_MAPS_API_KEY ? (
            <iframe
              title="Exit route map"
              width="100%"
              height="240"
              style={{ border: 0, borderRadius: '12px' }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              src={mapsUrl}
            />
          ) : (
            <div style={styles.mapFallback}>
              <span style={styles.mapFallbackIcon}>🗺️</span>
              <p style={styles.mapFallbackText}>{t('sos_active_exit_gate', lang)}: {exitRoute?.exitGate || 'Gate A'}</p>
              <p style={styles.mapFallbackSub}>{exitRoute?.distance || '~150m away'}</p>
            </div>
          )}
        </div>
      </div>

      {/* Exit route steps */}
      {exitRoute?.steps && exitRoute.steps.length > 0 && (
        <div style={styles.stepsSection}>
          <p style={styles.stepsTitle}>{t('sos_active_directions', lang)}</p>
          {exitRoute.steps.map((step, i) => (
            <div key={i} style={styles.stepRow}>
              <div style={styles.stepNum}>{i + 1}</div>
              <p style={styles.stepText}>{step}</p>
            </div>
          ))}
        </div>
      )}

      {/* Fallback exit info if no steps */}
      {(!exitRoute?.steps || exitRoute.steps.length === 0) && (
        <div style={styles.stepsSection}>
          <p style={styles.stepsTitle}>{t('sos_active_directions', lang)}</p>
          <div style={styles.stepRow}>
            <div style={styles.stepNum}>1</div>
            <p style={styles.stepText}>{t('sos_active_step1', lang)}</p>
          </div>
          <div style={styles.stepRow}>
            <div style={styles.stepNum}>2</div>
            <p style={styles.stepText}>{t('sos_active_step2', lang)}</p>
          </div>
          <div style={styles.stepRow}>
            <div style={styles.stepNum}>3</div>
            <p style={styles.stepText}>{t('sos_active_step3', lang)}</p>
          </div>
        </div>
      )}

      {/* Stay calm footer */}
      <div style={styles.calmCard}>
        <p style={styles.calmTitle}>{t('sos_active_calm_title', lang)}</p>
        <p style={styles.calmBody}>{t('sos_active_calm_body', lang)}</p>
        <p style={styles.emergencyNum}>📞 +91-80-2228-5700</p>
      </div>
    </div>
  );
}

const styles = {
  screen: {
    minHeight: '100vh',
    background: '#fff',
    display: 'flex',
    flexDirection: 'column',
    paddingBottom: '100px',
  },
  statusBar: {
    background: '#C0392B',
    color: '#fff',
    padding: '16px 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  pulseDot: {
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    flexShrink: 0,
    transition: 'box-shadow 0.4s ease, background 0.4s ease',
  },
  statusTitle: {
    margin: 0,
    fontSize: '14px',
    fontWeight: '700',
    color: '#fff',
  },
  statusSub: {
    margin: 0,
    fontSize: '11px',
    color: 'rgba(255,255,255,0.75)',
  },
  etaBox: {
    textAlign: 'right',
  },
  etaLabel: {
    margin: 0,
    fontSize: '10px',
    color: 'rgba(255,255,255,0.75)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  etaValue: {
    margin: 0,
    fontSize: '20px',
    fontWeight: '800',
    color: '#fff',
  },
  banner: {
    margin: '16px',
    background: '#FEF2F2',
    border: '1px solid #FECACA',
    borderRadius: '12px',
    padding: '14px 16px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
  },
  bannerIcon: {
    fontSize: '28px',
    flexShrink: 0,
  },
  bannerTitle: {
    margin: '0 0 4px',
    fontSize: '15px',
    fontWeight: '700',
    color: '#991B1B',
  },
  bannerBody: {
    margin: 0,
    fontSize: '13px',
    color: '#B91C1C',
    lineHeight: 1.5,
  },
  progressSection: {
    padding: '0 16px 16px',
  },
  progressRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },
  progressLabel: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#374151',
  },
  progressPct: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#E74C3C',
  },
  progressTrack: {
    height: '8px',
    background: '#F3F4F6',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: '#E74C3C',
    borderRadius: '4px',
    transition: 'width 1s linear',
  },
  progressSteps: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: '6px',
    fontSize: '10px',
    color: '#9CA3AF',
  },
  mapSection: {
    padding: '0 16px 16px',
  },
  mapLabel: {
    margin: '0 0 8px',
    fontSize: '14px',
    fontWeight: '600',
    color: '#111',
  },
  mapFrame: {
    borderRadius: '12px',
    overflow: 'hidden',
    border: '1px solid #e5e7eb',
  },
  mapFallback: {
    height: '160px',
    background: '#F9FAFB',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '12px',
  },
  mapFallbackIcon: {
    fontSize: '36px',
    marginBottom: '8px',
  },
  mapFallbackText: {
    margin: '0 0 4px',
    fontSize: '15px',
    fontWeight: '700',
    color: '#111',
  },
  mapFallbackSub: {
    margin: 0,
    fontSize: '13px',
    color: '#6B7280',
  },
  stepsSection: {
    padding: '0 16px 16px',
  },
  stepsTitle: {
    margin: '0 0 12px',
    fontSize: '14px',
    fontWeight: '600',
    color: '#111',
  },
  stepRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    marginBottom: '10px',
  },
  stepNum: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    background: '#E74C3C',
    color: '#fff',
    fontSize: '12px',
    fontWeight: '700',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: '1px',
  },
  stepText: {
    margin: 0,
    fontSize: '13px',
    color: '#374151',
    lineHeight: 1.5,
  },
  calmCard: {
    margin: '0 16px',
    background: '#F0FDF4',
    border: '1px solid #BBF7D0',
    borderRadius: '12px',
    padding: '14px 16px',
    textAlign: 'center',
  },
  calmTitle: {
    margin: '0 0 6px',
    fontSize: '14px',
    fontWeight: '700',
    color: '#166534',
  },
  calmBody: {
    margin: '0 0 8px',
    fontSize: '13px',
    color: '#15803D',
    lineHeight: 1.5,
  },
  emergencyNum: {
    margin: 0,
    fontSize: '13px',
    fontWeight: '600',
    color: '#166534',
  },
};