import { getMessagingInstance } from '../firebase';
import { getToken, onMessage } from 'firebase/messaging';

/**
 * VAPID key for Firebase Cloud Messaging web push.
 * This is a public key — safe to include in client bundle.
 */
const VAPID_KEY = process.env.REACT_APP_FCM_VAPID_KEY;

/**
 * Requests notification permission and retrieves the FCM registration token
 * for this device. The token is used by the backend to send targeted push
 * notifications (gate changes, SOS updates, wave exit instructions).
 *
 * Returns null if:
 * - The browser does not support FCM (e.g. iOS Safari < 16.4)
 * - The user denies notification permission
 * - The service worker is not registered
 *
 * @returns {Promise<string|null>} FCM registration token or null
 */
export const requestNotificationPermission = async () => {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.info('[fcm] Notification permission denied by user.');
      return null;
    }

    const messaging = await getMessagingInstance();
    if (!messaging) {
      console.info('[fcm] Messaging not supported in this environment.');
      return null;
    }

    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (token) {
      console.info('[fcm] Registration token obtained.');
      return token;
    }

    console.warn('[fcm] No registration token available.');
    return null;
  } catch (err) {
    console.error('[fcm] requestNotificationPermission error:', err.message);
    return null;
  }
};

/**
 * Registers a foreground message handler for FCM push notifications.
 * When the PWA is open in the foreground, push notifications do not
 * show a system banner — this handler receives them and passes to the callback.
 *
 * @param {Function} onMessageCallback - called with the FCM message payload
 * @returns {Promise<Function|null>} unsubscribe function or null if FCM unavailable
 */
export const onForegroundMessage = async (onMessageCallback) => {
  try {
    const messaging = await getMessagingInstance();
    if (!messaging) return null;

    const unsubscribe = onMessage(messaging, (payload) => {
      console.info('[fcm] Foreground message received:', payload?.notification?.title);
      onMessageCallback(payload);
    });

    return unsubscribe;
  } catch (err) {
    console.error('[fcm] onForegroundMessage error:', err.message);
    return null;
  }
};