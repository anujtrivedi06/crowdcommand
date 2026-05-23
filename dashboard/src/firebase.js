/**
 * @fileoverview Firebase initialisation for the CrowdCommand command dashboard.
 * Exports initialised Firebase app, Firestore, and Messaging instances.
 * All dashboard components import from this file — never initialise Firebase directly.
 */

import { initializeApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getMessaging, isSupported } from "firebase/messaging";

/**
 * Firebase project configuration.
 * Values are injected at build time via Create React App environment variables.
 * Set these in a .env.local file for local development.
 * On Firebase Hosting, these are set via the Firebase console environment config.
 */
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

/**
 * Initialised Firebase app instance.
 * @type {import("firebase/app").FirebaseApp}
 */
const app = initializeApp(firebaseConfig);

/**
 * Firestore database instance.
 * Used by all useFirestore hooks and direct collection listeners.
 * @type {import("firebase/firestore").Firestore}
 */
const db = getFirestore(app);

// Connect to Firestore emulator in local development
if (
  process.env.NODE_ENV === "development" &&
  process.env.REACT_APP_USE_EMULATOR === "true"
) {
  try {
    connectFirestoreEmulator(db, "localhost", 8080);
    console.log("[firebase] Connected to Firestore emulator at localhost:8080");
  } catch (err) {
    // Emulator already connected — safe to ignore
  }
}

/**
 * Firebase Cloud Messaging instance.
 * Initialised lazily — FCM is not supported in all browsers (e.g. Safari < 16).
 * Components should check for null before using.
 * @type {import("firebase/messaging").Messaging | null}
 */
let messaging = null;

/**
 * Initialises FCM if supported by the current browser.
 * Called once on app mount by App.js.
 *
 * @returns {Promise<import("firebase/messaging").Messaging | null>}
 */
async function initMessaging() {
  try {
    const supported = await isSupported();
    if (supported) {
      messaging = getMessaging(app);
      return messaging;
    }
    console.warn("[firebase] FCM not supported in this browser — push notifications disabled");
    return null;
  } catch (err) {
    console.error(`[firebase] Failed to initialise FCM: ${err.message}`);
    return null;
  }
}

/**
 * Returns the Google Maps API key for use in map components.
 * Read from environment variable — never hardcoded.
 *
 * @returns {string} Google Maps API key or empty string
 */
function getMapsApiKey() {
  return process.env.REACT_APP_MAPS_API_KEY || "";
}

/**
 * Returns the base URL for all Firebase Cloud Functions HTTP calls.
 * Switches between local emulator and production automatically.
 *
 * @returns {string} Functions base URL
 */
function getFunctionsBaseUrl() {
  if (
    process.env.NODE_ENV === "development" &&
    process.env.REACT_APP_USE_EMULATOR === "true"
  ) {
    const projectId = process.env.REACT_APP_FIREBASE_PROJECT_ID || "crowdcommand";
    return `http://localhost:5001/${projectId}/us-central1`;
  }
  const projectId = process.env.REACT_APP_FIREBASE_PROJECT_ID || "crowdcommand";
  return `https://us-central1-${projectId}.cloudfunctions.net`;
}

export { app, db, messaging, initMessaging, getMapsApiKey, getFunctionsBaseUrl };