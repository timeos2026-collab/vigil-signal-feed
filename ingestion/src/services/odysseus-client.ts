/**
 * Odysseus Client — Local Model Serving
 *
 * Communicates with local LLM endpoints served by Odysseus (vllm/llama.cpp).
 *
 * Endpoints (configurable via environment):
 *   ODYSSEUS_TAGGER_URL   — Mistral-7B-v0.3 (Tagging Engine)
 *   ODYSSEUS_AUDITOR_URL  — Llama-3-8B-Instruct (Integrity Auditor)
 *
 * Each endpoint expects an OpenAI-compatible chat completions API.
 *
 * Includes the Integrity Preservation Protocol (IPPs):
 *   1. Entity Linking Penalty (Company: Unknown → -0.25)
 *   2. Hardened Ground Truth Lookup Table
 *   3. Structured output format enforcement
 */

import dotenv from 'dotenv';

dotenv.config();

// ─── Configuration ──────────────────────────────────────────────────

const TAGGER_URL = process.env.ODYSSEUS_TAGGER_URL || 'http://localhost:8080/v1/chat/completions';
const AUDITOR_URL = process.env.ODYSSEUS_AUDITOR_URL || 'http://localhost:8080/v1/chat/completions';
const LOCAL_FALLBACK = process.env.ODYSSEUS_FALLBACK === 'true' || true;

export interface TaggerResult {
  commodity_tags: string[];
  company: string | null;
  confidence_multiplier: number;
  related_entities: string[];
}

export interface AuditorResult {
  s_integrity: number;
  mj_applied: number;
  is_verified: boolean;
  reasons: string[];
}

// ─── Ground Truth Lookup Table (Hardened) ──────────────────────────

const JURISDICTIONAL_MULTIPLIERS: Record<string, number> = {
  'Australia': 1.0,
  'Zambia': 0.9,
  'DRC': 0.75,
  'Canada': 0.85,
  'Global': 0.65,
};

const KNOWN_ENTITIES: Record<string, string[]> = {
  nickel: ['Vale', 'Norilsk Nickel', 'BHP Billiton', 'Tsingshan', 'Wyloo Metals'],
  lithium: ['Albemarle', 'SQM', 'Tianqi Lithium', 'Pilbara Minerals', 'Liontown Resources', 'Mineral Resources'],
  cobalt: ['Glencore', 'Gecamines', 'Huayou Cobalt', 'CMOC Group', 'Zijin Mining', 'First Quantum'],
  ree: ['Lynas Rare Earths', 'MP Materials', 'Iluka Resources'],
};

const KNOWN_HUBS: Record<string, string> = {
  'Port Hedland': 'Australia',
  'Qinghai': 'China',
  'Mutanda': 'DRC',
  'Greenbushes': 'Australia',
  'Salar de Atacama': 'Chile',
};

const SOURCE_CONFIDENCE: Record<string, number> = {
  'Gov API': 1.0,
  'Tier-1 News': 0.8,
  'Social': 0.6,
  'Alt Data': 0.6,
  'WITSML': 0.95,
  'PRODML': 0.95,
  'IoT': 0.9,
  'SCADA': 0.9,
  'Satellite': 0.85,
  'AIS': 0.7,
  'Regulatory': 1.0,
  'Spatial Dimension': 0.9,
};

// ─── Tagger (Mistral-7B) — Commodity Tagging ─────────────────────

export async function tagWithLocalModel(
  payload: Record<string, unknown>,
  sourceType: string,
  region: string
): Promise<TaggerResult> {
  const payloadText = JSON.stringify(payload);

  // Build prompt per spec section 4.1
  const tagPrompt = buildTaggingPrompt(payloadText, sourceType, region);

  try {
    const response = await fetch(TAGGER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.2-1b-instruct',
        messages: [
          { role: 'system', content: tagPrompt.system },
          { role: 'user', content: tagPrompt.user },
        ],
        temperature: 0.1,
        max_tokens: 256,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`Odysseus Tagger HTTP ${response.status}`);
    }

    const data = await response.json();
    const result: TaggerResult = JSON.parse(data.choices?.[0]?.message?.content || '{}');

    // Apply Integrity Preservation Rules
    return applyEntityLinkingPenalty(result, payloadText, region);
  } catch (err) {
    console.warn('[Odysseus Tagger] Request failed, using rule-based fallback:', (err as Error).message);
    if (LOCAL_FALLBACK) {
      return ruleBasedTagging(payload, sourceType, region);
    }
    throw err;
  }
}

