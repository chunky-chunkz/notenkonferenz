import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z
    .string({ required_error: 'DATABASE_URL is required. Set it to your external MySQL connection string, e.g. mysql://USER:PASSWORD@HOST:PORT/DATABASE. The docker-compose value mysql://nkuser:nkpassword@mysql:3306/notenkonferenz only works locally.' })
    .url('DATABASE_URL must be a valid connection string, e.g. mysql://USER:PASSWORD@HOST:PORT/DATABASE'),
  REDIS_URL: z.string().optional(),
  SESSION_SECRET: z
    .string({ required_error: 'SESSION_SECRET is required. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"' })
    .min(16, 'SESSION_SECRET must be at least 16 characters'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  PKORG_BASE_URL: z.string().default('https://2026.pkorg.ch'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MEDIA_DIR: z.string().default('./media'),

  // ── Cloudflare R2 (S3-compatible) ──────────────────────────────────────────
  // When R2_BUCKET is set all four credential vars are required.
  // Leave unset to use local disk storage (development / single-instance demos).
  // NOTE: Render Free local disk is ephemeral — files are lost on every deploy
  //       or restart. Set R2_* vars for any persistent file storage.
  R2_BUCKET: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  // Optional: base URL of a public R2 bucket or custom domain for direct downloads.
  R2_PUBLIC_URL: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.R2_BUCKET) {
    for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const) {
      if (!data[key]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when R2_BUCKET is set` });
      }
    }
  }
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
