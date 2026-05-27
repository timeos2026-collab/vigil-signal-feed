import express from 'express';
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Mock Authentication Middleware
const authenticate = (req: any, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  // Mock User ID for local dev
  req.userId = '00000000-0000-0000-0000-000000000001'; 
  next();
};

const pool = new Pool({
  user: 'vigil',
  host: 'localhost',
  database: 'vigil',
  password: 'vigil',
  port: 5432,
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'VIGIL API Feed' });
});

// Interaction weights
const WEIGHTS: Record<string, number> = {
  view: 1,
  deep_read: 3,
  bookmark: 10,
  filter_apply: 15,
  alert_set: 20,
  dismiss: -10,
};

const CLUSTERS: Record<string, string[]> = {
  energy: ['crude_oil', 'natural_gas', 'lng'],
  minerals: ['lithium', 'cobalt', 'nickel', 'copper'],
  refining: ['gasoline', 'diesel', 'jet_fuel'],
};

const getArchetype = (v: number, c: number, r: number) => {
  if (v > (c + r) * 1.2) return 'The Hunter';
  if (c > (v + r) * 1.2) return 'The Strategist';
  if (r > (v + c) * 1.2) return 'The Guardian';
  return 'The Generalist';
};

// Log interaction and update interests
app.post('/api/interactions', authenticate, async (req: any, res) => {
  const client = await pool.connect();
  try {
    const { signal_id, interaction_type, is_discovery } = req.body;
    const userId = req.userId;

    if (!signal_id || !interaction_type || !WEIGHTS[interaction_type]) {
      return res.status(400).json({ error: 'Invalid interaction data' });
    }

    await client.query('BEGIN');

    // 1. Log the interaction
    await client.query(
      'INSERT INTO user_interactions (user_id, signal_id, type) VALUES ($1, $2, $3)',
      [userId, signal_id, interaction_type]
    );

    // 2. Fetch signal details to know what dimensions to update
    const signalResult = await client.query('SELECT region, array_to_json(commodity_tags) as commodity_tags, raw_payload FROM signals WHERE id = $1', [signal_id]);
    if (signalResult.rows.length > 0) {
      const signal = signalResult.rows[0];
      let weight = WEIGHTS[interaction_type];

      // Apply Discovery Multiplier (1.5x)
      if (is_discovery) {
        weight *= 1.5;
      }

      const updates = [];
      
      // Update Region interest
      if (signal.region) {
        updates.push({ dimension: 'region', entity: signal.region });
      }

      // Update Commodity interests
      if (signal.commodity_tags && Array.isArray(signal.commodity_tags)) {
        for (const tag of signal.commodity_tags) {
          updates.push({ dimension: 'commodity', entity: tag });
        }
      }

      // Archetype Scoring Logic (V, C, R)
      const payload = signal.raw_payload || {};
      
      // V (Velocity): Sensor data, technical telemetry
      if (payload.sensor_id || payload.source === 'AIS' || payload.source === 'PRODML' || payload.source_type === 'AIS' || payload.source_type === 'PRODML' || payload.source_type === 'WITSML' || payload.telemetry) {
        updates.push({ dimension: 'archetype', entity: 'velocity' });
      }
      
      // C (Context): Related signals, reports
      if (payload.related_signals || payload.source === 'AssayReport' || payload.source_type === 'AssayReport' || payload.document_type === 'Regulatory') {
        updates.push({ dimension: 'archetype', entity: 'context' });
      }
      
      // R (Risk): Sanctions, weather, geopolitical
      if (payload.risk_factor || payload.source === 'SanctionsList' || payload.source_type === 'SanctionsList' || payload.impact_level) {
        updates.push({ dimension: 'archetype', entity: 'risk' });
      }

      for (const update of updates) {
        await client.query(
          `INSERT INTO user_interests (user_id, dimension, entity, score)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, dimension, entity)
           DO UPDATE SET score = user_interests.score + EXCLUDED.score, last_updated = now()`,
          [userId, update.dimension, update.entity, weight]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ status: 'success' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Real-time Signal Feed (Protected)
app.get('/api/signals', authenticate, async (req: any, res) => {
  try {
    const { commodity, region, min_confidence, personalized, deviceType, timeState } = req.query;
    const userId = req.userId;

    // Tempo Matching Default Values
    let limit = 50;
    let maxAge = '30 days'; // Default
    let summarization = 'Detailed';

    if (deviceType === 'Mobile') {
      limit = 5;
      maxAge = '1 hour';
      summarization = 'Bullet';
    }

    if (timeState === 'Trading') {
      maxAge = '5 minutes';
      summarization = 'Raw';
    }

    // Fetch user archetype scores
    const interactionCountResult = await pool.query(
      "SELECT count(*) FROM user_interactions WHERE user_id = $1",
      [userId]
    );
    const interactionCount = parseInt(interactionCountResult.rows[0].count);

    let archetype = 'The Generalist';
    if (interactionCount >= 50) {
      const archetypeResult = await pool.query(
        "SELECT entity, score FROM user_interests WHERE user_id = $1 AND dimension = 'archetype'",
        [userId]
      );
      const scores = { velocity: 0, context: 0, risk: 0 };
      archetypeResult.rows.forEach(row => {
        if (row.entity in scores) (scores as any)[row.entity] = parseFloat(row.score);
      });
      archetype = getArchetype(scores.velocity, scores.context, scores.risk);
    }

    let query = `
      SELECT 
        s.id, s.created_at, s.provider_id, s.raw_payload, 
        array_to_json(s.commodity_tags) as commodity_tags, 
        s.confidence_score, s.region, s.asset_identifier, 
        s.is_verified, s.expires_at
    `;
    
    const params: any[] = [];
    const conditions: string[] = ["s.created_at > now() - interval '" + maxAge + "'"];

    if (personalized === 'true') {
      const pIdx = params.length + 1;
      query += `
        , (
          s.confidence_score + 
          COALESCE((SELECT SUM(score) FROM user_interests WHERE user_id = $${pIdx} AND dimension = 'region' AND entity = s.region), 0) +
          COALESCE((SELECT SUM(score) FROM user_interests WHERE user_id = $${pIdx} AND dimension = 'commodity' AND entity = ANY(s.commodity_tags::text[])), 0)
        ) as personal_rank
      `;
      params.push(userId);
    }

    query += ' FROM signals s';

    if (commodity) {
      conditions.push(`$${params.length + 1} = ANY(s.commodity_tags)`);
      params.push(commodity);
    }

    if (region) {
      conditions.push(`s.region = $${params.length + 1}`);
      params.push(region);
    }

    if (min_confidence) {
      conditions.push(`s.confidence_score >= $${params.length + 1}`);
      params.push(parseFloat(min_confidence as string));
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    if (personalized === 'true') {
      query += ` ORDER BY personal_rank DESC, created_at DESC LIMIT $${params.length + 1}`;
      params.push(limit);
    } else {
      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
      params.push(limit);
    }

    const mainResult = await pool.query(query, params);
    let signals = mainResult.rows;

    // Discovery Logic (ε-Greedy)
    if (personalized === 'true' && signals.length > 0) {
      const epsilon = 0.10;
      const discoveryCount = Math.max(1, Math.floor(signals.length * epsilon));
      
      const discoverySignals: any[] = [];
      const seenIds = new Set(signals.map(s => s.id));

      // 1. Proximity Discovery (50%) - Adjacent interests
      const proxCount = Math.ceil(discoveryCount * 0.5);
      if (proxCount > 0) {
        const topCommodities = await pool.query(
          "SELECT entity FROM user_interests WHERE user_id = $1 AND dimension = 'commodity' ORDER BY score DESC LIMIT 3",
          [userId]
        );
        const relatedCommodities: string[] = [];
        topCommodities.rows.forEach(row => {
          for (const cluster in CLUSTERS) {
            if (CLUSTERS[cluster].includes(row.entity)) {
              relatedCommodities.push(...CLUSTERS[cluster].filter(c => c !== row.entity));
            }
          }
        });

        if (relatedCommodities.length > 0) {
          const proxResult = await pool.query(`
            SELECT s.*, array_to_json(s.commodity_tags) as commodity_tags 
            FROM signals s
            WHERE s.commodity_tags && $1::commodity_type[]
            AND s.id NOT IN (SELECT signal_id FROM user_interactions WHERE user_id = $2)
            AND s.id != ALL($3::uuid[])
            ORDER BY RANDOM()
            LIMIT $4
          `, [relatedCommodities, userId, Array.from(seenIds), proxCount]);
          proxResult.rows.forEach(s => {
            discoverySignals.push({ ...s, is_discovery: true });
            seenIds.add(s.id);
          });
        }
      }

      // 2. Global Heat Discovery (30%)
      const heatCount = Math.ceil(discoveryCount * 0.3);
      if (heatCount > 0 && discoverySignals.length < discoveryCount) {
        const heatResult = await pool.query(`
          SELECT s.*, array_to_json(s.commodity_tags) as commodity_tags, COUNT(ui.id) as interaction_count
          FROM signals s
          LEFT JOIN user_interactions ui ON s.id = ui.signal_id
          WHERE s.id NOT IN (SELECT signal_id FROM user_interactions WHERE user_id = $1)
          AND s.id != ALL($2::uuid[])
          GROUP BY s.id
          ORDER BY interaction_count DESC, created_at DESC
          LIMIT $3
        `, [userId, Array.from(seenIds), heatCount]);
        heatResult.rows.forEach(s => {
          discoverySignals.push({ ...s, is_discovery: true });
          seenIds.add(s.id);
        });
      }

      // 3. Random Seed (Remaining)
      const randomCount = discoveryCount - discoverySignals.length;
      if (randomCount > 0) {
        const randomResult = await pool.query(`
          SELECT s.*, array_to_json(s.commodity_tags) as commodity_tags 
          FROM signals s
          WHERE s.id NOT IN (SELECT signal_id FROM user_interactions WHERE user_id = $1)
          AND s.id != ALL($2::uuid[])
          AND s.confidence_score > 0.7
          ORDER BY RANDOM()
          LIMIT $3
        `, [userId, Array.from(seenIds), randomCount]);
        randomResult.rows.forEach(s => {
          discoverySignals.push({ ...s, is_discovery: true });
        });
      }
      
      // Inject discovery signals
      signals = [...signals.slice(0, signals.length - discoverySignals.length), ...discoverySignals];
    }

    res.json({
      archetype,
      summarization,
      signals
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Signal Detail (Protected)
app.get('/api/signals/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM signals WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Signal not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(Number(port), '0.0.0.0', () => {
  console.log(`VIGIL API Feed listening at http://0.0.0.0:${port}`);
});
