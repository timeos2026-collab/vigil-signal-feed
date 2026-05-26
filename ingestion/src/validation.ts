/**
 * VIGIL Signal Processing & Validation Logic
 * 
 * Integrated from research/processing.ts and research/validation.ts
 */

export enum CommodityType {
  CRUDE_OIL = 'crude_oil',
  NATURAL_GAS = 'natural_gas',
  LNG = 'lng',
  REFINED_PRODUCTS = 'refined_products',
  NGLS = 'ngls', 
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
  metadata: {
    api_number?: string;
    operator?: string;
    basin?: string;
    asset_id?: string;
    temperature?: number;
    pressure?: number;
    [key: string]: any;
  };
}

/**
 * Determines the commodity tags for a given payload.
 * Based on research/processing.ts
 */
export function determineCommodityTags(payload: SignalPayload): CommodityType[] {
  const tags: Set<CommodityType> = new Set();
  const dataPoints = payload.data_points;
  const metadata = payload.metadata;

  // 1. LNG Logic: Temperature < -150C
  const temp = metadata.temperature ?? dataPoints.find(dp => dp.mnemonic === 'TEMP' || dp.mnemonic === 'TEMPERATURE')?.value;
  if (temp !== undefined && temp < -150) {
    tags.add(CommodityType.LNG);
  }

  // 2. Natural Gas Logic: High methane or known gas asset
  const isGasAsset = metadata.asset_id?.includes('GAS') || metadata.basin?.toLowerCase().includes('shale');
  if (isGasAsset) {
    tags.add(CommodityType.NATURAL_GAS);
  }

  // 3. Crude Oil Logic: API Gravity or known crude asset
  const apiGravity = dataPoints.find(dp => dp.mnemonic === 'API')?.value;
  if ((apiGravity !== undefined && apiGravity >= 20 && apiGravity <= 50) || metadata.asset_id?.includes('CRUDE')) {
    tags.add(CommodityType.CRUDE_OIL);
  }

  // 4. Refined Products: Rack or Product Pipe
  if (metadata.asset_id?.startsWith('PIPE:PRODUCT') || metadata.source_type === 'REFINERY_RACK') {
    tags.add(CommodityType.REFINED_PRODUCTS);
  }

  // Default to Natural Gas if it's a generic well without clear crude markers (often the case in shale)
  if (tags.size === 0 && metadata.asset_id?.startsWith('WELL:')) {
    tags.add(CommodityType.NATURAL_GAS);
  }

  return Array.from(tags);
}

/**
 * Validates a signal against O&G domain rules and returns a confidence score adjustment.
 * Based on research/validation.ts
 */
export function validateSignal(payload: SignalPayload, currentTags: CommodityType[]): number {
  let adjustment = 0;

  // 1. Schema Check
  if (payload.data_points.length === 0) {
    adjustment -= 0.2;
  }

  // 2. Physical Range Checks (Examples)
  for (const dp of payload.data_points) {
    if (dp.mnemonic === 'ROP' && (dp.value < 0 || dp.value > 500)) {
      adjustment -= 0.4;
    }
    if (dp.mnemonic === 'PRESSURE' && (dp.value < 0 || dp.value > 1500)) {
      adjustment -= 0.4;
    }
    // Logic from processing.ts incorporated here
    if (dp.mnemonic === 'FLOW_RATE' && dp.value < 0) {
      adjustment -= 0.4;
    }
  }

  // 3. Logical Consistency
  if (currentTags.includes(CommodityType.LNG)) {
    const temp = payload.metadata.temperature ?? payload.data_points.find(d => d.mnemonic === 'TEMP' || d.mnemonic === 'TEMPERATURE')?.value;
    if (temp === undefined || temp > -150) {
      adjustment -= 0.5;
    }
  }

  if (payload.metadata.asset_id?.startsWith('WELL:') && !payload.metadata.api_number) {
    adjustment -= 0.2;
  }

  return adjustment;
}

/**
 * Calculates the confidence score (0.0 to 1.0) for a signal.
 * Combines Source Reliability, Latency, and Domain Validation.
 */
export function calculateConfidenceScore(payload: SignalPayload, tags: CommodityType[]): number {
  let score = 0.5; // Base Score

  // 1. Source Reliability (based on research/processing.ts)
  switch (payload.source_type) {
    case 'WITSML':
    case 'PRODML':
    case 'SCADA':
    case 'IoT':
      score += 0.3;
      break;
    case 'REGULATORY':
    case 'SATELLITE':
      score += 0.2;
      break;
    case 'THIRD_PARTY':
    case 'AIS':
      score += 0.0;
      break;
    case 'SOCIAL_MEDIA':
      score -= 0.3;
      break;
  }

  // 2. Latency Penalty
  const now = new Date();
  const payloadTime = new Date(payload.payload_timestamp);
  const latencyMinutes = (now.getTime() - payloadTime.getTime()) / (1000 * 60);
  if (latencyMinutes > 0) {
    const penalty = Math.floor(latencyMinutes / 30) * 0.05;
    score -= Math.min(penalty, 0.5);
  }

  // 3. Domain Validation Adjustment
  score += validateSignal(payload, tags);

  // Clamp score between 0.0 and 1.0
  return Math.max(0.0, Math.min(1.0, score));
}
