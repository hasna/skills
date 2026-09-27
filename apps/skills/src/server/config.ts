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
  /** Optional expiring run-output namespace; immutable bundles retain artifactPrefix. */
  runArtifactPrefix?: string;
  /** @deprecated Unversioned execution is retired; this flag cannot enable it. */
  inlineWorker: boolean;
  /**
   * HMAC key for signing served skill bundles. When set, the bundle endpoint adds
   * X-Skill-Bundle-Signature so clients holding the same key can verify that the bytes
   * they pulled are the bytes this server decided to serve. Never logged or printed.
   *
   * Canonical env name: HASNA_SKILLS_API_SIGNING_KEY — the name the production deploy
   * mounts (infra-live hasna-app module, infra/apps/skills/prod/main.tf). The legacy
   * HASNA_SKILLS_SIGNING_KEY is retained as a backwards-compatible alias; the canonical
   * name wins when both are set. Decision record: todos ee1904ca, plan 8022d27f.
   */
  bundleSigningKey?: string;
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
  /**
   * How long a deleted skill answers 410 with a tombstone marker before it is purged
   * (todos d061fcda). Within the window a client's pull can reconcile (remove its local
   * copy); after it, the row and its bundle are gone and the slug is an ordinary 404.
   */
  tombstoneWindowMs: number;
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
    runArtifactPrefix: env.HASNA_SKILLS_S3_RUN_PREFIX ? normalizePrefix(env.HASNA_SKILLS_S3_RUN_PREFIX) : undefined,
    inlineWorker: env.HASNA_SKILLS_INLINE_WORKER === "1",
    // HASNA_SKILLS_API_SIGNING_KEY is canonical: it is the name the production deploy
    // mounts (see the doc comment on bundleSigningKey). The legacy name is read only
    // when the canonical one is unset, so a deploy that mounts both cannot drift.
    bundleSigningKey: env.HASNA_SKILLS_API_SIGNING_KEY || env.HASNA_SKILLS_SIGNING_KEY || undefined,
    requestBodyLimitBytes: parsePositiveInt(env.HASNA_SKILLS_REQUEST_BODY_LIMIT_BYTES, 1_000_000),
    skillBundleLimitBytes: parsePositiveInt(env.HASNA_SKILLS_BUNDLE_LIMIT_BYTES, 25_000_000),
    // 7 days: long enough for a pulling client's next run to reconcile a deletion,
    // short enough that a forgotten slug is eventually gone rather than kept forever.
    tombstoneWindowMs: parsePositiveInt(env.HASNA_SKILLS_TOMBSTONE_WINDOW_MS, 7 * 24 * 60 * 60 * 1000),
    // Binding a socket does not establish the public authority of an instance.
    // The API handler refuses to start until the operator sets this explicitly;
    // otherwise profile receipts could pin clients to a guessed local origin.
    publicBaseUrl: (env.SKILLS_PUBLIC_BASE_URL || "").replace(/\/+$/, ""),
    nodeEnv,
    allowEphemeralStore: env.HASNA_SKILLS_ALLOW_EPHEMERAL_STORE === "1",
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePrefix(value: string): string {
  return value.replace(/^\/+|\/+$/g, "") || "skills/artifacts";
}
