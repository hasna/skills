import { createHash, createHmac } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";
import { getDataDir } from "./config.js";
import { getProjectStateDir } from "./project-state.js";
import { assertNoRetiredModeEnvVars } from "./retired-settings.js";

/**
 * There is no storage "mode" either.
 *
 * This layer used to carry a declared local|remote|hybrid label. Nothing ever
 * branched on it: it was echoed into `storage status` and `storage sync-plan`
 * beside databaseConfigured/s3Configured, which are read from the actual
 * configuration. A declared label can contradict them (mode=remote with no
 * database URL), so it was a second, weaker answer to a question already
 * answered truthfully. What the store does is derived from what you configured:
 * on-box SQLite plus files, plus Postgres and/or S3 when their env vars are set.
 *
 * Deleting the label left the variable that used to hold it merely *unread*, which
 * is the worse failure and is now refused: see lib/retired-settings.ts.
 */
export const SKILLS_STORAGE_TABLES = [
  "skills_sync_records",
  "skills_sync_cursors",
] as const;

export const STORAGE_TABLES = SKILLS_STORAGE_TABLES;

export type SkillsStorageTable = typeof SKILLS_STORAGE_TABLES[number];

export interface SkillsNativeStorageConfig {
  databaseUrl?: string;
  databaseSsl?: boolean;
  databaseSchema?: string;
  s3Bucket?: string;
  s3Prefix?: string;
  awsRegion?: string;
  s3Endpoint?: string;
  s3ForcePathStyle?: boolean;
  syncBatchSize: number;
  dryRun: boolean;
}

export const SKILLS_NATIVE_STORAGE_ENV = {
  databaseUrl: "HASNA_SKILLS_DATABASE_URL",
  databaseSsl: "HASNA_SKILLS_DATABASE_SSL",
  databaseSchema: "HASNA_SKILLS_DATABASE_SCHEMA",
  s3Bucket: "HASNA_SKILLS_S3_BUCKET",
  s3Prefix: "HASNA_SKILLS_S3_PREFIX",
  awsRegion: "HASNA_SKILLS_AWS_REGION",
  s3Endpoint: "HASNA_SKILLS_S3_ENDPOINT",
  s3ForcePathStyle: "HASNA_SKILLS_S3_FORCE_PATH_STYLE",
  s3AccessKeyId: "HASNA_SKILLS_S3_ACCESS_KEY_ID",
  s3SecretAccessKey: "HASNA_SKILLS_S3_SECRET_ACCESS_KEY",
  s3SessionToken: "HASNA_SKILLS_S3_SESSION_TOKEN",
  syncBatchSize: "HASNA_SKILLS_SYNC_BATCH_SIZE",
  dryRun: "HASNA_SKILLS_SYNC_DRY_RUN",
} as const;

export const SKILLS_NATIVE_STORAGE_FALLBACK_ENV = {
  databaseUrl: "SKILLS_DATABASE_URL",
  databaseSsl: "SKILLS_DATABASE_SSL",
  databaseSchema: "SKILLS_DATABASE_SCHEMA",
  s3Bucket: "SKILLS_S3_BUCKET",
  s3Prefix: "SKILLS_S3_PREFIX",
  awsRegion: "SKILLS_AWS_REGION",
  s3Endpoint: "SKILLS_S3_ENDPOINT",
  s3ForcePathStyle: "SKILLS_S3_FORCE_PATH_STYLE",
  s3AccessKeyId: "SKILLS_S3_ACCESS_KEY_ID",
  s3SecretAccessKey: "SKILLS_S3_SECRET_ACCESS_KEY",
  s3SessionToken: "SKILLS_S3_SESSION_TOKEN",
  syncBatchSize: "SKILLS_SYNC_BATCH_SIZE",
  dryRun: "SKILLS_SYNC_DRY_RUN",
} as const;

export const SKILLS_STORAGE_ENV = SKILLS_NATIVE_STORAGE_ENV;
export const SKILLS_STORAGE_FALLBACK_ENV = SKILLS_NATIVE_STORAGE_FALLBACK_ENV;

