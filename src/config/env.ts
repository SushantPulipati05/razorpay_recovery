import dotenv from 'dotenv';
import { z } from 'zod';

// quiet: true suppresses dotenv's own promotional console output (unrelated
// to app config), which otherwise prints on every process start/restart.
dotenv.config({ quiet: true });

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/razor_recover'),
  RAZORPAY_KEY_ID: z.string().default('rzp_test_placeholder'),
  RAZORPAY_KEY_SECRET: z.string().default('rzp_secret_placeholder'),
  RAZORPAY_WEBHOOK_SECRET: z.string().default('test_webhook_secret_12345'),
  GROQ_API_KEY: z.string().optional().default(''),
  OPENAI_API_KEY: z.string().optional().default(''),
  TWILIO_ACCOUNT_SID: z.string().optional().default(''),
  TWILIO_AUTH_TOKEN: z.string().optional().default(''),
  TWILIO_WHATSAPP_NUMBER: z.string().optional().default('whatsapp:+14155238886'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOLDOUT_PERCENT: z.coerce.number().min(0).max(100).default(30),
  // Protects /api/nudge, /api/jobs/retry-now and /api/failures (x-admin-key header).
  ADMIN_API_KEY: z.string().optional().default('')
});

const DEV_WEBHOOK_SECRET = 'test_webhook_secret_12345';
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;

// The defaults above exist so the project runs locally with zero setup. In
// production they would be dangerous: a known webhook secret lets anyone forge
// a "payment received" event. So production refuses to start without real values.
if (env.NODE_ENV === 'production') {
  const problems: string[] = [];
  if (!process.env.DATABASE_URL) {
    problems.push('DATABASE_URL must be set explicitly');
  }
  if (!process.env.RAZORPAY_WEBHOOK_SECRET || env.RAZORPAY_WEBHOOK_SECRET === DEV_WEBHOOK_SECRET) {
    problems.push('RAZORPAY_WEBHOOK_SECRET must be set to your real Razorpay webhook secret');
  }
  if (env.ADMIN_API_KEY.length < 16) {
    problems.push('ADMIN_API_KEY must be set (at least 16 characters)');
  }
  if (problems.length > 0) {
    console.error('Refusing to start in production with unsafe configuration:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
}
