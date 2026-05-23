import React, { useCallback } from 'react';
import { t, LANGUAGES } from '../i18n';

/**
 * LanguageToggle component — full-screen language selection tab.
 * Displays all supported languages as selectable cards. Persists
 * the selected language to localStorage. All sibling components
 * read the selected language via the lang prop passed from App.js.
 *
 * @param {Object} props
 * @param {string} props.lang — currently active language key (en/hi/kn)
 * @param {Function} props.onLanguageChange — callback invoked with new language key
 */
export default function LanguageToggle({ lang, onLanguageChange }) {
  /**
   * Handles language card selection. Persists to localStorage and
   * notifies parent via callback.
   * @param {string} key — language key to activate
   */
  const handleSelect = useCallback(
    (key) => {
      try {
        localStorage.setItem('crowdcommand_lang', key);
      } catch (e) {
        console.warn('[LanguageToggle] localStorage unavailable:', e);
      }
      onLanguageChange(key);
    },
    [onLanguageChange]
  );

  return (
    <div style={styles.screen}>
      <div style={styles.header}>
        <span style={styles.headerIcon}>🌐</span>
        <h1 style={styles.headerTitle}>{t('lang_screen_title', lang)}</h1>
        <p style={styles.headerSub}>{t('lang_screen_subtitle', lang)}</p>
      </div>

      <div style={styles.cards}>
        {LANGUAGES.map((language) => {
          const isActive = lang === language.key;
          return (
            <button
              key={language.key}
              style={{
                ...styles.card,
                ...(isActive ? styles.cardActive : {}),
              }}
              onClick={() => handleSelect(language.key)}
              type="button"
              aria-pressed={isActive}
              aria-label={`Select ${language.nativeName}`}
            >
              <span style={styles.flag}>{language.flag}</span>
              <div style={styles.cardText}>
                <p style={{ ...styles.nativeName, ...(isActive ? styles.nativeNameActive : {}) }}>
                  {language.nativeName}
                </p>
                <p style={{ ...styles.englishName, ...(isActive ? styles.englishNameActive : {}) }}>
                  {language.englishName}
                </p>
              </div>
              {isActive && (
                <div style={styles.checkBadge} aria-hidden="true">
                  ✓
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div style={styles.infoSection}>
        <p style={styles.infoText}>{t('lang_info', lang)}</p>
      </div>

      <div style={styles.appInfo}>
        <p style={styles.appName}>CrowdCommand Fan</p>
        <p style={styles.appVer}>M. Chinnaswamy Stadium · Bengaluru</p>
        <p style={styles.appVer}>v1.0.0</p>
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
  header: {
    background: '#1a1a2e',
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
  headerSub: {
    margin: 0,
    fontSize: '13px',
    color: 'rgba(255,255,255,0.7)',
  },
  cards: {
    padding: '24px 16px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '18px 16px',
    borderRadius: '14px',
    border: '1.5px solid #e5e7eb',
    background: '#fff',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    transition: 'border-color 0.15s ease, background 0.15s ease',
    WebkitTapHighlightColor: 'transparent',
  },
  cardActive: {
    border: '2px solid #1a1a2e',
    background: '#f8f8ff',
  },
  flag: {
    fontSize: '36px',
    flexShrink: 0,
    lineHeight: 1,
  },
  cardText: {
    flex: 1,
  },
  nativeName: {
    margin: '0 0 3px',
    fontSize: '18px',
    fontWeight: '700',
    color: '#374151',
  },
  nativeNameActive: {
    color: '#1a1a2e',
  },
  englishName: {
    margin: 0,
    fontSize: '13px',
    color: '#9CA3AF',
  },
  englishNameActive: {
    color: '#6366f1',
  },
  checkBadge: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    background: '#1a1a2e',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '700',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  infoSection: {
    padding: '8px 24px 24px',
  },
  infoText: {
    margin: 0,
    fontSize: '12px',
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 1.6,
  },
  appInfo: {
    marginTop: 'auto',
    padding: '24px',
    textAlign: 'center',
    borderTop: '1px solid #f3f4f6',
  },
  appName: {
    margin: '0 0 4px',
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
  },
  appVer: {
    margin: '0 0 2px',
    fontSize: '12px',
    color: '#9CA3AF',
  },
};