/**
 * Token identifying this application's environment namespace.
 *
 * Used only to scope the retired-setting refusal to our own variables. Sibling
 * Hasna apps are removing the same axis on their own schedule and their variables
 * are present in the same shell, so a bare suffix match would refuse to start over
 * a variable this package does not own.
 */
const SKILLS_ENV_NAMESPACE = "SKILLS";

export function resolveSkillsNativeStorageConfig(
  env: Record<string, string | undefined> = process.env,
): SkillsNativeStorageConfig {
  // The single chokepoint: resolveStorageConfig() and every getStorageStatus()
  // alias route through here, so one guard covers all of them. A guard on one of
  // three entry points is a guard on none.
  assertNoRetiredModeEnvVars(env, {
    app: SKILLS_ENV_NAMESPACE,
    replacement: SKILLS_NATIVE_STORAGE_ENV.databaseUrl,
  });

  return {
    databaseUrl: getSkillsStorageDatabaseUrl(env),
    databaseSsl: parseBoolean(readStorageEnv(env, "databaseSsl").value),
    databaseSchema: readStorageEnv(env, "databaseSchema").value,
    s3Bucket: readStorageEnv(env, "s3Bucket").value,
    s3Prefix: readStorageEnv(env, "s3Prefix").value,
    awsRegion: readStorageEnv(env, "awsRegion").value ?? "us-east-1",
    s3Endpoint: readStorageEnv(env, "s3Endpoint").value,
    s3ForcePathStyle: parseBoolean(readStorageEnv(env, "s3ForcePathStyle").value) ?? false,
    syncBatchSize: parsePositiveInteger(readStorageEnv(env, "syncBatchSize").value) ?? 500,
    dryRun: parseBoolean(readStorageEnv(env, "dryRun").value) ?? true,
  };
}

export function resolveStorageConfig(
  env: Record<string, string | undefined> = process.env,
): SkillsNativeStorageConfig {
  return resolveSkillsNativeStorageConfig(env);
}

export function getSkillsStorageDatabaseEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  return readStorageEnv(env, "databaseUrl").name;
}

export function getStorageDatabaseEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  return getSkillsStorageDatabaseEnv(env);
}

export function getSkillsStorageDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return readStorageEnv(env, "databaseUrl").value;
}

export function getStorageDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return getSkillsStorageDatabaseUrl(env);
}

export interface SkillsNativeStorageStatus {
  package: "open-skills";
  tables: readonly SkillsStorageTable[];
  env: {
    databaseUrl: string;
    s3Bucket: string;
  };
  local: {
    dataDir: string;
    projectStateDir: string;
    feedbackDbPath: string;
  };
  remote: {
    databaseConfigured: boolean;
    s3Configured: boolean;
    databaseEnv: string;
    s3BucketEnv: string;
    activeDatabaseEnv: string;
    activeS3BucketEnv: string;
    region: string;
    dryRun: boolean;
  };
}

export function getSkillsNativeStorageStatus(
  options: { targetDir?: string; env?: Record<string, string | undefined> } = {},
): SkillsNativeStorageStatus {
  const env = options.env ?? process.env;
  const config = resolveSkillsNativeStorageConfig(env);
  const databaseEnv = readStorageEnv(env, "databaseUrl");
  const s3BucketEnv = readStorageEnv(env, "s3Bucket");
  const targetDir = options.targetDir ?? process.cwd();
  return {
    package: "open-skills",
    tables: [...SKILLS_STORAGE_TABLES],
    env: {
      databaseUrl: SKILLS_NATIVE_STORAGE_ENV.databaseUrl,
      s3Bucket: SKILLS_NATIVE_STORAGE_ENV.s3Bucket,
    },
    local: {
      dataDir: getDataDir(),
      projectStateDir: getProjectStateDir(targetDir),
      feedbackDbPath: join(getDataDir(), "skills.db"),
    },
    remote: {
      databaseConfigured: Boolean(config.databaseUrl),
      s3Configured: Boolean(config.s3Bucket),
      databaseEnv: SKILLS_NATIVE_STORAGE_ENV.databaseUrl,
      s3BucketEnv: SKILLS_NATIVE_STORAGE_ENV.s3Bucket,
      activeDatabaseEnv: databaseEnv.name,
      activeS3BucketEnv: s3BucketEnv.name,
      region: config.awsRegion ?? "us-east-1",
      dryRun: config.dryRun,
    },
  };
}