function buildTaggingPrompt(
  payloadText: string,
  sourceType: string,
  region: string
): { system: string; user: string } {
  return {
    system: `You are the VIGIL Expert Tagging Engine.
TASK: Analyze the incoming JSON payload and extract commodity tags.
TARGET COMMODITIES: Lithium, Cobalt, Nickel, REE (Rare Earth Elements), Crude Oil, Natural Gas, LNG.

GROUND TRUTH LOOKUP TABLE (do not hallucinate):
Jurisdictions: Australia (1.0), Zambia (0.9), DRC (0.75).
Known Producers:
- Nickel: ${KNOWN_ENTITIES.nickel.join(', ')}
- Lithium: ${KNOWN_ENTITIES.lithium.join(', ')}
- Cobalt: ${KNOWN_ENTITIES.cobalt.join(', ')}
- REE: ${KNOWN_ENTITIES.ree.join(', ')}

RULES:
1. Match keywords, chemical symbols (Li, Co, Ni), and project names from payload.
2. Identify the operating company or parent owner from the Ground Truth table.
3. If company cannot be identified from payload or Ground Truth, set company to null.
4. OUTPUT FORMAT: {"commodity_tags": [], "company": string | null, "confidence_multiplier": float, "related_entities": []}`,
    user: `Source: ${sourceType}\nRegion: ${region}\nPayload: ${payloadText}`,
  };
}

function applyEntityLinkingPenalty(
  result: TaggerResult,
  payloadText: string,
  _region: string
): TaggerResult {
  // IPR 1: If model tagged with high confidence but failed to link to known producer
  if (result.confidence_multiplier > 0.7 && !result.company) {
    // Check if payload mentions any known entity
    const hasKnownEntity = Object.values(KNOWN_ENTITIES)
      .flat()
      .some((entity) => payloadText.toLowerCase().includes(entity.toLowerCase()));

    if (hasKnownEntity) {
      // Penalty: reduce confidence_multiplier by 0.25
      result.confidence_multiplier = Math.max(0.0, result.confidence_multiplier - 0.25);
    } else {
      // No known entity mentioned — moderate penalty
      result.confidence_multiplier = Math.max(0.0, result.confidence_multiplier - 0.1);
    }
  }

  // Enforce minimum confidence
  if (result.confidence_multiplier < 0.1) {
    result.confidence_multiplier = 0.1;
  }

  return result;
}

// ─── Auditor (Llama-3-8B) — Confidence Scoring ──────────────────

export async function auditWithLocalModel(
  payload: Record<string, unknown>,
  tags: string[],
  region: string,
  sourceType: string,
  ttiHours?: number
): Promise<AuditorResult> {
  const payloadText = JSON.stringify(payload);
  const mj = JURISDICTIONAL_MULTIPLIERS[region] || JURISDICTIONAL_MULTIPLIERS['Global'];
  const cSource = SOURCE_CONFIDENCE[sourceType] || SOURCE_CONFIDENCE['Alt Data'];
  const tti = ttiHours ?? 0;

  // Build prompt per spec section 4.2
  const auditPrompt = buildAuditPrompt(payloadText, tags, region, mj, cSource, tti);

  try {
    const response = await fetch(AUDITOR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.2-1b-instruct',
        messages: [
          { role: 'system', content: auditPrompt.system },
          { role: 'user', content: auditPrompt.user },
        ],
        temperature: 0.1,
        max_tokens: 256,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`Odysseus Auditor HTTP ${response.status}`);
    }

    const data = await response.json();
    const result: AuditorResult = JSON.parse(data.choices?.[0]?.message?.content || '{}');

    // Validate the s_integrity is within [0, 1]
    result.s_integrity = Math.max(0.0, Math.min(1.0, result.s_integrity || 0));

    return result;
  } catch (err) {
    console.warn('[Odysseus Auditor] Request failed, using rule-based fallback:', (err as Error).message);
    if (LOCAL_FALLBACK) {
      return ruleBasedAudit(payload, tags, region, sourceType, tti);
    }
    throw err;
  }
}

