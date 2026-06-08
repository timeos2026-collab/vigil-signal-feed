/**
 * User Interests / Personality Ledger – Firestore Sync
 *
 * Manages user interest scoring and archetype state in Firestore.
 * This enables server-side ranking of signals by user interest
 * without requiring constant agent/worker intervention.
 *
 * In production (Firebase configured):
 *   - Reads/writes user_interests subcollection under users/{uid}
 *   - Archetype state is computed from Firestore aggregation
 *
 * In demo mode (no Firebase):
 *   - Falls back to REST API at /api/interactions and /api/signals
 */

import { getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { getFirebaseApp, FIREBASE_ENABLED } from './config';
import type { FirestoreUserInterest, FirestoreArchetypeState } from './types';

const API_BASE = 'http://localhost:3000';

// Weights matching the backend
const WEIGHTS: Record<string, number> = {
  view: 1,
  deep_read: 3,
  bookmark: 10,
  filter_apply: 15,
  alert_set: 20,
  dismiss: -10,
};

// ─── Log Interaction ────────────────────────────────────────────────

export async function logInteraction(
  userId: string,
  signalId: string,
  interactionType: string,
  isDiscovery?: boolean,
  signalRegion?: string,
  signalCommodityTags?: string[],
  signalPayload?: any
): Promise<void> {
  if (FIREBASE_ENABLED()) {
    return logInteractionFirestore(
      userId, signalId, interactionType, isDiscovery,
      signalRegion, signalCommodityTags, signalPayload
    );
  }
  return logInteractionRest(userId, signalId, interactionType, isDiscovery);
}

async function logInteractionRest(
  _userId: string,
  signalId: string,
  interactionType: string,
  isDiscovery?: boolean
): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer local-dev-token',
      },
      body: JSON.stringify({
        signal_id: signalId,
        interaction_type: interactionType,
        is_discovery: isDiscovery,
      }),
    });
  } catch (err) {
    console.error('Failed to log interaction via REST:', err);
  }
}

async function logInteractionFirestore(
  userId: string,
  signalId: string,
  interactionType: string,
  isDiscovery?: boolean,
  signalRegion?: string,
  signalCommodityTags?: string[],
  signalPayload?: any
): Promise<void> {
  const app = getFirebaseApp();
  if (!app) return;

  const db = getFirestore(app);

  try {
    // 1. Write the interaction document
    const interactionRef = doc(collection(db, 'users', userId, 'interactions'));
    await setDoc(interactionRef, {
      signal_id: signalId,
      type: interactionType,
      is_discovery: isDiscovery || false,
      created_at: new Date().toISOString(),
    });

    let weight = WEIGHTS[interactionType] || 0;
    if (isDiscovery) weight *= 1.5;

    // 2. Update user interests based on signal dimensions
    const updates: Array<{ dimension: string; entity: string }> = [];

    if (signalRegion) {
      updates.push({ dimension: 'region', entity: signalRegion });
    }

    if (signalCommodityTags && Array.isArray(signalCommodityTags)) {
      for (const tag of signalCommodityTags) {
        updates.push({ dimension: 'commodity', entity: tag });
      }
    }

    // Archetype scoring (V, C, R)
    const payload = signalPayload || {};
    if (payload.sensor_id || payload.source === 'AIS' || payload.source === 'PRODML') {
      updates.push({ dimension: 'archetype', entity: 'velocity' });
    }
    if (payload.related_signals || payload.source === 'AssayReport') {
      updates.push({ dimension: 'archetype', entity: 'context' });
    }
    if (payload.risk_factor || payload.source === 'SanctionsList' || payload.impact_level) {
      updates.push({ dimension: 'archetype', entity: 'risk' });
    }

    for (const update of updates) {
      const interestKey = `${update.dimension}_${update.entity}`;
      const interestRef = doc(db, 'users', userId, 'interests', interestKey);

      const existingSnap = await getDoc(interestRef);
      const existingScore = existingSnap.exists() ? (existingSnap.data().score || 0) : 0;

      await setDoc(interestRef, {
        user_id: userId,
        dimension: update.dimension,
        entity: update.entity,
        score: existingScore + weight,
        last_updated: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('Failed to log interaction to Firestore:', err);
  }
}

// ─── Fetch Archetype State ──────────────────────────────────────────

export async function fetchArchetypeState(userId: string): Promise<FirestoreArchetypeState> {
  const defaultState: FirestoreArchetypeState = {
    userId,
    archetype: 'The Generalist',
    velocity: 0,
    context: 0,
    risk: 0,
    interactionCount: 0,
    lastUpdated: new Date().toISOString(),
  };

  if (!FIREBASE_ENABLED()) {
    return defaultState;
  }

  const app = getFirebaseApp();
  if (!app) return defaultState;

  const db = getFirestore(app);

  try {
    // Count interactions
    const interactionsSnap = await getDocs(collection(db, 'users', userId, 'interactions'));
    const interactionCount = interactionsSnap.size;

    // Fetch archetype scores
    const interestsQuery = query(
      collection(db, 'users', userId, 'interests'),
      where('dimension', '==', 'archetype')
    );
    const interestsSnap = await getDocs(interestsQuery);

    const scores = { velocity: 0, context: 0, risk: 0 };
    interestsSnap.forEach((doc) => {
      const data = doc.data() as FirestoreUserInterest;
      if (data.entity in scores) {
        (scores as any)[data.entity] = data.score;
      }
    });

    const archetype = getArchetype(scores.velocity, scores.context, scores.risk);

    return {
      userId,
      archetype,
      velocity: scores.velocity,
      context: scores.context,
      risk: scores.risk,
      interactionCount,
      lastUpdated: new Date().toISOString(),
    };
  } catch (err) {
    console.error('Failed to fetch archetype state:', err);
    return defaultState;
  }
}

function getArchetype(v: number, c: number, r: number): 'The Hunter' | 'The Strategist' | 'The Guardian' | 'The Generalist' {
  if (v > (c + r) * 1.2) return 'The Hunter';
  if (c > (v + r) * 1.2) return 'The Strategist';
  if (r > (v + c) * 1.2) return 'The Guardian';
  return 'The Generalist';
}

// ─── Interest-based Ranking (Personality Ledger) ─────────────────────

/**
 * For Firestore mode, compute a personal ranking score per signal
 * based on the user's stored interests. This mirrors the database-side
 * rank computation from the REST API.
 */
export async function computePersonalRank(
  userId: string,
  signalRegion?: string,
  signalCommodityTags?: string[]
): Promise<number> {
  if (!FIREBASE_ENABLED()) return 0;

  const app = getFirebaseApp();
  if (!app) return 0;

  const db = getFirestore(app);
  let rank = 0;

  try {
    // Fetch region interest
    if (signalRegion) {
      const regionRef = doc(db, 'users', userId, 'interests', `region_${signalRegion}`);
      const regionSnap = await getDoc(regionRef);
      if (regionSnap.exists()) {
        rank += regionSnap.data().score || 0;
      }
    }

    // Fetch commodity interests
    if (signalCommodityTags && Array.isArray(signalCommodityTags)) {
      for (const tag of signalCommodityTags) {
        const commRef = doc(db, 'users', userId, 'interests', `commodity_${tag}`);
        const commSnap = await getDoc(commRef);
        if (commSnap.exists()) {
          rank += commSnap.data().score || 0;
        }
      }
    }
  } catch (err) {
    console.error('Failed to compute personal rank:', err);
  }

  return rank;
}