export function getSkillsStorageStatus(
  options: { targetDir?: string; env?: Record<string, string | undefined> } = {},
): SkillsNativeStorageStatus {
  return getSkillsNativeStorageStatus(options);
}

export function getStorageStatus(
  options: { targetDir?: string; env?: Record<string, string | undefined> } = {},
): SkillsNativeStorageStatus {
  return getSkillsNativeStorageStatus(options);
}

export interface SkillsSnapshotFile {
  path: string;
  sizeBytes: number;
  sha256: string;
  contentBase64?: string;
}

export interface SkillsLocalSnapshot {
  schemaVersion: 1;
  exportedAt: string;
  files: SkillsSnapshotFile[];
}

export function exportSkillsLocalSnapshot(
  targetDir: string = process.cwd(),
  options: { includeFileContents?: boolean } = {},
): SkillsLocalSnapshot {
  const projectStateDir = getProjectStateDir(targetDir);
  const files: SkillsSnapshotFile[] = [];
  if (existsSync(projectStateDir)) {
    for (const filePath of walkFiles(projectStateDir)) {
      const bytes = readFileSync(filePath);
      const relativePath = toPosix(relative(targetDir, filePath));
      files.push({
        path: relativePath,
        sizeBytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        ...(options.includeFileContents ? { contentBase64: Buffer.from(bytes).toString("base64") } : {}),
      });
    }
  }
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function importSkillsLocalSnapshot(
  snapshot: SkillsLocalSnapshot,
  targetDir: string = process.cwd(),
  options: { overwrite?: boolean } = {},
): { written: number; skipped: number } {
  let written = 0;
  let skipped = 0;
  for (const file of snapshot.files) {
    if (!file.contentBase64) {
      skipped += 1;
      continue;
    }
    const absolutePath = resolveSnapshotPath(targetDir, file.path);
    if (existsSync(absolutePath) && !options.overwrite) {
      skipped += 1;
      continue;
    }
    const bytes = Buffer.from(file.contentBase64, "base64");
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== file.sha256) {
      throw new Error(`Snapshot file checksum mismatch: ${file.path}`);
    }
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, bytes);
    written += 1;
  }
  return { written, skipped };
}

export interface SkillsPostgresQueryClient {
  query<T = unknown>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export interface SkillsSyncRecord {
  scope: string;
  kind: string;
  id: string;
  updatedAt: string;
  deletedAt?: string | null;
  source?: string | null;
  payload: Record<string, unknown>;
}

export const skillsPostgresSyncSchemaSql = `
CREATE TABLE IF NOT EXISTS skills_sync_records (
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  source TEXT,
  payload JSONB NOT NULL,
  PRIMARY KEY (scope, kind, id)
);

CREATE INDEX IF NOT EXISTS skills_sync_records_updated_at_idx
  ON skills_sync_records (updated_at);

CREATE TABLE IF NOT EXISTS skills_sync_cursors (
  scope TEXT NOT NULL,
  cursor_name TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, cursor_name)
);
`.trim();

export class SkillsPostgresSyncStore {
  constructor(private readonly client: SkillsPostgresQueryClient) {}

  async ensureSchema(): Promise<void> {
    await this.client.query(skillsPostgresSyncSchemaSql);
  }

