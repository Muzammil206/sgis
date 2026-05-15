// src/db/pool.js
// Shared PostgreSQL connection pool — imported by all route modules

import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const pool = new Pool({
  host:                    process.env.DB_HOST     || 'localhost',
  port:                    Number(process.env.DB_PORT) || 5432,
  database:                process.env.DB_NAME     || 'sgis',
  user:                    process.env.DB_USER     || 'postgres',
  password:                process.env.DB_PASSWORD || '',
  max:                     20,
  idleTimeoutMillis:       30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

// Verify connection on startup — exit hard if DB is unreachable
pool.connect((err, client, release) => {
  if (err) {
    console.error('[DB] Cannot connect to PostgreSQL:', err.message);
    process.exit(1);
  }
  console.log('[DB] PostgreSQL connected ✓');
  release();
});

export default pool;
