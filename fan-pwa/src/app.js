import React, { useState, useEffect } from 'react';
import HomeScreen from './components/HomeScreen';
import MyGate from './components/MyGate';
import ExitGuide from './components/ExitGuide';
import SOSButton from './components/SOSButton';
import SOSActive from './components/SOSActive';
import LanguageToggle from './components/LanguageToggle';
import { t } from './i18n';

/**
 * Tab identifiers for the bottom navigation bar.
 * @type {string[]}
 */
const TABS = ['home', 'gate', 'exit', 'sos', 'language'];

/**
 * App — root component for the CrowdCommand Fan PWA.
 *
 * Reads fanId, gateId, and tab from URL query parameters so judges can open
 * a pre-configured personalised experience via:
 *   crowdcommand-fan.web.app?fanId=demo&gateId=3
 *
 * Language preference is persisted in localStorage and applied globally.
 * When an SOS is active, the SOSActive screen replaces the SOS tab content.
 *
 * @returns {JSX.Element}
 */
const App = () => {
  // ── Parse URL query params ────────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const urlFanId = params.get('fanId') || 'demo';
  const urlGateId = params.get('gateId') || '1';
  const urlTab = params.get('tab');

  // ── State ─────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState(
    TABS.includes(urlTab) ? urlTab : 'home'
  );
  const [lang, setLang] = useState(
    () => localStorage.getItem('cc_lang') || 'en'
  );
  const [activeSOS, setActiveSOS] = useState(null); // { sosId, exitRoute, lat, lng }

  // ── Persist language preference ───────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('cc_lang', lang);
  }, [lang]);

  /**
   * Called by SOSButton when an SOS is successfully submitted.
   * Stores the active SOS state and switches to the SOS tab to show SOSActive.
   * @param {{ sosId: string, exitRoute: object }} sosData
   */
  const handleSOSTriggered = (sosData) => {
    setActiveSOS(sosData);
    setActiveTab('sos');
  };

  /**
   * Called by SOSActive when the incident is resolved or dismissed.
   */
  const handleSOSResolved = () => {
    setActiveSOS(null);
  };

  // ── Tab config ────────────────────────────────────────────────────────────
  const TAB_CONFIG = [
    { id: 'home', icon: '🏟️', labelKey: 'nav.home' },
    { id: 'gate', icon: '🚪', labelKey: 'nav.myGate' },
    { id: 'exit', icon: '🚶', labelKey: 'nav.exitGuide' },
    { id: 'sos', icon: '🆘', labelKey: 'nav.sos', highlight: true },
    { id: 'language', icon: '🌐', labelKey: 'nav.language' },
  ];

  // ── Render active screen ──────────────────────────────────────────────────
  const renderScreen = () => {
    switch (activeTab) {
      case 'home':
        return <HomeScreen fanId={urlFanId} gateId={urlGateId} lang={lang} />;
      case 'gate':
        return <MyGate fanId={urlFanId} gateId={urlGateId} lang={lang} />;
      case 'exit':
        return <ExitGuide fanId={urlFanId} gateId={urlGateId} lang={lang} />;
      case 'sos':
        return activeSOS ? (
          <SOSActive
            sosData={activeSOS}
            fanId={urlFanId}
            lang={lang}
            onResolved={handleSOSResolved}
          />
        ) : (
          <SOSButton
            fanId={urlFanId}
            gateId={urlGateId}
            lang={lang}
            onSOSTriggered={handleSOSTriggered}
          />
        );
      case 'language':
        return <LanguageToggle lang={lang} onLangChange={setLang} />;
      default:
        return <HomeScreen fanId={urlFanId} gateId={urlGateId} lang={lang} />;
    }
  };

  return (
    <div
      className="flex flex-col bg-gray-900 text-white"
      style={{ height: '100dvh', maxWidth: '480px', margin: '0 auto' }}
    >
      {/* Top status bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-white">⚡ CrowdCommand</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Live indicator */}
          <span className="flex items-center gap-1 text-[10px] text-green-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            {t('generic.liveUpdates', lang)}
          </span>
        </div>
      </div>

      {/* Main screen content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {renderScreen()}
      </div>

      {/* Bottom navigation tab bar */}
      <nav
        className="flex items-stretch bg-gray-800 border-t border-gray-700 flex-shrink-0"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Main navigation"
      >
        {TAB_CONFIG.map((tab) => {
          const isActive = activeTab === tab.id;
          const isSOSTab = tab.id === 'sos';
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors ${
                isSOSTab
                  ? isActive
                    ? 'text-red-300 bg-red-900/30'
                    : 'text-red-400 hover:bg-red-900/20'
                  : isActive
                  ? 'text-white bg-gray-700'
                  : 'text-gray-400 hover:bg-gray-700/50'
              }`}
              aria-label={t(tab.labelKey, lang)}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className={`text-lg leading-none ${isSOSTab ? 'text-xl' : ''}`}>
                {tab.icon}
              </span>
              <span className={`text-[10px] leading-none font-medium ${isSOSTab ? 'font-bold' : ''}`}>
                {t(tab.labelKey, lang)}
              </span>
              {/* Active indicator dot */}
              {isActive && (
                <span
                  className={`w-1 h-1 rounded-full mt-0.5 ${isSOSTab ? 'bg-red-400' : 'bg-blue-400'}`}
                />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default App;