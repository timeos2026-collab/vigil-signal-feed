/**
 * Firestore Document Types for VIGIL
 *
 * These types mirror the PostgreSQL 'signals' table schema
 * and are used for Firestore real-time sync.
 */

export interface FirestoreSignal {
  id: string;
  created_at: string;
  raw_payload: Record<string, unknown>;
  commodity_tags: string[];
  confidence_score: number;
  region: string;
  asset_identifier: string;
  is_verified: boolean;
  expires_at?: string;
  confidence_metadata?: {
    integrity: { score: number; isVerified: boolean };
    source_adjustment: number;
    latency_penalty: number;
    domain_adjustment: number;
  };
  /** Set to true for discovery (ε-greedy injected) signals */
  is_discovery?: boolean;
}

export interface FirestoreUserProfile {
  id: string;
  full_name?: string;
  role: 'admin' | 'analyst' | 'trader' | 'operator';
  organization_name?: string;
  created_at?: string;
}

export interface FirestoreUserInterest {
  user_id: string;
  dimension: 'region' | 'commodity' | 'archetype';
  entity: string;
  score: number;
  last_updated: string;
}

/**
 * Archetype state as stored in Firestore
 */
export interface FirestoreArchetypeState {
  userId: string;
  archetype: 'The Hunter' | 'The Strategist' | 'The Guardian' | 'The Generalist';
  velocity: number;
  context: number;
  risk: number;
  interactionCount: number;
  lastUpdated: string;
}

/**
 * The merged response shape that the frontend expects
 */
export interface SignalFeedState {
  archetype: string;
  summarization: string;
  signals: FirestoreSignal[];
}