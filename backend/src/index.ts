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

// Log interaction and update interests
app.post('/api/interactions', authenticate, async (req: any, res) => {
  const client = await pool.connect();
  try {
    const { signal_id, interaction_type } = req.body;
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
    const signalResult = await client.query('SELECT region, array_to_json(commodity_tags) as commodity_tags FROM signals WHERE id = $1', [signal_id]);
    if (signalResult.rows.length > 0) {
      const signal = signalResult.rows[0];
      const weight = WEIGHTS[interaction_type];

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
    const { commodity, region, min_confidence, personalized } = req.query;
    const userId = req.userId;
    
    let query = `
      SELECT 
        s.id, s.created_at, s.provider_id, s.raw_payload, 
        array_to_json(s.commodity_tags) as commodity_tags, 
        s.confidence_score, s.region, s.asset_identifier, 
        s.is_verified, s.expires_at
    `;
    
    const params: any[] = [];
    const conditions: string[] = [];

    if (personalized === 'true') {
      // Join with user interests to calculate personalized rank
      // Simple ranking: BaseScore + sum of matching dimension scores
      query += `
        , (
          s.confidence_score + 
          COALESCE((SELECT SUM(score) FROM user_interests WHERE user_id = $${params.length + 1} AND dimension = 'region' AND entity = s.region), 0) +
          COALESCE((SELECT SUM(score) FROM user_interests WHERE user_id = $${params.length + 1} AND dimension = 'commodity' AND entity = ANY(s.commodity_tags::text[])), 0)
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
      query += ' ORDER BY personal_rank DESC, created_at DESC LIMIT 50';
    } else {
      query += ' ORDER BY created_at DESC LIMIT 50';
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
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
