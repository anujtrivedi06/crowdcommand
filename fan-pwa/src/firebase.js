import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getMessaging, isSupported } from 'firebase/messaging';

/**
 * Firebase configuration for the CrowdCommand Fan PWA.
 * Values are injected at build time via Create React App environment variables.
 * All REACT_APP_ prefixed vars are safe to expose in the client bundle —
 * they are public Firebase project identifiers, not secrets.
 */
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

// Initialise Firebase only once (guard for React hot-reload in dev)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

/**
 * Firestore database instance shared across all fan PWA components.
 * @type {import('firebase/firestore').Firestore}
 */
export const db = getFirestore(app);

/**
 * Firebase Cloud Messaging instance for push notifications.
 * Returns null in environments where FCM is not supported (e.g. iOS Safari < 16.4,
 * non-HTTPS, or service workers blocked). All callers must null-check before use.
 *
 * @returns {Promise<import('firebase/messaging').Messaging|null>}
 */
export const getMessagingInstance = async () => {
  try {
    const supported = await isSupported();
    if (!supported) return null;
    return getMessaging(app);
  } catch (err) {
    console.warn('[firebase.js] FCM not available in this environment:', err.message);
    return null;
  }
};

export default app;