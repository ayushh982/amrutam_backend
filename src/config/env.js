import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters long').default('amrutam-default-dev-secret-key-32-chars!'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().default(1000),
  PAYMENT_WEBHOOK_SECRET: z.string().default('amrutam_webhook_secret_mock_key_2026'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', JSON.stringify(parsed.error.format(), null, 2));
  // In test environment or when starting with defaults, fallback gracefully
  if (process.env.NODE_ENV !== 'test') {
    process.exit(1);
  }
}

export const env = parsed.success ? parsed.data : {
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/amrutam_db?schema=public',
  JWT_SECRET: process.env.JWT_SECRET || 'amrutam-default-dev-secret-key-32-chars!',
  JWT_EXPIRES_IN: '24h',
  RATE_LIMIT_WINDOW_MS: 900000,
  RATE_LIMIT_MAX: 1000,
  PAYMENT_WEBHOOK_SECRET: 'amrutam_webhook_secret_mock_key_2026',
  LOG_LEVEL: 'info',
};
