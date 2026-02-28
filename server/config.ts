import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default("0.0.0.0"),
  CORS_ORIGIN: z.string().default("http://localhost:8080"),
  FRONTEND_BASE_URL: z.string().url().default("http://localhost:8080"),
  API_PUBLIC_BASE_URL: z.string().url().default("http://localhost:3001"),
  DATABASE_URL: z.string().optional(),
  OAUTH_STATE_SECRET: z.string().min(12).default("dev-oauth-state-secret"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT_ID: z.string().default("common"),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_PROVIDER: z.enum(["baileys", "cloudapi"]).default("baileys"),
  WHATSAPP_BAILEYS_SESSIONS_DIR: z.string().default("server/data/baileys-sessions"),
  WHATSAPP_API_VERSION: z.string().default("v21.0"),
  WHATSAPP_TEMPLATE_NAME: z.string().optional(),
  WHATSAPP_TEMPLATE_LANG: z.string().default("en_US"),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().default("SendToAmram <amram@sendtoamram.co.il>"),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL_EXPENSIVE: z.string().default("claude-sonnet-4-20250514"),
  AI_MODEL_CHEAP: z.string().default("claude-haiku-4-5-20251001"),
  CRON_SECRET: z.string().optional(),
  ACCOUNTANT_TOKEN_SECRET: z.string().optional(),
  WHATSAPP_BRIDGE_URL: z.string().optional(),
  WHATSAPP_BRIDGE_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

export const env: AppEnv = envSchema.parse(process.env);
