import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized.length === 0) {
      return undefined;
    }

    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }

    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4010),
  CORS_ORIGIN: z.string().default('http://localhost:4010,http://localhost:5173'),
  DATABASE_URL: z.string().min(1).default('file:./prisma/dev.db'),

  DASHBOARD_ENABLED: booleanFromEnv.default(true),
  APP_ALLOWED_GOOGLE_EMAILS: z.string().default(''),
  APP_SESSION_SECRET: z.string().optional(),
  APP_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(6),
  RATE_LIMIT_AUTH_LOGIN_START_WINDOW_MS: z.coerce.number().int().min(1000).max(3600000).default(60000),
  RATE_LIMIT_AUTH_LOGIN_START_MAX: z.coerce.number().int().min(1).max(500).default(20),
  RATE_LIMIT_WRITE_WINDOW_MS: z.coerce.number().int().min(1000).max(3600000).default(60000),
  RATE_LIMIT_WRITE_MAX: z.coerce.number().int().min(1).max(1000).default(30),

  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_OAUTH_SCOPES: z
    .string()
    .default(
      'https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email openid'
    ),
  GOOGLE_OAUTH_STATE_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  GOOGLE_OAUTH_TOKEN_ALERT_DAYS: z.coerce.number().int().nonnegative().default(7),
  GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY: z.string().optional(),

  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
  GOOGLE_ADS_MANAGER_CUSTOMER_ID: z.string().optional(),
  GOOGLE_ADS_API_VERSION: z.string().default('v18'),
  GOOGLE_ADS_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  GOOGLE_ADS_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
  GOOGLE_ADS_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(400),

  GOOGLE_SHEETS_REQUIRED_SCOPE: z.string().default('https://www.googleapis.com/auth/spreadsheets'),
  GOOGLE_SHEETS_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  GOOGLE_SHEETS_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
  GOOGLE_SHEETS_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(400),
  SHEETS_MANUAL_MAX_RANGE_DAYS: z.coerce.number().int().min(1).max(730).default(180),

  INGESTION_MAX_RANGE_DAYS: z.coerce.number().int().min(1).max(730).default(365),
  INGESTION_RUN_STALE_MINUTES: z.coerce.number().int().min(5).max(1440).default(180),
  SHEETS_RUN_STALE_MINUTES: z.coerce.number().int().min(5).max(1440).default(240),

  SCHEDULER_POLL_SECONDS: z.coerce.number().int().min(10).max(300).default(30),
  SCHEDULER_CATCHUP_DAYS: z.coerce.number().int().min(1).max(14).default(3)
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const errors = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Invalid environment configuration: ${errors}`);
}

const requiredInProduction: Array<{ key: string; value: string | undefined }> = [
  { key: 'APP_ALLOWED_GOOGLE_EMAILS', value: parsed.data.APP_ALLOWED_GOOGLE_EMAILS },
  { key: 'APP_SESSION_SECRET', value: parsed.data.APP_SESSION_SECRET },
  { key: 'GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY', value: parsed.data.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY }
];

if (parsed.data.NODE_ENV === 'production') {
  const missing = requiredInProduction
    .filter((item) => !item.value || item.value.trim().length === 0)
    .map((item) => item.key);

  if (missing.length > 0) {
    throw new Error(`Invalid production configuration: required env var(s) are missing: ${missing.join(', ')}`);
  }
}

export const env = parsed.data;
