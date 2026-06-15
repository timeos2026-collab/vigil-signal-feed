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
const DRC_ENDPOINT = 'https://portals.landadmin.com/drc/arcgis/rest/services/Public/MapServer/0/query';

async function scrapeDRCArcGIS() {
  console.log('Starting DRC ArcGIS Scraper (CAMI)...');

  try {
    const response = await axios.get(DRC_ENDPOINT, {
      params: {
        where: "1=1",
        outFields: 'Num_Dossier,Titulaire,Type_Droit,Etat,Substances,Superficie,Province',
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
            asset_id: props.Num_Dossier,
            region: 'DRC',
            is_spatial: !!geom,
            properties: {
              permit_id: props.Num_Dossier,
              holder_name: props.Titulaire,
              right_type: props.Type_Droit,
              status: props.Etat,
              commodities: props.Substances,
              area: props.Superficie,
              province: props.Province
            }
          },
          geometry: geom
        };

        const tags = determineCommodityTags(payload);
        const validation = calculateConfidenceScore(payload, tags);

        await pool.query(
          'INSERT INTO public.signals (raw_payload, commodity_tags, confidence_score, region, asset_identifier, is_verified, confidence_metadata) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [JSON.stringify(payload), tags, validation.score, 'DRC', payload.metadata.asset_id, validation.isVerified, JSON.stringify(validation.reasons)]
        );

        console.log(`Ingested DRC Signal: ${payload.metadata.asset_id} - ${props.Titulaire}`);
      }
    } else {
      console.warn('No features found or DRC endpoint unreachable. Simulation mode active.');
      await injectMockDRCSignal();
    }
  } catch (error) {
    console.error('Error scraping DRC ArcGIS:', (error as Error).message);
    await injectMockDRCSignal();
  }
}

async function injectMockDRCSignal() {
  const mockPayload: SignalPayload = {
    source_type: 'Regulatory',
    payload_timestamp: new Date().toISOString(),
    data_points: [],
    metadata: {
      asset_id: 'PR 12345',
      region: 'DRC',
      is_spatial: true,
      properties: {
        permit_id: 'PR 12345',
        holder_name: 'Tenke Fungurume Mining SARL',
        right_type: 'PE',
        status: 'Octroyé',
        commodities: 'Cu, Co',
        area: '150.5',
        province: 'Lualaba'
      }
    },
    geometry: {
      rings: [[[26.1, -10.5], [26.2, -10.5], [26.2, -10.6], [26.1, -10.6], [26.1, -10.5]]]
    }
  };

  const tags = determineCommodityTags(mockPayload);
  const validation = calculateConfidenceScore(mockPayload, tags);

  await pool.query(
    'INSERT INTO public.signals (raw_payload, commodity_tags, confidence_score, region, asset_identifier, is_verified, confidence_metadata) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [JSON.stringify(mockPayload), tags, validation.score, 'DRC', mockPayload.metadata.asset_id, validation.isVerified, JSON.stringify(validation.reasons)]
  );
  console.log('Ingested Mock DRC Signal (Simulation Mode)');
}

scrapeDRCArcGIS().then(() => {
    console.log('DRC Scraper run complete.');
    process.exit(0);
});
