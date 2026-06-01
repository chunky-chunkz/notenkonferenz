import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z
    .string({ required_error: 'DATABASE_URL is required. Set it to your external MySQL connection string, e.g. mysql://USER:PASSWORD@HOST:PORT/DATABASE. The docker-compose value mysql://nkuser:nkpassword@mysql:3306/notenkonferenz only works locally.' })
    .url('DATABASE_URL must be a valid connection string, e.g. mysql://USER:PASSWORD@HOST:PORT/DATABASE'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  SESSION_SECRET: z
    .string({ required_error: 'SESSION_SECRET is required. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"' })
    .min(16, 'SESSION_SECRET must be at least 16 characters'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  PKORG_BASE_URL: z.string().default('https://2026.pkorg.ch'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MEDIA_DIR: z.string().default('./media'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Missing or invalid environment variables:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.') || issue.path}: ${issue.message}`);
  }
  console.error('\nSet these in your Render service → Environment settings.');
  process.exit(1);
}

export const env = parsed.data;
