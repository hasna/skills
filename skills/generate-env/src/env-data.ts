import type { EnvVariable } from "./types";

export const DEFAULT_CATEGORIES = [
  "database",
  "auth",
  "api",
  "services",
  "email",
  "storage",
  "monitoring",
  "security",
  "misc",
];

export const SENSITIVE_PATTERNS = [
  /secret/i,
  /password/i,
  /private.*key/i,
  /api.*key/i,
  /token/i,
  /credential/i,
  /auth/i,
];

export const CATEGORY_PATTERNS: Record<string, RegExp[]> = {
  database: [/database/i, /_db_/i, /postgres/i, /mongodb/i, /mysql/i, /redis/i, /_url$/i],
  auth: [/auth/i, /jwt/i, /session/i, /token/i, /oauth/i, /saml/i],
  api: [/api.*key/i, /^api_/i, /_api$/i],
  services: [/stripe/i, /sendgrid/i, /twilio/i, /aws/i, /openai/i, /anthropic/i],
  email: [/mail/i, /smtp/i, /sendgrid/i, /resend/i, /postmark/i],
  storage: [/bucket/i, /storage/i, /s3/i, /cdn/i, /cloudinary/i],
  monitoring: [/sentry/i, /analytics/i, /log/i, /datadog/i, /newrelic/i],
  security: [/cors/i, /csp/i, /encryption/i, /cipher/i],
};

export const COMMON_VARIABLES: EnvVariable[] = [
  {
    name: "NODE_ENV",
    category: "general",
    description: "Node.js environment mode",
    example: "development",
    defaultValue: "development",
    required: true,
    sensitive: false,
    validation: "z.enum(['development', 'production', 'test'])",
  },
  {
    name: "PORT",
    category: "general",
    description: "Server port number",
    example: "3000",
    defaultValue: "3000",
    required: false,
    sensitive: false,
    validation: "z.string().regex(/^\\d+$/).transform(Number)",
  },
  {
    name: "HOST",
    category: "general",
    description: "Server host address",
    example: "localhost",
    defaultValue: "localhost",
    required: false,
    sensitive: false,
  },
];