function buildAuditPrompt(
  _payloadText: string,
  tags: string[],
  region: string,
  mj: number,
  cSource: number,
  ttiHours: number
): { system: string; user: string } {
  const tagList = tags.length > 0 ? tags.join(', ') : 'Unknown';
  // Sigmoid TTI Penalty: S_integrity = C_source * Mj * (1 - 1/(1 + exp(-K * tti)))
  const K = 0.5;
  const ttiPenalty = 1 - 1 / (1 + Math.exp(-K * ttiHours));

  return {
    system: `You are the VIGIL Signal Integrity Auditor.
TASK: Calculate the Final Integrity Score (S_integrity) for a Track B signal.

GROUND TRUTH LOOKUP:
- Jurisdictional Multipliers (Mj): Australia: 1.0, Zambia: 0.9, DRC: 0.75.
- Source Base Confidence (C_source): Gov API: 1.0, Tier-1 News: 0.8, Social/Alt: 0.6.
- K-Factor: 0.5 (Steepness).

CALCULATION RULES:
1. Identify Mj and C_source from Ground Truth table.
2. Apply Sigmoid TTI Penalty: S_integrity = C_source * Mj * (1 - (1 / (1 + exp(-0.5 * tti_hours))))
3. If TTI_hours is 0, S_integrity = C_source * Mj (no latency penalty).
4. OUTPUT FORMAT: {"s_integrity": float, "mj_applied": float, "is_verified": boolean, "reasons": []}`,
    user: `Commodities: [${tagList}]\nJurisdiction: ${region}\nSource: (C_source=${cSource.toFixed(2)})\nTTI Hours: ${ttiHours.toFixed(2)}\n\nPre-computed Mj: ${mj.toFixed(2)}, Pre-computed TTI penalty factor: ${ttiPenalty.toFixed(4)}`,
  };
}

function ruleBasedAudit(
  _payload: Record<string, unknown>,
  tags: string[],
  region: string,
  sourceType: string,
  ttiHours: number
): AuditorResult {
  const mj = JURISDICTIONAL_MULTIPLIERS[region] || JURISDICTIONAL_MULTIPLIERS['Global'];
  const cSource = SOURCE_CONFIDENCE[sourceType] || SOURCE_CONFIDENCE['Alt Data'];
  const K = 0.5;
  const ttiPenalty = 1 - 1 / (1 + Math.exp(-K * ttiHours));
  const sIntegrity = Math.max(0.0, Math.min(1.0, cSource * mj * ttiPenalty));

  const reasons: string[] = [];
  reasons.push(`C_source=${cSource.toFixed(2)} (${sourceType})`);
  reasons.push(`Mj=${mj.toFixed(2)} (${region})`);
  reasons.push(`TTI=${ttiHours.toFixed(2)}h penalty factor=${ttiPenalty.toFixed(4)}`);

  return {
    s_integrity: Math.round(sIntegrity * 10000) / 10000,
    mj_applied: mj,
    is_verified: sIntegrity >= 0.6,
    reasons,
  };
}

// ─── Rule-Based Tagging Fallback ──────────────────────────────────

function ruleBasedTagging(
  payload: Record<string, unknown>,
  sourceType: string,
  region: string
): TaggerResult {
  const payloadText = JSON.stringify(payload).toLowerCase();
  const tags: string[] = [];
  let company: string | null = null;
  let multiplier = 1.0;

  // Commodity detection via keywords
  if (/lithium|spodumene|li2o|albemarle|sqm/i.test(payloadText)) tags.push('lithium');
  if (/cobalt|glencore|gecamines|huayou/i.test(payloadText)) tags.push('cobalt');
  if (/nickel|pentlandite|vale|norilsk/i.test(payloadText)) tags.push('nickel');
  if (/ree|rare earth|monazite|lynas|mp materials/i.test(payloadText)) tags.push('ree');

  // Company detection
  for (const [comm, entities] of Object.entries(KNOWN_ENTITIES)) {
    for (const entity of entities) {
      if (payloadText.includes(entity.toLowerCase())) {
        company = entity;
        // Boost confidence when known entity matches
        multiplier = Math.min(1.0, multiplier + 0.1);
        // Ensure commodity is tagged
        if (!tags.includes(comm)) tags.push(comm);
      }
    }
  }

  // Source-specific defaults
  if (tags.length === 0) {
    if (sourceType === 'AIS') tags.push('crude_oil');
    else if (sourceType === 'Satellite') { tags.push('crude_oil'); tags.push('natural_gas'); }
    else tags.push('crude_oil');
  }

  return {
    commodity_tags: tags,
    company,
    confidence_multiplier: Math.round(multiplier * 100) / 100,
    related_entities: company ? [company] : [],
  };
}

// ─── Multi-Model Consensus ────────────────────────────────────────

export function checkConsensus(
  taggerResult: TaggerResult,
  auditorResult: AuditorResult
): { passed: boolean; disagreements: string[] } {
  const disagreements: string[] = [];

  // If tagger found no tags but auditor says verified → disagreement
  if (taggerResult.commodity_tags.length === 0 && auditorResult.is_verified) {
    disagreements.push('tagger found no commodities but auditor verified');
  }

  // If confidence_multiplier is very low but s_integrity is high → potential mismatch
  if (taggerResult.confidence_multiplier < 0.3 && auditorResult.s_integrity > 0.7) {
    disagreements.push('tagging confidence low but integrity score high');
  }

  return {
    passed: disagreements.length === 0,
    disagreements,
  };
}
