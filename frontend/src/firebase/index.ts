/**
 * VIGIL Firebase Integration — Barrel Export
 *
 * Replaces agent-driven polling with Firestore real-time sync
 * and Firebase Auth, reducing compute costs while enabling
 * instant UI updates.
 */

// Configuration
export {
  getFirebaseApp,
  FIREBASE_ENABLED,
} from './config';

// Types
export type {
  FirestoreSignal,
  FirestoreUserProfile,
  FirestoreUserInterest,
  FirestoreArchetypeState,
  SignalFeedState,
} from './types';

// Real-time Signal Feed
export {
  subscribeSignals,
} from './signals';

export type {
  SignalCallback,
  ErrorCallback,
} from './signals';

// Authentication
export {
  subscribeAuth,
  loginWithEmail,
  registerWithEmail,
  logout,
  getAuthHeader,
} from './auth';

export type {
  AuthUser,
  AuthCallback,
} from './auth';

// User Interests / Personality Ledger
export {
  logInteraction,
  fetchArchetypeState,
  computePersonalRank,
} from './interests';