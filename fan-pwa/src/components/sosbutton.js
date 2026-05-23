import React, { useState, useCallback } from 'react';
import { t } from '../i18n';
import { triggerSOS } from '../services/api';

/**
 * SOSButton component — renders a large emergency SOS trigger button for fans.
 * On first press shows a confirmation modal to prevent accidental triggers.
 * On confirmation, captures GPS coordinates via the browser Geolocation API
 * and POSTs to the SOS Cloud Function. Transitions to SOSActive on success.
 *
 * @param {Object} props
 * @param {string} props.fanId — fan identifier from URL query params
 * @param {string} props.lang — active language key (en/hi/kn)
 * @param {Function} props.onSOSConfirmed — callback with sosId and exitRoute on success
 */
export default function SOSButton({ fanId, lang, onSOSConfirmed }) {
  const [phase, setPhase] = useState('idle'); // idle | confirming | locating | submitting | error
  const [errorMsg, setErrorMsg] = useState('');

  /**
   * Handles the initial SOS button press — transitions to confirmation modal.
   */
  const handleSOSPress = useCallback(() => {
    setPhase('confirming');
  }, []);

  /**
   * Handles confirmation modal cancel — returns to idle.
   */
  const handleCancel = useCallback(() => {
    setPhase('idle');
    setErrorMsg('');
  }, []);

  /**
   * Handles confirmation — requests GPS then submits SOS to backend.
   * Uses browser Geolocation API. Falls back to stadium centre coords if denied.
   */
  const handleConfirm = useCallback(async () => {
    setPhase('locating');

    let coords = { latitude: 12.9784, longitude: 77.5996 }; // Chinnaswamy Stadium fallback

    try {
      const position = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Geolocation not supported'));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 5000,
          maximumAge: 10000,
          enableHighAccuracy: true,
        });
      });
      coords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
    } catch (geoErr) {
      console.warn('[SOSButton] Geolocation failed, using stadium fallback:', geoErr.message);
    }

    setPhase('submitting');

    try {
      const result = await triggerSOS({
        fanId: fanId || 'anonymous',
        latitude: coords.latitude,
        longitude: coords.longitude,
        timestamp: new Date().toISOString(),
      });

      if (result && result.sosId) {
        onSOSConfirmed({ sosId: result.sosId, exitRoute: result.exitRoute });
      } else {
        throw new Error('Invalid SOS response from server');
      }
    } catch (err) {
      console.error('[SOSButton] SOS submission failed:', err);
      setErrorMsg(err.message || 'Failed to reach emergency services. Please call stadium security.');
      setPhase('error');
    }
  }, [fanId, onSOSConfirmed]);

  /**
   * Handles retry after error.
   */
  const handleRetry = useCallback(() => {
    setPhase('idle');
    setErrorMsg('');
  }, []);

  return (
    <div style={styles.screen}>
      <div style={styles.header}>
        <span style={styles.headerIcon}>🆘</span>
        <h1 style={styles.headerTitle}>{t('sos_screen_title', lang)}</h1>
        <p style={styles.headerSubtitle}>{t('sos_screen_subtitle', lang)}</p>
      </div>

      {/* Main SOS button — visible only when idle */}
      {phase === 'idle' && (
        <div style={styles.buttonArea}>
          <button
            style={styles.sosButton}
            onClick={handleSOSPress}
            aria-label={t('sos_button_label', lang)}
            type="button"
          >
            <span style={styles.sosButtonText}>{t('sos_button_label', lang)}</span>
            <span style={styles.sosButtonSub}>{t('sos_button_sub', lang)}</span>
          </button>
          <p style={styles.disclaimer}>{t('sos_disclaimer', lang)}</p>
        </div>
      )}

      {/* Confirmation modal */}
      {phase === 'confirming' && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <span style={styles.modalIcon}>⚠️</span>
            <h2 style={styles.modalTitle}>{t('sos_confirm_title', lang)}</h2>
            <p style={styles.modalBody}>{t('sos_confirm_body', lang)}</p>
            <div style={styles.modalActions}>
              <button style={styles.cancelBtn} onClick={handleCancel} type="button">
                {t('sos_cancel', lang)}
              </button>
              <button style={styles.confirmBtn} onClick={handleConfirm} type="button">
                {t('sos_confirm', lang)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Locating phase */}
      {phase === 'locating' && (
        <div style={styles.statusArea}>
          <div style={styles.spinnerRing} aria-hidden="true" />
          <p style={styles.statusText}>{t('sos_locating', lang)}</p>
          <p style={styles.statusSub}>{t('sos_locating_sub', lang)}</p>
        </div>
      )}

      {/* Submitting phase */}
      {phase === 'submitting' && (
        <div style={styles.statusArea}>
          <div style={styles.spinnerRing} aria-hidden="true" />
          <p style={styles.statusText}>{t('sos_submitting', lang)}</p>
          <p style={styles.statusSub}>{t('sos_submitting_sub', lang)}</p>
        </div>
      )}

      {/* Error state */}
      {phase === 'error' && (
        <div style={styles.errorArea}>
          <span style={styles.errorIcon}>❌</span>
          <h2 style={styles.errorTitle}>{t('sos_error_title', lang)}</h2>
          <p style={styles.errorMsg}>{errorMsg}</p>
          <p style={styles.emergencyNumber}>
            {t('sos_emergency_call', lang)}: <strong>+91-80-2228-5700</strong>
          </p>
          <button style={styles.retryBtn} onClick={handleRetry} type="button">
            {t('sos_retry', lang)}
          </button>
        </div>
      )}

      {/* Safety info footer */}
      {(phase === 'idle') && (
        <div style={styles.infoCards}>
          <div style={styles.infoCard}>
            <span style={styles.infoIcon}>🚨</span>
            <div>
              <p style={styles.infoTitle}>{t('sos_info_security_title', lang)}</p>
              <p style={styles.infoBody}>{t('sos_info_security_body', lang)}</p>
            </div>
          </div>
          <div style={styles.infoCard}>
            <span style={styles.infoIcon}>📍</span>
            <div>
              <p style={styles.infoTitle}>{t('sos_info_location_title', lang)}</p>
              <p style={styles.infoBody}>{t('sos_info_location_body', lang)}</p>
            </div>
          </div>
          <div style={styles.infoCard}>
            <span style={styles.infoIcon}>🚪</span>
            <div>
              <p style={styles.infoTitle}>{t('sos_info_exit_title', lang)}</p>
              <p style={styles.infoBody}>{t('sos_info_exit_body', lang)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Styles */
const styles = {
  screen: {
    minHeight: '100vh',
    background: '#fff',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    paddingBottom: '100px',
  },
  header: {
    width: '100%',
    background: '#C0392B',
    color: '#fff',
    textAlign: 'center',
    padding: '32px 24px 24px',
  },
  headerIcon: {
    fontSize: '40px',
    display: 'block',
    marginBottom: '8px',
  },
  headerTitle: {
    margin: '0 0 6px',
    fontSize: '22px',
    fontWeight: '700',
    color: '#fff',
  },
  headerSubtitle: {
    margin: 0,
    fontSize: '14px',
    color: 'rgba(255,255,255,0.85)',
  },
  buttonArea: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '40px 24px 24px',
    width: '100%',
    boxSizing: 'border-box',
  },
  sosButton: {
    width: '200px',
    height: '200px',
    borderRadius: '50%',
    background: '#E74C3C',
    border: '6px solid #C0392B',
    boxShadow: '0 0 0 8px rgba(231,76,60,0.15), 0 0 0 16px rgba(231,76,60,0.07)',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'transform 0.1s ease, box-shadow 0.1s ease',
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
  },
  sosButtonText: {
    fontSize: '32px',
    fontWeight: '800',
    color: '#fff',
    letterSpacing: '1px',
    lineHeight: 1,
  },
  sosButtonSub: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.85)',
    marginTop: '6px',
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
  disclaimer: {
    marginTop: '24px',
    fontSize: '12px',
    color: '#888',
    textAlign: 'center',
    maxWidth: '280px',
    lineHeight: 1.5,
  },
  // Modal
  modalOverlay: {
    width: '100%',
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    boxSizing: 'border-box',
    background: 'rgba(0,0,0,0.05)',
    minHeight: '60vh',
  },
  modal: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '16px',
    padding: '32px 24px',
    maxWidth: '340px',
    width: '100%',
    textAlign: 'center',
    boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
  },
  modalIcon: {
    fontSize: '48px',
    display: 'block',
    marginBottom: '16px',
  },
  modalTitle: {
    margin: '0 0 12px',
    fontSize: '20px',
    fontWeight: '700',
    color: '#111',
  },
  modalBody: {
    margin: '0 0 24px',
    fontSize: '14px',
    color: '#555',
    lineHeight: 1.6,
  },
  modalActions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
  },
  cancelBtn: {
    flex: 1,
    padding: '14px 0',
    borderRadius: '10px',
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#374151',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  confirmBtn: {
    flex: 1,
    padding: '14px 0',
    borderRadius: '10px',
    border: 'none',
    background: '#E74C3C',
    color: '#fff',
    fontSize: '15px',
    fontWeight: '700',
    cursor: 'pointer',
  },
  // Status / spinner
  statusArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px 24px',
    minHeight: '50vh',
  },
  spinnerRing: {
    width: '56px',
    height: '56px',
    border: '5px solid #f3f4f6',
    borderTop: '5px solid #E74C3C',
    borderRadius: '50%',
    animation: 'sos-spin 0.9s linear infinite',
    marginBottom: '20px',
  },
  statusText: {
    margin: '0 0 8px',
    fontSize: '18px',
    fontWeight: '600',
    color: '#111',
  },
  statusSub: {
    margin: 0,
    fontSize: '13px',
    color: '#888',
  },
  // Error
  errorArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px 24px',
    textAlign: 'center',
    minHeight: '50vh',
  },
  errorIcon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  errorTitle: {
    margin: '0 0 12px',
    fontSize: '20px',
    fontWeight: '700',
    color: '#111',
  },
  errorMsg: {
    margin: '0 0 16px',
    fontSize: '14px',
    color: '#555',
    lineHeight: 1.6,
    maxWidth: '300px',
  },
  emergencyNumber: {
    margin: '0 0 24px',
    fontSize: '15px',
    color: '#C0392B',
  },
  retryBtn: {
    padding: '14px 40px',
    borderRadius: '10px',
    border: '1px solid #E74C3C',
    background: '#fff',
    color: '#E74C3C',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  // Info cards
  infoCards: {
    width: '100%',
    padding: '0 16px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  infoCard: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '14px',
    background: '#fafafa',
    border: '1px solid #f0f0f0',
    borderRadius: '12px',
    padding: '14px 16px',
  },
  infoIcon: {
    fontSize: '24px',
    flexShrink: 0,
    marginTop: '2px',
  },
  infoTitle: {
    margin: '0 0 3px',
    fontSize: '13px',
    fontWeight: '600',
    color: '#111',
  },
  infoBody: {
    margin: 0,
    fontSize: '12px',
    color: '#777',
    lineHeight: 1.5,
  },
};

// Inject spinner keyframe once
if (typeof document !== 'undefined' && !document.getElementById('sos-spin-style')) {
  const style = document.createElement('style');
  style.id = 'sos-spin-style';
  style.textContent = `@keyframes sos-spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(style);
}