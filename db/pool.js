// db/pool.js
require('dotenv').config();
const { Pool, types } = require('pg');

// Fix: return DATE columns as plain strings (YYYY-MM-DD), not JS Date objects
// This prevents timezone offset shifting dates by 1 day
types.setTypeParser(1082, val => val); // 1082 = DATE type OID

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

module.exports = pool;
