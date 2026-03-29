// db/setup.js
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function setupDatabase() {
  const client = await pool.connect();
  try {
    console.log('🔧 Setting up database...');
    await client.query(`

      CREATE TABLE IF NOT EXISTS project_types (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(80) UNIQUE NOT NULL,
        color      VARCHAR(20) DEFAULT '#2D5BE3',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS employees (
        id           SERIAL PRIMARY KEY,
        badge_number VARCHAR(20) UNIQUE,
        name         VARCHAR(100) NOT NULL,
        email        VARCHAR(150) UNIQUE,
        password     VARCHAR(255),
        role         VARCHAR(30) NOT NULL DEFAULT 'viewer'
                     CHECK (role IN ('administrator','project_manager','project_lead','viewer')),
        employment   VARCHAR(30) DEFAULT 'full_time'
                     CHECK (employment IN ('full_time','part_time','subcontractor','freelance')),
        daily_hours  NUMERIC(4,1) DEFAULT 8,
        active       BOOLEAN DEFAULT TRUE,
        created_at   TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS projects (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(150) NOT NULL,
        type_id     INTEGER REFERENCES project_types(id) ON DELETE SET NULL,
        location    VARCHAR(100),
        client_name VARCHAR(100),
        start_date  DATE,
        deadline    DATE,
        progress    INTEGER DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
        status      VARCHAR(30) DEFAULT 'active',
        description TEXT,
        created_at  TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS project_crew (
        id          SERIAL PRIMARY KEY,
        project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        av_role     VARCHAR(60) NOT NULL DEFAULT 'crew',
        created_at  TIMESTAMP DEFAULT NOW(),
        UNIQUE(project_id, employee_id)
      );

      CREATE TABLE IF NOT EXISTS time_entries (
        id          SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        entry_date  DATE NOT NULL,
        task        VARCHAR(150),
        start_time  TIME,
        end_time    TIME,
        duration_min INTEGER,
        notes       TEXT,
        status      VARCHAR(20) DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
        approved_by INTEGER REFERENCES employees(id),
        created_by  INTEGER REFERENCES employees(id),
        created_at  TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS pull_sheet_entries (
        id            SERIAL PRIMARY KEY,
        project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        entry_date    DATE NOT NULL,
        employee_id   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
        employee_name VARCHAR(120),
        av_role       VARCHAR(60),
        hours_worked  NUMERIC(5,1),
        overtime      NUMERIC(5,1) DEFAULT 0,
        notes         TEXT,
        created_by    INTEGER REFERENCES employees(id),
        created_at    TIMESTAMP DEFAULT NOW()
      );

    `);
    console.log('✅ Tables created.');

    const ptCount = await client.query('SELECT COUNT(*) FROM project_types');
    if (parseInt(ptCount.rows[0].count) === 0) {
      await client.query(`INSERT INTO project_types (name,color) VALUES
        ('Corporate Event','#2D5BE3'),('Concert','#1A8A4A'),
        ('Conference','#E8440A'),('Broadcast','#C47B0A'),
        ('Exhibition','#7B2D8B'),('Installation','#1A7A8A')`);
      console.log('✅ Default project types added.');
    }

    // Create admin employee if not exists
    const existing = await client.query('SELECT id FROM employees WHERE email=$1', [process.env.ADMIN_EMAIL]);
    if (existing.rows.length === 0) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
      await client.query(
        `INSERT INTO employees (name,email,password,role,employment) VALUES ($1,$2,$3,'administrator','full_time')`,
        [process.env.ADMIN_NAME, process.env.ADMIN_EMAIL, hash]
      );
      console.log(`✅ Admin created: ${process.env.ADMIN_EMAIL}`);
    } else {
      console.log('ℹ️  Admin already exists.');
    }

    console.log('\n🎉 Setup complete! Run: npm start\n');
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

setupDatabase();