  async upsertRecords(records: readonly SkillsSyncRecord[]): Promise<number> {
    let count = 0;
    for (const record of records) {
      await this.client.query(
        [
          "INSERT INTO skills_sync_records",
          "(scope, kind, id, updated_at, deleted_at, source, payload)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)",
          "ON CONFLICT (scope, kind, id) DO UPDATE SET",
          "updated_at = EXCLUDED.updated_at,",
          "deleted_at = EXCLUDED.deleted_at,",
          "source = EXCLUDED.source,",
          "payload = EXCLUDED.payload",
        ].join(" "),
        [
          record.scope,
          record.kind,
          record.id,
          record.updatedAt,
          record.deletedAt ?? null,
          record.source ?? null,
          JSON.stringify(record.payload),
        ],
      );
      count += 1;
    }
    return count;
  }

  async pullUpdatedSince(
    params: { scope: string; since?: string; limit?: number },
  ): Promise<SkillsSyncRecord[]> {
    const limit = params.limit ?? 500;
    const result = await this.client.query<{
      scope: string;
      kind: string;
      id: string;
      updated_at: string;
      deleted_at: string | null;
      source: string | null;
      payload: Record<string, unknown> | string;
    }>(
      [
        "SELECT scope, kind, id, updated_at, deleted_at, source, payload",
        "FROM skills_sync_records",
        "WHERE scope = $1 AND updated_at > $2",
        "ORDER BY updated_at ASC",
        "LIMIT $3",
      ].join(" "),
      [params.scope, params.since ?? "1970-01-01T00:00:00.000Z", limit],
    );
    return result.rows.map((row) => ({
      scope: row.scope,
      kind: row.kind,
      id: row.id,
      updatedAt: toIsoString(row.updated_at),
      deletedAt: row.deleted_at ? toIsoString(row.deleted_at) : null,
      source: row.source,
      payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
    }));
  }

  async getCursor(scope: string, cursorName: string): Promise<string | null> {
    const result = await this.client.query<{ value: string }>(
      "SELECT value FROM skills_sync_cursors WHERE scope = $1 AND cursor_name = $2",
      [scope, cursorName],
    );
    return result.rows[0]?.value ?? null;
  }

