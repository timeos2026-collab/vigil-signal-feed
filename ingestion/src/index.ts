import pkg from 'pg';
const { Pool } = pkg;
import * as dotenv from 'dotenv';
import { determineCommodityTags, calculateConfidenceScore } from './validation.js';
import type { SignalPayload, DataPoint } from './validation.js';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://vigil:vigil@localhost:5432/vigil',
});

// Sources identified in research
const SOURCES = ['WITSML', 'PRODML', 'IoT', 'AIS', 'Satellite', 'SCADA', 'Regulatory'];
const REGIONS = ['Permian', 'Gulf Coast', 'North Sea', 'Cushing', 'Rotterdam', 'Singapore'];

async function simulateIngestion() {
  console.log('Starting VIGIL Signal Ingestion simulation with integrated expert logic...');
  
  while (true) {
    try {
      const source = SOURCES[Math.floor(Math.random() * SOURCES.length)];
      const region = REGIONS[Math.floor(Math.random() * REGIONS.length)];
      
      if (!source || !region) continue;

      const payload: SignalPayload = generateMockPayload(source);

      // Integrated Processing Logic (from validation.ts)
      const commodityTags = determineCommodityTags(payload);
      const confidenceScore = calculateConfidenceScore(payload, commodityTags);
      const assetIdentifier = payload.metadata.asset_id || 'UNKNOWN';

      await pool.query(
        'INSERT INTO public.signals (raw_payload, commodity_tags, confidence_score, region, asset_identifier, is_verified) VALUES ($1, $2, $3, $4, $5, $6)',
        [JSON.stringify(payload), commodityTags, confidenceScore, region, assetIdentifier, true]
      );

      console.log(`Ingested signal from ${source}: ${assetIdentifier} (Confidence: ${confidenceScore.toFixed(2)}) (Tags: ${commodityTags.join(', ')})`);
    } catch (error) {
      console.error('Error during ingestion simulation:', error);
    }

    // Wait for 2-5 seconds between signals
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
  }
}

function generateMockPayload(source: string): SignalPayload {
  const timestamp = new Date().toISOString();
  let dataPoints: DataPoint[] = [];
  let metadata: any = {};

  if (source === 'WITSML') {
    dataPoints = [
      { mnemonic: 'ROP', value: Math.random() * 60, unit: 'ft/hr' },
      { mnemonic: 'WOB', value: 10 + Math.random() * 20, unit: 'klbf' }
    ];
    metadata = {
      api_number: `42-${Math.floor(Math.random() * 999)}-${Math.floor(Math.random() * 99999)}`,
      asset_id: `WELL:RIG_${Math.floor(Math.random() * 100)}`,
      operator: 'VIGIL E&P'
    };
  } else if (source === 'PRODML') {
    dataPoints = [
      { mnemonic: 'FLOW_RATE', value: Math.random() * 1000, unit: 'bbl/day' },
      { mnemonic: 'PRESSURE', value: 500 + Math.random() * 500, unit: 'psi' }
    ];
    metadata = {
      asset_id: `WELL:PAD_${Math.floor(Math.random() * 50)}`,
      commodity_type: 'crude_oil'
    };
  } else if (source === 'IoT') {
    dataPoints = [
      { mnemonic: 'TEMP', value: -160 + Math.random() * 20, unit: '%' },
      { mnemonic: 'TEMP', value: 15 + Math.random() * 10, unit: 'C' }
    ];
    metadata = {
      asset_id: `TANK:STORAGE_${Math.floor(Math.random() * 1000)}`
    };
  } else if (source === 'AIS') {
    metadata = {
      asset_id: `VESSEL:IMO${Math.floor(1000000 + Math.random() * 9000000)}`,
      draft: 12.5 + Math.random() * 5
    };
  } else if (source === 'Satellite') {
    dataPoints = [{ mnemonic: 'FLARE_INTENSITY', value: Math.random(), unit: 'index' }];
    metadata = { asset_id: `REFINERY:REF_${Math.floor(Math.random() * 10)}` };
  } else {
    dataPoints = [{ mnemonic: 'PRESSURE', value: 100 + Math.random() * 100, unit: 'psi' }];
    metadata = { asset_id: `ASSET:${Math.floor(Math.random() * 1000)}` };
  }

  return {
    source_type: source,
    payload_timestamp: timestamp,
    data_points: dataPoints,
    metadata
  };
}

simulateIngestion();
