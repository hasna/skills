import { assertNoRetiredModeEnvVars } from "../lib/retired-settings.js";

/** Canonical variable that decides this server's internal storage backend. */
const DATABASE_URL_ENV = "HASNA_SKILLS_DATABASE_URL";

/**
 * Token identifying this application's environment namespace, for scoping the
 * retired-setting refusal to variables this package owns. See lib/retired-settings.ts.
 */
const SKILLS_ENV_NAMESPACE = "SKILLS";

export interface SkillsServerConfig {
  host: string;
  port: number;
  databaseUrl?: string;
  bootstrapApiKey?: string;
  artifactBucket?: string;
  artifactPrefix: string;
  inlineWorker: boolean;
  requestBodyLimitBytes: number;
  /**
   * Cap for a skill bundle upload, separate from requestBodyLimitBytes on purpose.
   *
   * requestBodyLimitBytes is 1 MB and guards JSON request bodies, where a megabyte of
   * JSON is already pathological. A real skill with a references/ folder goes past that
   * routinely, so publishing needed either a raised general cap - which would also have
   * raised the ceiling on every JSON endpoint, quietly - or its own. This is the "its
   * own": POST /api/v1/skills is the only route that reads it, it is checked before the
   * body is buffered, and the JSON cap is untouched.
   */
  skillBundleLimitBytes: number;
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
  // The server is the process the deployment-mode collapse is about: sqlite-or-postgres
  // is *its* internal storage. A retired storage-mode variable set here used to be read
  // by nothing, so a server meant for Postgres came up on the default SQLite file and
  // the startup banner printed "storage: sqlite (...)" as though that had been chosen.
  // Serving traffic off the wrong database in silence is the worst case of the class,
  // and it is not covered by the client-side guard in lib/native-storage.ts, because the
  // server does not go through it.
  assertNoRetiredModeEnvVars(env, {
    app: SKILLS_ENV_NAMESPACE,
    replacement: DATABASE_URL_ENV,
  });

  const nodeEnv = env.NODE_ENV || "development";
  const host = env.HOST || env.SKILLS_HOST || "0.0.0.0";
  const port = parsePositiveInt(env.PORT || env.SKILLS_PORT, 8787);
  return {
    host,
    port,
    databaseUrl: env[DATABASE_URL_ENV] || env.DATABASE_URL || undefined,
    bootstrapApiKey: env.HASNA_SKILLS_BOOTSTRAP_API_KEY || undefined,
    artifactBucket: env.HASNA_SKILLS_S3_BUCKET || env.SKILLS_S3_BUCKET || undefined,
    artifactPrefix: normalizePrefix(env.HASNA_SKILLS_S3_PREFIX || env.SKILLS_S3_PREFIX || "skills/artifacts"),
    inlineWorker: env.HASNA_SKILLS_INLINE_WORKER === "1",
    requestBodyLimitBytes: parsePositiveInt(env.HASNA_SKILLS_REQUEST_BODY_LIMIT_BYTES, 1_000_000),
    skillBundleLimitBytes: parsePositiveInt(env.HASNA_SKILLS_BUNDLE_LIMIT_BYTES, 25_000_000),
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