  async setCursor(scope: string, cursorName: string, value: string): Promise<void> {
    await this.client.query(
      [
        "INSERT INTO skills_sync_cursors (scope, cursor_name, value, updated_at)",
        "VALUES ($1, $2, $3, now())",
        "ON CONFLICT (scope, cursor_name) DO UPDATE SET",
        "value = EXCLUDED.value, updated_at = EXCLUDED.updated_at",
      ].join(" "),
      [scope, cursorName, value],
    );
  }
}

export function createSkillsPostgresSyncStore(client: SkillsPostgresQueryClient): SkillsPostgresSyncStore {
  return new SkillsPostgresSyncStore(client);
}

export function createSkillsSnapshotSyncRecord(
  snapshot: SkillsLocalSnapshot,
  options: { scope?: string; id?: string; source?: string } = {},
): SkillsSyncRecord {
  return {
    scope: options.scope ?? "default",
    kind: "local-snapshot",
    id: options.id ?? "project-state",
    updatedAt: snapshot.exportedAt,
    source: options.source ?? "open-skills",
    payload: snapshot as unknown as Record<string, unknown>,
  };
}

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SkillsS3ObjectStoreOptions {
  bucket: string;
  region?: string;
  prefix?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  credentials: AwsCredentials;
  fetch?: SkillsFetch;
}

export interface SkillsS3PutObjectOptions {
  key: string;
  body: Uint8Array | string;
  contentType?: string;
}

export interface SkillsS3StoredObject {
  key: string;
  url: string;
  etag?: string | null;
  sizeBytes: number;
}

export type SkillsFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class SkillsS3ObjectStore {
  private readonly fetchImpl: SkillsFetch;
  private readonly region: string;
  private readonly prefix: string;

  constructor(private readonly options: SkillsS3ObjectStoreOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.region = options.region ?? "us-east-1";
    this.prefix = normalizeS3Prefix(options.prefix);
  }

  objectKey(path: string): string {
    const cleaned = toPosix(path).replace(/^\.?\//, "").replace(/^\/+/, "");
    return [this.prefix, cleaned].filter(Boolean).join("/");
  }

  objectUrl(key: string): string {
    return buildSkillsS3ObjectUrl({
      bucket: this.options.bucket,
      key,
      region: this.region,
      endpoint: this.options.endpoint,
      forcePathStyle: this.options.forcePathStyle,
    });
  }

  async putObject(params: SkillsS3PutObjectOptions): Promise<SkillsS3StoredObject> {
    const key = this.objectKey(params.key);
    const body = typeof params.body === "string" ? new TextEncoder().encode(params.body) : params.body;
    const url = this.objectUrl(key);
    const headers: Record<string, string> = {
      "content-type": params.contentType ?? "application/octet-stream",
      "x-amz-content-sha256": sha256Hex(body),
    };
    const signed = signSkillsAwsV4Request({
      method: "PUT",
      url,
      region: this.region,
      service: "s3",
      headers,
      body,
      credentials: this.options.credentials,
    });
    const response = await this.fetchImpl(url, {
      method: "PUT",
      headers: signed.headers,
      body: toArrayBuffer(body),
    });
    if (!response.ok) {
      throw new Error(`S3 put failed for ${key}: ${response.status} ${response.statusText}`.trim());
    }
    return {
      key,
      url,
      etag: response.headers.get("etag"),
      sizeBytes: body.byteLength,
    };
  }

  async getObject(key: string): Promise<Uint8Array> {
    const objectKey = this.objectKey(key);
    const url = this.objectUrl(objectKey);
    const signed = signSkillsAwsV4Request({
      method: "GET",
      url,
      region: this.region,
      service: "s3",
      headers: { "x-amz-content-sha256": sha256Hex(new Uint8Array()) },
      credentials: this.options.credentials,
    });
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: signed.headers,
    });
    if (!response.ok) {
      throw new Error(`S3 get failed for ${objectKey}: ${response.status} ${response.statusText}`.trim());
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}

export function createSkillsS3ObjectStore(options: SkillsS3ObjectStoreOptions): SkillsS3ObjectStore {
  return new SkillsS3ObjectStore(options);
}

export interface SkillsS3SnapshotPlanEntry {
  path: string;
  key: string;
  sizeBytes: number;
  sha256: string;
}

export function planSkillsS3SnapshotUpload(
  snapshot: SkillsLocalSnapshot,
  options: { prefix?: string } = {},
): SkillsS3SnapshotPlanEntry[] {
  const prefix = normalizeS3Prefix(options.prefix);
  return snapshot.files.map((file) => ({
    path: file.path,
    key: [prefix, file.path.replace(/^\.?\//, "")].filter(Boolean).join("/"),
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
  }));
}

export async function uploadSkillsSnapshotFilesToS3(
  snapshot: SkillsLocalSnapshot,
  store: SkillsS3ObjectStore,
): Promise<SkillsS3StoredObject[]> {
  const uploaded: SkillsS3StoredObject[] = [];
  for (const file of snapshot.files) {
    if (!file.contentBase64) continue;
    uploaded.push(await store.putObject({
      key: file.path,
      body: Buffer.from(file.contentBase64, "base64"),
      contentType: contentTypeForPath(file.path),
    }));
  }
  return uploaded;
}

export interface SignSkillsAwsV4RequestOptions {
  method: string;
  url: string;
  region: string;
  service: string;
  headers?: Record<string, string>;
  body?: Uint8Array | string;
  credentials: AwsCredentials;
  now?: Date;
}

export function signSkillsAwsV4Request(options: SignSkillsAwsV4RequestOptions): {
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
} {
  const now = options.now ?? new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const url = new URL(options.url);
  const bodyBytes = typeof options.body === "string"
    ? new TextEncoder().encode(options.body)
    : options.body ?? new Uint8Array();
  const payloadHash = sha256Hex(bodyBytes);
  const headers = normalizeHeaders({
    ...(options.headers ?? {}),
    host: url.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": options.headers?.["x-amz-content-sha256"] ?? payloadHash,
    ...(options.credentials.sessionToken ? { "x-amz-security-token": options.credentials.sessionToken } : {}),
  });
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
  const canonicalQuery = canonicalizeQuery(url.searchParams);
  const canonicalRequest = [
    options.method.toUpperCase(),
    encodeUriPath(url.pathname),
    canonicalQuery,
    canonicalHeaders,
    signedHeaderNames.join(";"),
    headers["x-amz-content-sha256"],
  ].join("\n");
  const credentialScope = `${dateStamp}/${options.region}/${options.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = getAwsSigningKey(options.credentials.secretAccessKey, dateStamp, options.region, options.service);
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  headers.authorization = [
    `AWS4-HMAC-SHA256 Credential=${options.credentials.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaderNames.join(";")}`,
    `Signature=${signature}`,
  ].join(", ");
  return { headers, canonicalRequest, stringToSign };
}

export function buildSkillsS3ObjectUrl(params: {
  bucket: string;
  key: string;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}): string {
  const region = params.region ?? "us-east-1";
  const key = params.key.split("/").map(encodeURIComponent).join("/");
  if (params.endpoint) {
    const endpoint = params.endpoint.replace(/\/+$/, "");
    return params.forcePathStyle
      ? `${endpoint}/${encodeURIComponent(params.bucket)}/${key}`
      : `${endpoint}/${key}`;
  }
  return params.forcePathStyle
    ? `https://s3.${region}.amazonaws.com/${encodeURIComponent(params.bucket)}/${key}`
    : `https://${params.bucket}.s3.${region}.amazonaws.com/${key}`;
}

function readStorageEnv(
  env: Record<string, string | undefined>,
  key: keyof typeof SKILLS_NATIVE_STORAGE_ENV,
): { name: string; value?: string } {
  const primaryName = SKILLS_NATIVE_STORAGE_ENV[key];
  const primaryValue = cleanOptional(env[primaryName]);
  if (primaryValue !== undefined) return { name: primaryName, value: primaryValue };

  const fallbackName = SKILLS_NATIVE_STORAGE_FALLBACK_ENV[key];
  const fallbackValue = cleanOptional(env[fallbackName]);
  if (fallbackValue !== undefined) return { name: fallbackName, value: fallbackValue };

  return { name: primaryName };
}

function cleanOptional(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function walkFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) files.push(...walkFiles(full));
    else files.push(full);
  }
  return files;
}

function resolveSnapshotPath(targetDir: string, snapshotPath: string): string {
  const normalizedPath = normalize(snapshotPath);
  if (normalizedPath.startsWith("..") || normalizedPath.includes(`${sep}..${sep}`) || normalizedPath.startsWith(sep)) {
    throw new Error(`Unsafe snapshot path: ${snapshotPath}`);
  }
  if (!toPosix(normalizedPath).startsWith(".skills/")) {
    throw new Error(`Snapshot path must stay inside .skills: ${snapshotPath}`);
  }
  return join(targetDir, normalizedPath);
}

function normalizeS3Prefix(prefix: string | undefined): string {
  return (prefix ?? "").trim().replace(/^\/+|\/+$/g, "");
}

function toPosix(path: string): string {
  return path.split(/[\\/]+/).join("/");
}

function toIsoString(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key.toLowerCase()] = String(value).trim().replace(/\s+/g, " ");
  }
  return result;
}

function canonicalizeQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function encodeUriPath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)).replace(/[!'()*]/g, (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase()}`
    ))
    .join("/");
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function getAwsSigningKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = createHmac("sha256", `AWS4${secret}`).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update(region).digest();
  const kService = createHmac("sha256", kRegion).update(service).digest();
  return createHmac("sha256", kService).update("aws4_request").digest();
}

function contentTypeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".log") || lower.endsWith(".txt") || lower.endsWith(".ndjson")) return "text/plain";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
