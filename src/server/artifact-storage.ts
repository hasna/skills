import { GetObjectCommand, PutObjectCommand, S3Client as AwsS3Client } from "@aws-sdk/client-s3";
import type { ServerArtifact, ServerRunRecord } from "./types.js";

export interface ArtifactBody {
  relativePath: string;
  bodyText: string;
  contentType: string;
}

export interface ArtifactStorageOptions {
  bucket?: string;
  prefix?: string;
  region?: string;
}

export class ArtifactStorage {
  private bucket?: string;
  private prefix: string;
  private s3?: AwsS3Client;

  constructor(options: ArtifactStorageOptions = {}) {
    this.bucket = options.bucket;
    this.prefix = (options.prefix || "skills/artifacts").replace(/^\/+|\/+$/g, "");
    this.s3 = this.bucket ? new AwsS3Client({ region: options.region || process.env.AWS_REGION || "us-east-1" }) : undefined;
  }

  get usesS3(): boolean {
    return Boolean(this.bucket);
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

    const key = this.keyFor(run, body.relativePath);
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

  private keyFor(run: ServerRunRecord, relativePath: string): string {
    const safeRelativePath = relativePath.replace(/^\/+/, "").replace(/\.\.(?:\/|$)/g, "");
    return `${this.prefix}/${run.orgId}/${run.id}/${safeRelativePath}`;
  }
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

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}
