/**
 * Firebase Configuration & Initialization
 *
 * Uses environment variables for Firebase config:
 *   VITE_FIREBASE_API_KEY
 *   VITE_FIREBASE_AUTH_DOMAIN
 *   VITE_FIREBASE_PROJECT_ID
 *   VITE_FIREBASE_STORAGE_BUCKET
 *   VITE_FIREBASE_MESSAGING_SENDER_ID
 *   VITE_FIREBASE_APP_ID
 *   VITE_FIREBASE_DATABASE_URL
 *   VITE_FIREBASE_MEASUREMENT_ID
 *
 * When env vars are not set, the app runs in "demo mode" using
 * the REST API as a fallback. This allows local development without
 * a real Firebase project.
 */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';

export const FIREBASE_ENABLED = (): boolean => {
  return !!(
    import.meta.env.VITE_FIREBASE_API_KEY &&
    import.meta.env.VITE_FIREBASE_PROJECT_ID
  );
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

let app: FirebaseApp | null = null;

export function getFirebaseApp(): FirebaseApp | null {
  if (!FIREBASE_ENABLED()) {
    return null;
  }

  if (!app && !getApps().length) {
    app = initializeApp(firebaseConfig);
  } else if (getApps().length > 0) {
    app = getApps()[0];
  }

  return app;
}
