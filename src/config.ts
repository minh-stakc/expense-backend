import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

function requireEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  port: parseInt(requireEnv('PORT', '3000'), 10),
  nodeEnv: requireEnv('NODE_ENV', 'development'),

  db: {
    host: requireEnv('DB_HOST', 'localhost'),
    port: parseInt(requireEnv('DB_PORT', '5432'), 10),
    database: requireEnv('DB_NAME', 'expense_tracker'),
    user: requireEnv('DB_USER', 'postgres'),
    password: requireEnv('DB_PASSWORD', ''),
    min: parseInt(requireEnv('DB_POOL_MIN', '2'), 10),
    max: parseInt(requireEnv('DB_POOL_MAX', '10'), 10),
  },

  categorizer: {
    confidenceThreshold: parseFloat(
      requireEnv('CATEGORIZER_CONFIDENCE_THRESHOLD', '0.6')
    ),
  },

  isProduction: requireEnv('NODE_ENV', 'development') === 'production',
} as const;
