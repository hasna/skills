import type { ServerArtifact, ServerRunRecord } from "./types.js";

export interface ArtifactBody {
  relativePath: string;
  bodyText: string;
  contentType: string;
}

export interface ArtifactStorageOptions {
  bucket?: string;
  prefix?: string;
}

export class ArtifactStorage {
  private bucket?: string;
  private prefix: string;

  constructor(options: ArtifactStorageOptions = {}) {
    this.bucket = options.bucket;
    this.prefix = (options.prefix || "skills/artifacts").replace(/^\/+|\/+$/g, "");
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
    await Bun.s3.file(key, {
      bucket: this.bucket,
      type: body.contentType,
    }).write(body.bodyText);

    return {
      ...artifact,
      storageKind: "s3",
      storageKey: key,
    };
  }

  async readText(artifact: ServerArtifact): Promise<string | null> {
    if (artifact.storageKind === "db") return artifact.bodyText ?? null;
    if (!this.bucket || !artifact.storageKey) return null;
    return await Bun.s3.file(artifact.storageKey, {
      bucket: this.bucket,
      type: artifact.contentType,
    }).text();
  }

  private keyFor(run: ServerRunRecord, relativePath: string): string {
    const safeRelativePath = relativePath.replace(/^\/+/, "").replace(/\.\.(?:\/|$)/g, "");
    return `${this.prefix}/${run.orgId}/${run.id}/${safeRelativePath}`;
  }
}
