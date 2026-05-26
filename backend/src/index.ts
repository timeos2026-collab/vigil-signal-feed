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
const authenticate = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  // In a real app, we would verify the token/user here.
  // For VIGIL local dev, any non-empty auth header passes.
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

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Welcome to VIGIL Signal Feed API', 
    endpoints: {
      health: '/health',
      signals: '/api/signals',
      signal_detail: '/api/signals/:id'
    }
  });
});

// Real-time Signal Feed (Protected)
app.get('/api/signals', authenticate, async (req, res) => {
  try {
    const { commodity, region, min_confidence } = req.query;
    
    let query = 'SELECT id, created_at, provider_id, raw_payload, array_to_json(commodity_tags) as commodity_tags, confidence_score, region, asset_identifier, is_verified, expires_at FROM signals';
    const params: any[] = [];
    const conditions: string[] = [];

    if (commodity) {
      conditions.push(`$${params.length + 1} = ANY(commodity_tags)`);
      params.push(commodity);
    }

    if (region) {
      conditions.push(`region = $${params.length + 1}`);
      params.push(region);
    }

    if (min_confidence) {
      conditions.push(`confidence_score >= $${params.length + 1}`);
      params.push(parseFloat(min_confidence as string));
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at DESC LIMIT 50';

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
