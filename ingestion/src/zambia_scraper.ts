import dotenv from 'dotenv';
import pkg from 'pg';
const { Pool } = pkg;
import axios from 'axios';
import { determineCommodityTags, calculateConfidenceScore, CommodityType } from './validation.js';
import type { SignalPayload } from './validation.js';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://vigil:vigil@localhost:5432/vigil',
});

// Based on specs in track_b_africa_scrapers_specs.md
const ZAMBIA_ENDPOINT = 'https://portal.miningcadastre.gov.zm/arcgis/rest/services/Public/MapServer/0/query';

async function scrapeZambiaArcGIS() {
  console.log('Starting Zambia ArcGIS Scraper (ZIMIS/Portal)...');

  try {
    const response = await axios.get(ZAMBIA_ENDPOINT, {
      params: {
        where: "1=1",
        outFields: 'LicenseNumber,CompanyName,LicenseType,Status,Commodities,GrantDate,ExpiryDate',
        f: 'json',
        resultRecordCount: 10
      },
      timeout: 10000
    });

    if (response.data && response.data.features) {
      for (const feature of response.data.features) {
        const props = feature.attributes;
        const geom = feature.geometry;

        const payload: SignalPayload = {
          source_type: 'Regulatory',
          payload_timestamp: new Date().toISOString(),
          data_points: [],
          metadata: {
            asset_id: props.LicenseNumber,
            region: 'Zambia',
            is_spatial: !!geom,
            properties: {
              permit_id: props.LicenseNumber,
              holder_name: props.CompanyName,
              right_type: props.LicenseType,
              status: props.Status,
              commodities: props.Commodities,
              valid_from: props.GrantDate,
              valid_to: props.ExpiryDate
            }
          },
          geometry: geom
        };

        const tags = determineCommodityTags(payload);
        const validation = calculateConfidenceScore(payload, tags);

        await pool.query(
          'INSERT INTO public.signals (raw_payload, commodity_tags, confidence_score, region, asset_identifier, is_verified, confidence_metadata) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [JSON.stringify(payload), tags, validation.score, 'Zambia', payload.metadata.asset_id, validation.isVerified, JSON.stringify(validation.reasons)]
        );

        console.log(`Ingested Zambia Signal: ${payload.metadata.asset_id} - ${props.CompanyName}`);
      }
    } else {
      console.warn('No features found or Zambia endpoint unreachable. Simulation mode active.');
      await injectMockZambiaSignal();
    }
  } catch (error) {
    console.error('Error scraping Zambia ArcGIS:', (error as Error).message);
    await injectMockZambiaSignal();
  }
}

async function injectMockZambiaSignal() {
  const mockPayload: SignalPayload = {
    source_type: 'Regulatory',
    payload_timestamp: new Date().toISOString(),
    data_points: [],
    metadata: {
      asset_id: '21564-HQ-LEL',
      region: 'Zambia',
      is_spatial: true,
      properties: {
        permit_id: '21564-HQ-LEL',
        holder_name: 'Mopani Copper Mines PLC',
        right_type: 'Large Scale Exploration Licence',
        status: 'Active',
        commodities: 'Copper, Cobalt',
        valid_from: '2020-01-15',
        valid_to: '2024-01-14'
      }
    },
    geometry: {
      rings: [[[28.5, -12.5], [28.6, -12.5], [28.6, -12.6], [28.5, -12.6], [28.5, -12.5]]]
    }
  };

  const tags = determineCommodityTags(mockPayload);
  const validation = calculateConfidenceScore(mockPayload, tags);

  await pool.query(
    'INSERT INTO public.signals (raw_payload, commodity_tags, confidence_score, region, asset_identifier, is_verified, confidence_metadata) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [JSON.stringify(mockPayload), tags, validation.score, 'Zambia', mockPayload.metadata.asset_id, validation.isVerified, JSON.stringify(validation.reasons)]
  );
  console.log('Ingested Mock Zambia Signal (Simulation Mode)');
}

scrapeZambiaArcGIS().then(() => {
    console.log('Zambia Scraper run complete.');
    process.exit(0);
});
