/**
 * i18n.js — Internationalisation strings for the CrowdCommand Fan PWA.
 *
 * Supports three languages:
 *  - en: English (default)
 *  - hi: Hindi
 *  - kn: Kannada
 *
 * Usage:
 *   import { t, LANGUAGES } from '../i18n';
 *   const label = t('home.title', lang);
 *
 * All JSX in the fan PWA must use these keys — no raw string literals in components.
 */

/** @type {{ code: string, label: string, nativeLabel: string }[]} */
export const LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
  { code: 'kn', label: 'Kannada', nativeLabel: 'ಕನ್ನಡ' },
];

/**
 * Master translations object.
 * Keys are dot-notation strings; values are per-language strings.
 * @type {Record<string, Record<string, string>>}
 */
const translations = {
  // ── App shell ──────────────────────────────────────────────────────────────
  'app.name': {
    en: 'CrowdCommand',
    hi: 'क्राउडकमांड',
    kn: 'ಕ್ರೌಡ್‌ಕಮಾಂಡ್',
  },
  'app.tagline': {
    en: 'Your stadium companion',
    hi: 'आपका स्टेडियम साथी',
    kn: 'ನಿಮ್ಮ ಕ್ರೀಡಾಂಗಣ ಸಂಗಾತಿ',
  },
  'app.loading': {
    en: 'Loading…',
    hi: 'लोड हो रहा है…',
    kn: 'ಲೋಡ್ ಆಗುತ್ತಿದೆ…',
  },

  // ── Bottom nav tabs ────────────────────────────────────────────────────────
  'nav.home': {
    en: 'Home',
    hi: 'होम',
    kn: 'ಮನೆ',
  },
  'nav.myGate': {
    en: 'My Gate',
    hi: 'मेरा गेट',
    kn: 'ನನ್ನ ಗೇಟ್',
  },
  'nav.exitGuide': {
    en: 'Exit',
    hi: 'निकास',
    kn: 'ನಿರ್ಗಮನ',
  },
  'nav.sos': {
    en: 'SOS',
    hi: 'एसओएस',
    kn: 'ಎಸ್‌ಒಎಸ್',
  },
  'nav.language': {
    en: 'Language',
    hi: 'भाषा',
    kn: 'ಭಾಷೆ',
  },

  // ── HomeScreen ─────────────────────────────────────────────────────────────
  'home.title': {
    en: 'Match Day',
    hi: 'मैच का दिन',
    kn: 'ಪಂದ್ಯದ ದಿನ',
  },
  'home.stadium': {
    en: 'M. Chinnaswamy Stadium',
    hi: 'एम. चिन्नास्वामी स्टेडियम',
    kn: 'ಎಂ. ಚಿನ್ನಸ್ವಾಮಿ ಕ್ರೀಡಾಂಗಣ',
  },
  'home.matchStatus': {
    en: 'Match Status',
    hi: 'मैच स्थिति',
    kn: 'ಪಂದ್ಯ ಸ್ಥಿತಿ',
  },
  'home.phase.prematch': {
    en: 'Pre-match',
    hi: 'मैच से पहले',
    kn: 'ಪಂದ್ಯ ಮೊದಲು',
  },
  'home.phase.inmatch': {
    en: 'Match in progress',
    hi: 'मैच जारी है',
    kn: 'ಪಂದ್ಯ ನಡೆಯುತ್ತಿದೆ',
  },
  'home.phase.postmatch': {
    en: 'Match ended — exit in progress',
    hi: 'मैच समाप्त — निकासी जारी है',
    kn: 'ಪಂದ್ಯ ಮುಗಿದಿದೆ — ನಿರ್ಗಮನ ನಡೆಯುತ್ತಿದೆ',
  },
  'home.gateInfo': {
    en: 'Your Gate',
    hi: 'आपका गेट',
    kn: 'ನಿಮ್ಮ ಗೇಟ್',
  },
  'home.capacity': {
    en: 'Stadium capacity',
    hi: 'स्टेडियम क्षमता',
    kn: 'ಕ್ರೀಡಾಂಗಣ ಸಾಮರ್ಥ್ಯ',
  },
  'home.alerts': {
    en: 'Active alerts',
    hi: 'सक्रिय अलर्ट',
    kn: 'ಸಕ್ರಿಯ ಎಚ್ಚರಿಕೆಗಳು',
  },
  'home.noAlerts': {
    en: 'No active alerts',
    hi: 'कोई सक्रिय अलर्ट नहीं',
    kn: 'ಯಾವುದೇ ಸಕ್ರಿಯ ಎಚ್ಚರಿಕೆ ಇಲ್ಲ',
  },
  'home.fanId': {
    en: 'Fan ID',
    hi: 'फैन आईडी',
    kn: 'ಅಭಿಮಾನಿ ಐಡಿ',
  },

  // ── MyGate ─────────────────────────────────────────────────────────────────
  'gate.title': {
    en: 'My Gate',
    hi: 'मेरा गेट',
    kn: 'ನನ್ನ ಗೇಟ್',
  },
  'gate.assigned': {
    en: 'Your assigned gate',
    hi: 'आपका निर्धारित गेट',
    kn: 'ನಿಮ್ಮ ನಿಗದಿತ ಗೇಟ್',
  },
  'gate.status.open': {
    en: 'Open',
    hi: 'खुला',
    kn: 'ತೆರೆದಿದೆ',
  },
  'gate.status.closed': {
    en: 'Closed — use alternate',
    hi: 'बंद — वैकल्पिक उपयोग करें',
    kn: 'ಮುಚ್ಚಿದೆ — ಪರ್ಯಾಯ ಬಳಸಿ',
  },
  'gate.status.busy': {
    en: 'Busy — expect wait',
    hi: 'व्यस्त — प्रतीक्षा अपेक्षित',
    kn: 'ಜನದಟ್ಟಣೆ — ನಿರೀಕ್ಷಿತ ತಡ',
  },
  'gate.alternate': {
    en: 'Alternate gate',
    hi: 'वैकल्पिक गेट',
    kn: 'ಪರ್ಯಾಯ ಗೇಟ್',
  },
  'gate.density': {
    en: 'Current density',
    hi: 'वर्तमान घनत्व',
    kn: 'ಪ್ರಸ್ತುತ ಸಾಂದ್ರತೆ',
  },
  'gate.instructions': {
    en: 'Entry instructions',
    hi: 'प्रवेश निर्देश',
    kn: 'ಪ್ರವೇಶ ಸೂಚನೆಗಳು',
  },
  'gate.scanTicket': {
    en: 'Have your ticket QR code ready to scan',
    hi: 'अपना टिकट QR कोड स्कैन के लिए तैयार रखें',
    kn: 'ನಿಮ್ಮ ಟಿಕೆಟ್ QR ಕೋಡ್ ಸ್ಕ್ಯಾನ್‌ಗೆ ತಯಾರಾಗಿರಿ',
  },
  'gate.noMetalObjects': {
    en: 'Remove metal objects before security check',
    hi: 'सुरक्षा जांच से पहले धातु की वस्तुएं हटाएं',
    kn: 'ಭದ್ರತಾ ತಪಾಸಣೆಗಿಂತ ಮೊದಲು ಲೋಹದ ವಸ್ತುಗಳನ್ನು ತೆಗೆಯಿರಿ',
  },

  // ── ExitGuide ──────────────────────────────────────────────────────────────
  'exit.title': {
    en: 'Exit Guide',
    hi: 'निकास मार्गदर्शिका',
    kn: 'ನಿರ್ಗಮನ ಮಾರ್ಗದರ್ಶಿ',
  },
  'exit.yourRoute': {
    en: 'Your exit route',
    hi: 'आपका निकास मार्ग',
    kn: 'ನಿಮ್ಮ ನಿರ್ಗಮನ ಮಾರ್ಗ',
  },
  'exit.estimatedTime': {
    en: 'Estimated time',
    hi: 'अनुमानित समय',
    kn: 'ಅಂದಾಜು ಸಮಯ',
  },
  'exit.minutes': {
    en: 'min',
    hi: 'मिनट',
    kn: 'ನಿಮಿಷ',
  },
  'exit.distance': {
    en: 'Distance',
    hi: 'दूरी',
    kn: 'ದೂರ',
  },
  'exit.metres': {
    en: 'm',
    hi: 'मी',
    kn: 'ಮೀ',
  },
  'exit.followSigns': {
    en: 'Follow green exit signs',
    hi: 'हरे निकास संकेतों का पालन करें',
    kn: 'ಹಸಿರು ನಿರ್ಗಮನ ಚಿಹ್ನೆಗಳನ್ನು ಅನುಸರಿಸಿ',
  },
  'exit.avoidZone': {
    en: 'Avoid congested zone',
    hi: 'भीड़भाड़ वाले क्षेत्र से बचें',
    kn: 'ದಟ್ಟಣೆ ಪ್ರದೇಶ ತಪ್ಪಿಸಿ',
  },
  'exit.weatherReroute': {
    en: 'Route updated due to weather — using covered exits',
    hi: 'मौसम के कारण मार्ग अपडेट — ढके हुए निकास का उपयोग',
    kn: 'ಹವಾಮಾನದಿಂದ ಮಾರ್ಗ ನವೀಕರಿಸಲಾಗಿದೆ — ಮುಚ್ಚಿದ ನಿರ್ಗಮನ ಬಳಸಿ',
  },
  'exit.wave.waiting': {
    en: 'Please wait — your zone exits soon',
    hi: 'कृपया प्रतीक्षा करें — आपका क्षेत्र जल्द निकलेगा',
    kn: 'ದಯವಿಟ್ಟು ನಿರೀಕ್ಷಿಸಿ — ನಿಮ್ಮ ವಲಯ ಶೀಘ್ರದಲ್ಲೇ ನಿರ್ಗಮಿಸುತ್ತದೆ',
  },
  'exit.wave.go': {
    en: 'Your zone is clear — please exit now',
    hi: 'आपका क्षेत्र साफ है — अभी निकलें',
    kn: 'ನಿಮ್ಮ ವಲಯ ಮುಕ್ತವಾಗಿದೆ — ಈಗ ನಿರ್ಗಮಿಸಿ',
  },
  'exit.loadingMap': {
    en: 'Loading exit map…',
    hi: 'निकास नक्शा लोड हो रहा है…',
    kn: 'ನಿರ್ಗಮನ ನಕ್ಷೆ ಲೋಡ್ ಆಗುತ್ತಿದೆ…',
  },

  // ── SOSButton ──────────────────────────────────────────────────────────────
  'sos.title': {
    en: 'Emergency SOS',
    hi: 'आपातकालीन एसओएस',
    kn: 'ತುರ್ತು ಎಸ್‌ಒಎಸ್',
  },
  'sos.button': {
    en: 'SOS',
    hi: 'एसओएस',
    kn: 'ಎಸ್‌ಒಎಸ್',
  },
  'sos.instruction': {
    en: 'Press only in a genuine emergency',
    hi: 'केवल वास्तविक आपातकाल में दबाएं',
    kn: 'ನಿಜವಾದ ತುರ್ತು ಸ್ಥಿತಿಯಲ್ಲಿ ಮಾತ್ರ ಒತ್ತಿರಿ',
  },
  'sos.confirm.title': {
    en: 'Confirm Emergency',
    hi: 'आपातकाल की पुष्टि करें',
    kn: 'ತುರ್ತು ಸ್ಥಿತಿ ದೃಢಪಡಿಸಿ',
  },
  'sos.confirm.body': {
    en: 'Press confirm to alert security — only use in genuine emergencies.',
    hi: 'सुरक्षा को सतर्क करने के लिए पुष्टि करें — केवल वास्तविक आपातकाल में उपयोग करें।',
    kn: 'ಭದ್ರತೆಗೆ ಎಚ್ಚರಿಕೆ ನೀಡಲು ದೃಢಪಡಿಸಿ — ನಿಜವಾದ ತುರ್ತು ಸ್ಥಿತಿಯಲ್ಲಿ ಮಾತ್ರ ಬಳಸಿ.',
  },
  'sos.confirm.button': {
    en: 'Confirm — Alert Security',
    hi: 'पुष्टि करें — सुरक्षा को सतर्क करें',
    kn: 'ದೃಢಪಡಿಸಿ — ಭದ್ರತೆ ಎಚ್ಚರಿಸಿ',
  },
  'sos.cancel': {
    en: 'Cancel',
    hi: 'रद्द करें',
    kn: 'ರದ್ದು ಮಾಡಿ',
  },
  'sos.sending': {
    en: 'Sending alert…',
    hi: 'अलर्ट भेज रहे हैं…',
    kn: 'ಎಚ್ಚರಿಕೆ ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ…',
  },
  'sos.locating': {
    en: 'Getting your location…',
    hi: 'आपका स्थान प्राप्त कर रहे हैं…',
    kn: 'ನಿಮ್ಮ ಸ್ಥಳ ಪತ್ತೆಯಾಗುತ್ತಿದೆ…',
  },

  // ── SOSActive ──────────────────────────────────────────────────────────────
  'sosActive.title': {
    en: 'Help is on the way',
    hi: 'मदद आ रही है',
    kn: 'ಸಹಾಯ ಬರುತ್ತಿದೆ',
  },
  'sosActive.responderEnRoute': {
    en: 'Security is on the way',
    hi: 'सुरक्षा आ रही है',
    kn: 'ಭದ್ರತೆ ಬರುತ್ತಿದೆ',
  },
  'sosActive.exitRoute': {
    en: 'Nearest safe exit',
    hi: 'निकटतम सुरक्षित निकास',
    kn: 'ಸಮೀಪದ ಸುರക್ಷಿತ ನಿರ್ಗಮನ',
  },
  'sosActive.stayCalm': {
    en: 'Stay calm and stay where you are',
    hi: 'शांत रहें और जहां हैं वहीं रहें',
    kn: 'ಶಾಂತವಾಗಿರಿ ಮತ್ತು ಇರುವ ಸ್ಥಳದಲ್ಲಿ ಉಳಿಯಿರಿ',
  },
  'sosActive.responderEta': {
    en: 'Responder ETA',
    hi: 'प्रतिसादकर्ता ईटीए',
    kn: 'ಪ್ರತಿಕ್ರಿಯಾಕಾರ ETA',
  },
  'sosActive.sosId': {
    en: 'Incident ID',
    hi: 'घटना आईडी',
    kn: 'ಘಟನೆ ಐಡಿ',
  },
  'sosActive.resolved': {
    en: 'Incident resolved',
    hi: 'घटना सुलझा ली गई',
    kn: 'ಘಟನೆ ಪರಿಹರಿಸಲಾಗಿದೆ',
  },
  'sosActive.callEmergency': {
    en: 'If in immediate danger call 112',
    hi: 'यदि तत्काल खतरे में हैं तो 112 पर कॉल करें',
    kn: 'ತಕ್ಷಣದ ಅಪಾಯದಲ್ಲಿದ್ದರೆ 112 ಕರೆ ಮಾಡಿ',
  },

  // ── LanguageToggle ─────────────────────────────────────────────────────────
  'language.title': {
    en: 'Select Language',
    hi: 'भाषा चुनें',
    kn: 'ಭಾಷೆ ಆಯ್ಕೆ ಮಾಡಿ',
  },
  'language.current': {
    en: 'Current language',
    hi: 'वर्तमान भाषा',
    kn: 'ಪ್ರಸ್ತುತ ಭಾಷೆ',
  },
  'language.selected': {
    en: 'Selected',
    hi: 'चयनित',
    kn: 'ಆಯ್ಕೆ ಮಾಡಲಾಗಿದೆ',
  },

  // ── Generic / shared ───────────────────────────────────────────────────────
  'generic.gate': {
    en: 'Gate',
    hi: 'गेट',
    kn: 'ಗೇಟ್',
  },
  'generic.zone': {
    en: 'Zone',
    hi: 'क्षेत्र',
    kn: 'ವಲಯ',
  },
  'generic.error': {
    en: 'Something went wrong. Please try again.',
    hi: 'कुछ गलत हो गया। कृपया पुनः प्रयास करें।',
    kn: 'ಏನೋ ತಪ್ಪಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
  },
  'generic.retry': {
    en: 'Retry',
    hi: 'पुनः प्रयास',
    kn: 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ',
  },
  'generic.ok': {
    en: 'OK',
    hi: 'ठीक है',
    kn: 'ಸರಿ',
  },
  'generic.back': {
    en: 'Back',
    hi: 'वापस',
    kn: 'ಹಿಂದೆ',
  },
  'generic.liveUpdates': {
    en: 'Live updates',
    hi: 'लाइव अपडेट',
    kn: 'ನೇರ ನವೀಕರಣ',
  },
};

/**
 * Retrieves a translated string for the given key and language.
 * Falls back to English if the language or key is not found.
 * Falls back to the raw key if English is also missing (should never happen).
 *
 * @param {string} key - dot-notation translation key, e.g. 'home.title'
 * @param {string} [lang='en'] - language code: 'en' | 'hi' | 'kn'
 * @returns {string} Translated string
 */
export const t = (key, lang = 'en') => {
  const entry = translations[key];
  if (!entry) {
    console.warn(`[i18n] Missing translation key: "${key}"`);
    return key;
  }
  return entry[lang] || entry['en'] || key;
};

export default translations;