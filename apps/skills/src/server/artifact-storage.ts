import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client as AwsS3Client } from "@aws-sdk/client-s3";
import { ownBytes, type OwnedBytes } from "../lib/skill-bundle.js";
import type { BlobStorageKind, ServerArtifact, ServerRunRecord, ServerSkillBundle } from "./types.js";

/** Lowercase hex sha-256. Anything else must never reach a storage key. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface ArtifactBody {
  relativePath: string;
  bodyText: string;
  contentType: string;
}

/** The slice of the AWS client the storage uses; injectable so tests can stand in an in-memory bucket. */
export interface S3ClientLike {
  send(command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand): Promise<{ Body?: unknown }>;
}

export interface ArtifactStorageOptions {
  bucket?: string;
  prefix?: string;
  /** Separate expiring run outputs from durable bundle/version objects. Defaults to prefix for compatibility. */
  runPrefix?: string;
  region?: string;
  /** Overrides the real S3 client (tests). Ignored when no bucket is configured. */
  client?: S3ClientLike;
}

export class ArtifactStorage {
  private bucket?: string;
  private prefix: string;
  private runPrefix: string;
  private s3?: S3ClientLike;

  constructor(options: ArtifactStorageOptions = {}) {
    this.bucket = options.bucket;
    this.prefix = (options.prefix || "skills/artifacts").replace(/^\/+|\/+$/g, "");
    this.runPrefix = (options.runPrefix || this.prefix).replace(/^\/+|\/+$/g, "");
    this.s3 = this.bucket ? options.client ?? new AwsS3Client({ region: options.region || process.env.AWS_REGION || "us-east-1" }) : undefined;
  }

  get usesS3(): boolean {
    return Boolean(this.bucket);
  }

  /**
   * Object key for a run artifact: `<prefix>/<tenantId>/<runId>/<relativePath>`.
   * The tenant segment is structural, never optional - a bucket policy or a
   * lifecycle rule can key on it, and two tenants can never share a key even
   * when a run id were ever reused. `relativePath` is caller-supplied, so it is
   * sanitised: leading slashes and `..` segments are removed, and anything that
   * survives the sanitisation is what lands in the key.
   */
  objectKeyFor(tenantId: string, runId: string, relativePath: string): string {
    const safeRelativePath = relativePath.replace(/^\/+/, "").replace(/\.\.(?:\/|$)/g, "");
    return `${this.runPrefix}/${tenantId}/${runId}/${safeRelativePath}`;
  }

  /**
   * Object key for a quarantined partial artifact: a sibling namespace under the
   * same prefix, so one bucket policy covers both and the quarantine is visible
   * in the object listing without any metadata join. Deliberately keyed by
   * artifact id, not by the original relative path: the point of the move is
   * that the artifact's original location no longer resolves.
   */
  quarantineKeyFor(tenantId: string, runId: string, artifactId: string): string {
    return `${this.runPrefix}/quarantine/${tenantId}/${runId}/${artifactId}`;
  }

