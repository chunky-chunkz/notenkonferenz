import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  SESSION_SECRET: z.string().min(16),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  PKORG_BASE_URL: z.string().default('https://2026.pkorg.ch'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MEDIA_DIR: z.string().default('./media'),
});

export const env = envSchema.parse(process.env);
