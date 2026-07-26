export interface SkillsServerConfig {
  host: string;
  port: number;
  databaseUrl?: string;
  bootstrapApiKey?: string;
  artifactBucket?: string;
  artifactPrefix: string;
  inlineWorker: boolean;
  requestBodyLimitBytes: number;
  publicBaseUrl: string;
  nodeEnv: string;
  /**
   * Allow starting on a store that declares itself non-durable.
   *
   * Off by default, because "started fine, lost everything on restart" is the failure
   * this whole change exists to remove. Tests and throwaway demos that genuinely want
   * an in-process store set HASNA_SKILLS_ALLOW_EPHEMERAL_STORE=1 and own the
   * consequence; nobody gets there by forgetting to configure a database.
   */
  allowEphemeralStore: boolean;
}

export function resolveServerConfig(env: Record<string, string | undefined> = process.env): SkillsServerConfig {
  const nodeEnv = env.NODE_ENV || "development";
  const host = env.HOST || env.SKILLS_HOST || "0.0.0.0";
  const port = parsePositiveInt(env.PORT || env.SKILLS_PORT, 8787);
  return {
    host,
    port,
    databaseUrl: env.HASNA_SKILLS_DATABASE_URL || env.DATABASE_URL || undefined,
    bootstrapApiKey: env.HASNA_SKILLS_BOOTSTRAP_API_KEY || undefined,
    artifactBucket: env.HASNA_SKILLS_S3_BUCKET || env.SKILLS_S3_BUCKET || undefined,
    artifactPrefix: normalizePrefix(env.HASNA_SKILLS_S3_PREFIX || env.SKILLS_S3_PREFIX || "skills/artifacts"),
    inlineWorker: env.HASNA_SKILLS_INLINE_WORKER === "1",
    requestBodyLimitBytes: parsePositiveInt(env.HASNA_SKILLS_REQUEST_BODY_LIMIT_BYTES, 1_000_000),
    // No vendor default: an operator's server advertises either the origin they
    // configured or its own bound address. It never names someone else's host.
    publicBaseUrl: (env.SKILLS_PUBLIC_BASE_URL || localOrigin(host, port)).replace(/\/+$/, ""),
    nodeEnv,
    allowEphemeralStore: env.HASNA_SKILLS_ALLOW_EPHEMERAL_STORE === "1",
  };
}

function localOrigin(host: string, port: number): string {
  const hostname = host === "0.0.0.0" || host === "::" ? "localhost" : host;
  return `http://${hostname.includes(":") ? `[${hostname}]` : hostname}:${port}`;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePrefix(value: string): string {
  return value.replace(/^\/+|\/+$/g, "") || "skills/artifacts";
}
