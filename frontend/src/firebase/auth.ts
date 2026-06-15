/**
 * Firebase Authentication Service
 *
 * Provides Firebase Auth integration with fallback to mock auth
 * for local development without a configured Firebase project.
 *
 * In production (Firebase configured):
 *   - Uses onAuthStateChanged for real-time auth state
 *   - getIdToken for REST API authorization headers
 *
 * In demo mode (no Firebase):
 *   - Uses a local mock user with hardcoded ID
 */

import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { getFirebaseApp, FIREBASE_ENABLED } from './config';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  /** JWT for REST API (only in Firebase mode) */
  token: string | null;
}

export type AuthCallback = (user: AuthUser | null) => void;

// ─── Mock user for demo mode ────────────────────────────────────────

const MOCK_USER: AuthUser = {
  uid: '00000000-0000-0000-0000-000000000001',
  email: 'demo@vigil.local',
  displayName: 'Demo Analyst',
  token: 'local-dev-token',
};

// ─── Auth State Listener ────────────────────────────────────────────

export function subscribeAuth(callback: AuthCallback): () => void {
  if (!FIREBASE_ENABLED()) {
    // Demo mode: immediately return mock user
    callback(MOCK_USER);
    return () => {};
  }

  const app = getFirebaseApp();
  if (!app) {
    callback(MOCK_USER);
    return () => {};
  }

  const auth = getAuth(app);

  const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: User | null) => {
    if (!firebaseUser) {
      callback(null);
      return;
    }

    const token = await firebaseUser.getIdToken();
    callback({
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: firebaseUser.displayName,
      token,
    });
  });

  return unsubscribe;
}

// ─── Auth Actions ───────────────────────────────────────────────────

export async function loginWithEmail(email: string, password: string): Promise<AuthUser> {
  if (!FIREBASE_ENABLED()) {
    // Demo: accept any credentials
    return MOCK_USER;
  }

  const app = getFirebaseApp();
  if (!app) throw new Error('Firebase not initialized');

  const auth = getAuth(app);
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const token = await credential.user.getIdToken();

  return {
    uid: credential.user.uid,
    email: credential.user.email,
    displayName: credential.user.displayName,
    token,
  };
}

export async function registerWithEmail(email: string, password: string): Promise<AuthUser> {
  if (!FIREBASE_ENABLED()) {
    return MOCK_USER;
  }

  const app = getFirebaseApp();
  if (!app) throw new Error('Firebase not initialized');

  const auth = getAuth(app);
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const token = await credential.user.getIdToken();

  return {
    uid: credential.user.uid,
    email: credential.user.email,
    displayName: credential.user.displayName,
    token,
  };
}

export async function logout(): Promise<void> {
  if (!FIREBASE_ENABLED()) return;

  const app = getFirebaseApp();
  if (!app) return;

  await signOut(getAuth(app));
}

/**
 * Get the current authorization header value for REST API calls.
 * In Firebase mode, uses the JWT. In demo mode, uses the mock token.
 */
export function getAuthHeader(user: AuthUser | null): string {
  if (!user) return 'Bearer local-dev-token';
  return `Bearer ${user.token || 'local-dev-token'}`;
}