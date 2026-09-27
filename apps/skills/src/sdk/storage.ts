/**
 * Storage + object-store seam.
 *
 * The relational half is the store interface (SkillsProductStore) and the shipped
 * backends: Postgres via a postgres:// URL, SQLite via a path or file URL (the
 * zero-config default), and the explicitly-named in-memory store. The object-store half
 * is where artifact and bundle bytes live: the database column or S3, selected by
 * ArtifactStorage's bucket option.
 */
import {
  ArtifactStorage,
  type ArtifactBody,
  type ArtifactStorageOptions,
} from "../server/artifact-storage.js";
import {
  resolveDatabaseTarget,
  type DatabaseTarget,
} from "../server/database-url.js";
import {
  SqliteSkillsStore,
  type SqliteStoreOptions,
} from "../server/sqlite-store.js";
import {
  MemorySkillsStore,
  PostgresSkillsStore,
  createStore,
  type StoreOptions,
} from "../server/store.js";
import type {
  BlobStorageKind,
  ServerArtifact,
  ServerRunRecord,
  ServerSkillBundle,
  SkillsProductStore,
  StoreBackendInfo,
} from "../server/types.js";

export type {
  ArtifactBody,
  ArtifactStorageOptions,
  BlobStorageKind,
  DatabaseTarget,
  ServerArtifact,
  ServerRunRecord,
  ServerSkillBundle,
  SkillsProductStore,
  SqliteStoreOptions,
  StoreBackendInfo,
  StoreOptions,
};

/** Object-store seam: where run artifacts and skill bundles live. */
export interface ObjectStore {
  readonly usesS3: boolean;
  materialize(
    run: ServerRunRecord,
    artifact: Omit<ServerArtifact, "createdAt" | "storageKind" | "storageKey" | "bodyText">,
    body: ArtifactBody,
  ): Promise<Omit<ServerArtifact, "createdAt">>;
  readText(artifact: ServerArtifact): Promise<string | null>;
  deleteBundle(orgId: string, sha256: string): Promise<void>;
}

/** Compile-time proof the shipped implementation satisfies the seam. */
export const artifactStorageSeam: new (options?: ArtifactStorageOptions) => ObjectStore = ArtifactStorage;

export {
  ArtifactStorage,
  MemorySkillsStore,
  PostgresSkillsStore,
  SqliteSkillsStore,
  createStore,
  resolveDatabaseTarget,
};
