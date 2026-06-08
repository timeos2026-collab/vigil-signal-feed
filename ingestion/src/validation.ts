export enum CommodityType {
  CRUDE_OIL = 'crude_oil',
  NATURAL_GAS = 'natural_gas',
  LNG = 'lng',
  NGL = 'ngl',
  REFINED_PRODUCTS = 'refined_products',
  LITHIUM = 'lithium',
  NICKEL = 'nickel',
  REE = 'ree',
  COBALT = 'cobalt'
}

export interface DataPoint {
  mnemonic: string;
  value: number;
  unit: string;
}

export interface SignalPayload {
  source_type: string;
  payload_timestamp: string;
  data_points: DataPoint[];
  metadata: any;
  geometry?: any;
  properties?: any;
}

const TRACK_B_KEYWORDS: Record<CommodityType, string[]> = {
  [CommodityType.LITHIUM]: [
    'lithium', 'li2o', 'spodumene', 'lepidolite', 'petalite', 'lithium brine',
    'greenbushes', 'pilgangoora', 'wodgina', 'kathleen valley', 'manono', 'salar de atacama',
    'albemarle', 'sqm', 'tianqi lithium', 'pilbara minerals', 'mineral resources', 'liontown resources', 'avz minerals'
  ],
  [CommodityType.COBALT]: [
    'cobalt', 'erythrite', 'heterogenite', 'skutterudite',
    'tenke fungurume', 'kisanfu', 'mutanda', 'kamoto', 'kansanshi', 'sentinel', 'bou azzer',
    'glencore', 'gecamines', 'huayou cobalt', 'cmoc group', 'zijin mining', 'first quantum'
  ],
  [CommodityType.NICKEL]: [
    'nickel', 'pentlandite', 'garnierite', 'nickel laterite', 'nickel sulfide',
    'vale', 'norilsk nickel', 'bhp billiton', 'wyloo metals'
  ],
  [CommodityType.REE]: [
    'ree', 'rare earth', 'monazite', 'bastnasite', 'xenotime',
    'neodymium', 'praseodymium', 'dysprosium', 'terbium', 'nd', 'pr', 'dy', 'tb',
    'lynas rare earths', 'mp materials', 'iluka resources'
  ],
  // Legacy Track A defaults
  [CommodityType.CRUDE_OIL]: [],
  [CommodityType.NATURAL_GAS]: [],
  [CommodityType.LNG]: [],
  [CommodityType.NGL]: [],
  [CommodityType.REFINED_PRODUCTS]: []
};

export function determineCommodityTags(payload: SignalPayload): CommodityType[] {
  const tags: Set<CommodityType> = new Set();
  const textContent = JSON.stringify(payload).toLowerCase();
  
  if (textContent.includes('crude oil') || textContent.includes('crude_oil')) {
    tags.add(CommodityType.CRUDE_OIL);
  }
  
  if (textContent.includes('natural gas')) {
    tags.add(CommodityType.NATURAL_GAS);
  }

  for (const [commodity, keywords] of Object.entries(TRACK_B_KEYWORDS)) {
    if (keywords.some(kw => textContent.includes(kw))) {
      tags.add(commodity as CommodityType);
    }
  }

  // IoT/SCADA logic for LNG
  const metadata = payload.metadata || {};
  const temp = metadata.temperature ?? payload.data_points.find(d => d.mnemonic === 'TEMP' || d.mnemonic === 'TEMPERATURE')?.value;
  if (temp !== undefined && temp < -150) {
    tags.add(CommodityType.LNG);
  }

  // Satellite logic for flares
  if (payload.source_type === 'Satellite' && payload.data_points.some(d => d.mnemonic === 'FLARE_INTENSITY')) {
    tags.add(CommodityType.CRUDE_OIL);
    tags.add(CommodityType.NATURAL_GAS);
  }

  // AIS logic for tankers
  if (payload.source_type === 'AIS') {
    tags.add(CommodityType.CRUDE_OIL);
  }

  // Default if nothing else
  if (tags.size === 0) {
    tags.add(CommodityType.CRUDE_OIL);
  }

  return Array.from(tags);
}

/**
 * Ported from researcher's expert logic
 */