  async materialize(
    run: ServerRunRecord,
    artifact: Omit<ServerArtifact, "createdAt" | "storageKind" | "storageKey" | "bodyText">,
    body: ArtifactBody,
  ): Promise<Omit<ServerArtifact, "createdAt">> {
    if (!this.bucket) {
      return {
        ...artifact,
        storageKind: "db",
        bodyText: body.bodyText,
      };
    }

    const key = this.objectKeyFor(run.orgId, run.id, body.relativePath);
    await this.s3!.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body.bodyText,
      ContentType: body.contentType,
    }));

    return {
      ...artifact,
      storageKind: "s3",
      storageKey: key,
    };
  }

  async readText(artifact: ServerArtifact): Promise<string | null> {
    if (artifact.storageKind === "db") return artifact.bodyText ?? null;
    if (!this.bucket || !this.s3 || !artifact.storageKey) return null;
    const response = await this.s3.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: artifact.storageKey,
    }));
    return await bodyToText(response.Body);
  }

  /**
   * Place a skill bundle's bytes, returning where they went.
   *
   * Deliberately a second method on the same class rather than a second class: an
   * operator configures one bucket and one prefix, and a bundle that silently went
   * somewhere else than the run artifacts would be the kind of thing discovered during a
   * restore. The key is content-addressed - the digest is the whole name - so unlike
   * keyFor() there is no caller-supplied path component to sanitise, only a digest to
   * refuse if it is not one.
   *
   * Binary throughout. `materialize()` above takes `bodyText: string` because a run
   * artifact is a document; a skill bundle is a gzipped tar and there is no point in the
   * pipeline where turning it into a string would be lossless.
   */
  async putBundle(
    orgId: string,
    sha256: string,
    bytes: OwnedBytes,
    contentType = "application/gzip",
  ): Promise<{ storageKind: BlobStorageKind; storageKey?: string; bytes?: OwnedBytes }> {
    assertSha256(sha256);
    if (!this.bucket) return { storageKind: "db", bytes };
    const key = this.bundleKeyFor(orgId, sha256);
    await this.s3!.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }));
    return { storageKind: "s3", storageKey: key };
  }

  /**
   * Read a bundle back.
   *
   * Returns null when the bytes cannot be produced - an S3-backed row on a server with no
   * bucket configured, or a row whose blob column is empty. Null is distinguishable from
   * an empty bundle by the caller, which knows the recorded byteSize.
   */
  async readBundle(bundle: ServerSkillBundle): Promise<OwnedBytes | null> {
    if (bundle.storageKind === "db") return bundle.bytes ?? null;
    if (!this.bucket || !this.s3 || !bundle.storageKey) return null;
    const response = await this.s3.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: bundle.storageKey,
    }));
    return await bodyToBytes(response.Body);
  }

  /**
   * Remove a bundle's object, if it had one.
   *
   * The store collects the *row* when nothing references a digest any more, but a row is
   * only half of an S3-backed bundle. Without this the object stayed in the bucket after
   * the user deleted the skill - unreachable, because the key lived in the row that is
   * now gone, and therefore also uncollectable. That is a retention problem, not a leak
   * you can clean up later.
   *
   * A no-op when nothing is configured, which is why the caller can invoke it
   * unconditionally.
   */
  async deleteBundle(orgId: string, sha256: string): Promise<void> {
    if (!this.bucket || !this.s3) return;
    assertSha256(sha256);
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.bundleKeyFor(orgId, sha256) }));
  }

  /**
   * Remove an artifact object, if it had one.
   *
   * The counterpart of deleteBundle for run artifacts: the row deletion is the
   * governance store's job, but an S3-backed artifact is only gone when the
   * object is gone. A no-op when nothing is configured, which is why the caller
   * can invoke it unconditionally.
   */
  async deleteObject(artifact: ServerArtifact): Promise<void> {
    if (!this.bucket || !this.s3) return;
    if (!artifact.storageKey) return;
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: artifact.storageKey }));
  }

  /**
   * Move an artifact's object into the quarantine namespace.
   *
   * Cancellation quarantines partial artifacts before the run is marked
   * cancelled, so a cancelled run's half-written outputs are neither served
   * nor silently deleted: they sit under `.../quarantine/<tenant>/<run>/<id>`
   * and are recorded in a quarantine receipt.
   *
   * Returns the new key, or null for a database-backed artifact (its body has
   * no object to move; the row is marked by the receipt alone). A no-op for
   * an artifact that has no storage key at all.
   */
  async moveToQuarantine(artifact: ServerArtifact): Promise<string | null> {
    if (!this.bucket || !this.s3 || !artifact.storageKey) return null;
    const quarantineKey = this.quarantineKeyFor(artifact.orgId, artifact.runId, artifact.id);
    const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: artifact.storageKey }));
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: quarantineKey,
      Body: await bodyToBytes(response.Body),
      ContentType: artifact.contentType,
    }));
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: artifact.storageKey }));
    return quarantineKey;
  }

  private keyFor(run: ServerRunRecord, relativePath: string): string {
    return this.objectKeyFor(run.orgId, run.id, relativePath);
  }

  /**
   * Version-addressed copy of a published bundle plus its manifest (hasna/apps#1630):
   *   <prefix>/skills/<org>/<slug>/<version>/bundle.tar.gz
   *   <prefix>/skills/<org>/<slug>/<version>/manifest.json
   * The content-addressed object under bundles/ stays the read path (dedupe); these keys
   * are the durable, browsable history and are never deleted by orphan collection.
   *
   * RETENTION: neither version history nor content-addressed bundles may share an
   * expiring lifecycle prefix with run outputs. Configure runPrefix separately for
   * ephemeral artifacts; retain this prefix until reference-aware maintenance removes
   * the version rows and objects together. Existing persisted storage keys remain valid.
   * Returns the placement recorded on the version row; in db mode nothing is written.
   */
  async putVersionObjects(
    orgId: string,
    slug: string,
    version: string,
    bytes: OwnedBytes,
    manifest: Record<string, unknown>,
    contentType = "application/gzip",
  ): Promise<{ storageKind: BlobStorageKind; storageKey?: string }> {
    if (!this.bucket || !this.s3) return { storageKind: "db" };
    const key = this.versionKeyFor(orgId, slug, version, "bundle.tar.gz");
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }));
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.versionKeyFor(orgId, slug, version, "manifest.json"),
      Body: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
      ContentType: "application/json",
    }));
    return { storageKind: "s3", storageKey: key };
  }

  /** Where putVersionObjects WOULD place a version, without writing: recorded on the row before the objects exist. */
  versionPlacement(orgId: string, slug: string, version: string): { storageKind: BlobStorageKind; storageKey?: string } {
    if (!this.bucket || !this.s3) return { storageKind: "db" };
    return { storageKind: "s3", storageKey: this.versionKeyFor(orgId, slug, version, "bundle.tar.gz") };
  }

  versionKeyFor(orgId: string, slug: string, version: string, file: string): string {
    return `${this.prefix}/skills/${encodeURIComponent(orgId)}/${encodeURIComponent(slug)}/${encodeURIComponent(version)}/${file}`;
  }

  private bundleKeyFor(orgId: string, sha256: string): string {
    // Immutable bundle storage keeps its original prefix independently of expiring runs.
    return `${this.prefix}/bundles/${encodeURIComponent(orgId)}/${sha256}.tar.gz`;
  }
}

function assertSha256(value: string): void {
  if (!SHA256_HEX.test(value)) {
    throw new Error("bundle digest must be a lowercase hex sha-256; refusing to build a storage key from it");
  }
}

async function bodyToBytes(body: unknown): Promise<OwnedBytes> {
  if (!body) return ownBytes(new Uint8Array(0));
  if (body instanceof Uint8Array) return ownBytes(body);
  if (typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function") {
    return ownBytes(await (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
  }
  if (typeof (body as ReadableStream<Uint8Array>).getReader === "function") {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return concat(chunks);
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  }
  return concat(chunks);
}

async function bodyToText(body: unknown): Promise<string> {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (typeof (body as { transformToString?: unknown }).transformToString === "function") {
    return await (body as { transformToString(): Promise<string> }).transformToString();
  }
  if (typeof (body as ReadableStream<Uint8Array>).getReader === "function") {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return new TextDecoder().decode(concat(chunks));
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  }
  return new TextDecoder().decode(concat(chunks));
}

function concat(chunks: Uint8Array[]): OwnedBytes {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}
