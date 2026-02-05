import fs from 'fs';
import path from 'path';
import { getPool, closePool } from './connection';

/**
 * Simple migration runner. Executes all .sql files in the migrations
 * directory in alphabetical order, tracking which have already been applied.
 */
async function migrate(): Promise<void> {
  const pool = getPool();

  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Get already-applied migrations
  const applied = await pool.query<{ name: string }>(
    'SELECT name FROM _migrations ORDER BY name'
  );
  const appliedSet = new Set(applied.rows.map((r) => r.name));

  // Read migration files
  const migrationsDir = path.resolve(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`  [skip] ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    console.log(`  [run]  ${file} ...`);

    try {
      await pool.query(sql);
      await pool.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      console.log(`  [done] ${file}`);
    } catch (err) {
      console.error(`  [FAIL] ${file}:`, err);
      throw err;
    }
  }

  console.log('All migrations applied.');
}

migrate()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