function validateIntegrity(payload: SignalPayload, tags: CommodityType[]): { score: number; isVerified: boolean } {
  const metadata = payload.metadata || {};
  const props = payload.properties || metadata.properties || {};

  const isTrackB = tags.some(t => [CommodityType.LITHIUM, CommodityType.COBALT, CommodityType.NICKEL, CommodityType.REE].includes(t));

  if (isTrackB) {
    // Track B Checklist: Identity, Ownership, Commodity, Spatial, Status
    const hasIdentity = !!(props.PermitNumber || props.eno || props.SITE_ID || metadata.asset_id || props.manifest_id || props.permit_id || props.id);
    const hasOwnership = !!(props.PartyName || props.ENTITY_NAME || metadata.operator || props.holder_name || props.owner);
    const hasCommodity = tags.length > 0;
    const hasSpatial = !!(payload.geometry || metadata.geometry);
    const hasStatus = !!(props.Status || props.STATUS || metadata.status || props.operational_status);

    if (hasIdentity && hasOwnership && hasCommodity && hasSpatial && hasStatus) {
      return { score: 1.0, isVerified: true };
    } else if (hasIdentity && hasSpatial) {
      return { score: 0.7, isVerified: false };
    } else {
      return { score: 0.5, isVerified: false };
    }
  }

  // Legacy Track A Logic
  if (payload.source_type === 'Regulatory') {
    const hasCoreFields = (payload.geometry || metadata.geometry) && (payload.properties || metadata.properties);
    if (!hasCoreFields) {
      return { score: 0.3, isVerified: false };
    }

    const criticalFields = ['PermitNumber', 'PartyName', 'Status', 'Commodities'];
    const missing = criticalFields.filter(f => !props[f]);

    if (missing.length > 0) {
      return { score: 0.7, isVerified: false };
    }

    return { score: 0.95, isVerified: true };
  }

  return { score: 1.0, isVerified: true };
}

const JURISDICTIONAL_MULTIPLIERS: Record<string, number> = {
  'Australia': 1.00,
  'Zambia': 0.90, // Default for Zambia (EITI)
  'Zambia_Spatial': 0.80,
  'DRC': 0.75,
  'Canada': 0.85,
  'Global': 0.65
};

export interface ValidationResult {
  score: number;
  isVerified: boolean;
  reasons: {
    integrity: { score: number; isVerified: boolean };
    source_adjustment: number;
    latency_penalty: number;
    domain_adjustment: number;
    jurisdiction_multiplier: number;
  };
}

export function calculateConfidenceScore(payload: SignalPayload, tags: CommodityType[]): ValidationResult {
  const integrity = validateIntegrity(payload, tags);
  let baseScore = integrity.score;
  let source_adjustment = 0;
  
  // Source Reliability (C_source)
  const source = payload.source_type.toUpperCase();
  switch (source) {
    case 'WITSML':
    case 'PRODML':
    case 'SCADA':
    case 'IOT':
      source_adjustment = 0.05;
      break;
    case 'REGULATORY':
      source_adjustment = 0.0;
      break;
    case 'SATELLITE':
      source_adjustment = 0.0;
      break;
    case 'AIS':
      source_adjustment = -0.1;
      break;
    case 'SOCIAL_MEDIA':
      source_adjustment = -0.4;
      break;
  }
  
  let score = baseScore + source_adjustment;

  // Latency Penalty
  let latency_penalty = 0;
  const now = new Date();
  const payloadTime = new Date(payload.payload_timestamp);
  const latencyMinutes = (now.getTime() - payloadTime.getTime()) / (1000 * 60);
  if (latencyMinutes > 0) {
    const penalty = Math.floor(latencyMinutes / 30) * 0.05;
    latency_penalty = Math.min(penalty, 0.4);
    score -= latency_penalty;
  }

  // Domain Validation Adjustment
  let domain_adjustment = 0;
  if (payload.data_points.length === 0 && source !== 'REGULATORY') {
    domain_adjustment -= 0.2;
  }
  for (const dp of payload.data_points) {
    if (dp.mnemonic === 'ROP' && (dp.value < 0 || dp.value > 500)) domain_adjustment -= 0.4;
    if (dp.mnemonic === 'PRESSURE' && (dp.value < 0 || dp.value > 1500)) domain_adjustment -= 0.4;
    if (dp.mnemonic === 'FLOW_RATE' && dp.value < 0) domain_adjustment -= 0.4;
  }
  if (tags.includes(CommodityType.LNG)) {
    const metadata = payload.metadata || {};
    const temp = metadata.temperature ?? payload.data_points.find(d => d.mnemonic === 'TEMP' || d.mnemonic === 'TEMPERATURE')?.value;
    if (temp === undefined || temp > -150) domain_adjustment -= 0.5;
  }
  score += domain_adjustment;

  // Jurisdictional Multiplier (M_j)
  let region = payload.metadata?.region || 'Global';
  if (region === 'Zambia' && (payload.metadata?.is_spatial || payload.source_type === 'Spatial Dimension')) {
    region = 'Zambia_Spatial';
  }
  const jurisdiction_multiplier = JURISDICTIONAL_MULTIPLIERS[region] || JURISDICTIONAL_MULTIPLIERS['Global'];
  
  const finalScore = Math.max(0.0, Math.min(1.0, score * jurisdiction_multiplier));

  return {
    score: finalScore,
    isVerified: integrity.isVerified && finalScore >= 0.6,
    reasons: {
      integrity,
      source_adjustment,
      latency_penalty,
      domain_adjustment,
      jurisdiction_multiplier
    }
  };
}
