import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn(
    '[DB] WARNING: DATABASE_URL is not set. Domain ownership verification ' +
    'requires Postgres to persist across server restarts and deploys. ' +
    'On Railway: add a Postgres plugin to this project — it injects ' +
    'DATABASE_URL automatically. Falling back to an in-memory store for now ' +
    '(verifications will be lost on every restart).'
  );
}

// Real Postgres pool when DATABASE_URL is present; otherwise a minimal
// in-memory shim with the same query surface used below, so local dev
// without a DB configured doesn't crash — but this is NOT safe for
// production, since restarts wipe every verification record.
let pool;
const memoryStore = new Map(); // key: `${domain}::${email}` -> row object

function makeMemoryPool() {
  return {
    async query(sql, params = []) {
      // Extremely small hand-rolled shim covering exactly the queries this
      // file issues below. Not a general SQL engine.
      const text = sql.trim().toLowerCase();

      if (text.startsWith('create table')) {
        return { rows: [] };
      }

      if (text.startsWith('select') && text.includes('from domain_verifications')) {
        const [domain, email] = params;
        const row = memoryStore.get(`${domain}::${email}`);
        return { rows: row ? [row] : [] };
      }

      if (text.startsWith('insert into domain_verifications')) {
        const [domain, email, token, expiresAt] = params;
        const row = {
          domain,
          email,
          token,
          verified: false,
          verified_at: null,
          expires_at: expiresAt,
          created_at: new Date()
        };
        memoryStore.set(`${domain}::${email}`, row);
        return { rows: [row] };
      }

      if (text.startsWith('update domain_verifications set verified')) {
        const [domain, email] = params;
        const row = memoryStore.get(`${domain}::${email}`);
        if (row) {
          row.verified = true;
          row.verified_at = new Date();
        }
        return { rows: row ? [row] : [] };
      }

      return { rows: [] };
    }
  };
}

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });
} else {
  pool = makeMemoryPool();
}

export async function initDb() {
  // 1. Existing Domain Verification
  await pool.query(`
    CREATE TABLE IF NOT EXISTS domain_verifications (
      domain TEXT NOT NULL,
      email TEXT NOT NULL,
      token TEXT NOT NULL,
      verified BOOLEAN NOT NULL DEFAULT FALSE,
      verified_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (domain, email)
    );
  `);

  // 2. SaaS Multi-Tenancy: Companies
  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      api_key TEXT UNIQUE,
      subscription_plan TEXT DEFAULT 'free',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // 3. SaaS Multi-Tenancy: Users
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      company_id INTEGER REFERENCES companies(id),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // 4. Scan History (Persistence)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scan_history (
      id TEXT PRIMARY KEY,
      company_id INTEGER REFERENCES companies(id),
      target_url TEXT,
      platform TEXT,
      status TEXT,
      total_vulnerabilities INTEGER DEFAULT 0,
      report_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  console.log('[DB] SaaS Database schema initialized (domain_verifications, companies, users, scan_history).');
}

export { pool };
