/**
 * Firestore Real-time Signal Listener
 *
 * Provides a real-time subscription to the 'signals' collection.
 * Falls back to REST API polling when Firebase is not configured (demo mode).
 */

import { getFirestore, collection, onSnapshot, query, orderBy, limit, type Unsubscribe } from 'firebase/firestore';
import { getFirebaseApp, FIREBASE_ENABLED } from './config';
import type { FirestoreSignal, SignalFeedState } from './types';

export type SignalCallback = (state: SignalFeedState) => void;
export type ErrorCallback = (error: string) => void;

const API_BASE = 'http://localhost:3000';

/**
 * Subscribe to real-time signal updates.
 *
 * When Firebase is configured, uses Firestore onSnapshot.
 * Otherwise, polls the REST API every 10 seconds.
 *
 * Returns an unsubscribe function.
 */
export function subscribeSignals(
  params: {
    region?: string;
    commodity?: string;
    personalized?: boolean;
  },
  onData: SignalCallback,
  onError: ErrorCallback
): () => void {
  if (FIREBASE_ENABLED()) {
    return subscribeFirestoreSignals(onData, onError);
  }
  return subscribeRestSignals(params, onData, onError);
}

// ─── Firestore Real-time (Production) ───────────────────────────────

function subscribeFirestoreSignals(
  onData: SignalCallback,
  onError: ErrorCallback
): Unsubscribe {
  const app = getFirebaseApp();
  if (!app) {
    onError('Firebase not initialized');
    return () => {};
  }

  const db = getFirestore(app);
  const signalsQuery = query(
    collection(db, 'signals'),
    orderBy('created_at', 'desc'),
    limit(50)
  );

  const unsubscribe = onSnapshot(
    signalsQuery,
    (snapshot) => {
      const signals: FirestoreSignal[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data() as FirestoreSignal;
        signals.push({ ...data, id: doc.id });
      });

      onData({
        archetype: 'The Generalist', // Computed server-side in production
        summarization: 'Detailed',
        signals,
      });
    },
    (err) => {
      onError(`Firestore sync error: ${err.message}`);
    }
  );

  return unsubscribe;
}

// ─── REST API Polling (Demo / Fallback) ─────────────────────────────

function subscribeRestSignals(
  params: {
    region?: string;
    commodity?: string;
    personalized?: boolean;
  },
  onData: SignalCallback,
  onError: ErrorCallback
): () => void {
  let active = true;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const fetchSignals = async () => {
    if (!active) return;

    try {
      const searchParams = new URLSearchParams();
      if (params.region) searchParams.append('region', params.region);
      if (params.commodity) searchParams.append('commodity', params.commodity);
      if (params.personalized) searchParams.append('personalized', 'true');

      searchParams.append('deviceType', window.innerWidth < 768 ? 'Mobile' : 'Desktop');
      const hour = new Date().getHours();
      let timeState = 'Trading';
      if (hour < 9) timeState = 'Pre-Market';
      if (hour > 17) timeState = 'Post-Market';
      searchParams.append('timeState', timeState);

      const response = await fetch(`${API_BASE}/api/signals?${searchParams.toString()}`, {
        headers: { Authorization: 'Bearer local-dev-token' },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      if (active) {
        onData({
          archetype: data.archetype || 'The Generalist',
          summarization: data.summarization || 'Detailed',
          signals: (data.signals || []).map((s: any) => ({
            ...s,
            confidence_score: parseFloat(s.confidence_score),
          })),
        });
      }
    } catch (err: any) {
      if (active) {
        onError(err.message);
      }
    }

    if (active) {
      timeoutId = setTimeout(fetchSignals, 10000);
    }
  };

  fetchSignals();

  return () => {
    active = false;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  };
}