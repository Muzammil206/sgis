// src/db/pool.js
// Shared PostgreSQL connection pool — imported by all route modules

import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

// ============================================================================
// Connection strategy: Choose between local or remote (Neon) database
// ============================================================================

// OPTION 1: Use DATABASE_URL (Neon cloud or other remote database)
// Uncomment this to use remote connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max:                     10,  // Reduced for Neon free tier limits
  idleTimeoutMillis:       20_000,  // Idle timeout before closing unused connections
  connectionTimeoutMillis: 10_000, // Time to establish connection (increased)
  statement_timeout:       30_000, // Query timeout (30 seconds)
  ssl:                     { rejectUnauthorized: false }, // Required for cloud databases
});

// ============================================================================
// OPTION 2: Use local PostgreSQL connection (commented out)
// Uncomment this to use local connection instead
// ============================================================================
/*
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
*/

pool.on('error', (err) => {
  console.error('[DB] Pool error:', err.message);
  // Neon free tier suspends after idle — this is expected behavior
  if (err.code === 'ECONNREFUSED' || err.message.includes('Connection terminated')) {
    console.warn('[DB] Connection lost — will reconnect on next query');
  }
});

// Connection event listeners for Neon idle handling
pool.on('connect', () => {
  console.log('[DB] New connection established');
});

pool.on('remove', () => {
  console.log('[DB] Connection removed from pool');
});

// Verify connection on startup — exit hard if DB is unreachable
pool.connect((err, client, release) => {
  if (err) {
    console.error('[DB] ✗ Cannot connect to PostgreSQL:', err.message);
    console.error('[DB] Connection string:', process.env.DATABASE_URL ? 'Set' : 'Not set');
    process.exit(1);
  }
  console.log('[DB] PostgreSQL connected ✓');
  release();
});

export default pool;
