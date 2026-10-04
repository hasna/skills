#!/usr/bin/env bun
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const consumer = process.argv[2];
assert(consumer && isAbsolute(consumer), "Pass the absolute installed-consumer directory");
const root = realpathSync(join(consumer, "node_modules/@hasna/skills"));
const entry = realpathSync(fileURLToPath(import.meta.resolve("@hasna/skills/storage", pathToFileURL(join(consumer, "package.json")).href)));
assert(entry.startsWith(root + sep), "Storage must resolve inside the selected installed package");
const storage = await import(pathToFileURL(entry).href);
assert.equal(storage.SKILLS_NATIVE_STORAGE_ENV.databaseUrl, "HASNA_SKILLS_DATABASE_URL");
assert.equal(storage.storageCapabilities.version, 1);
assert(Array.isArray(storage.storageCapabilities.values));
for (const name of storage.storageCapabilities.values) {
  assert(name in storage && storage[name] !== undefined, `Storage runtime export is missing: ${name}`);
}
// These calls inspect explicit synthetic values only: no store constructors,
// database connections, filesystem snapshots or provider requests are needed.
const config = storage.resolveSkillsNativeStorageConfig({ HASNA_SKILLS_SYNC_BATCH_SIZE: "7", HASNA_SKILLS_SYNC_DRY_RUN: "true" });
assert.equal(config.syncBatchSize, 7);
assert.equal(config.dryRun, true);
assert.equal(config.databaseUrl, undefined);
assert.equal(storage.buildSkillsS3ObjectUrl({ bucket: "fixture-bucket", key: "nested/file name.json",
  endpoint: "https://storage.example.test", forcePathStyle: true }),
"https://storage.example.test/fixture-bucket/nested/file%20name.json");
console.log("Installed storage runtime: export loading, declared members and pure config/URL checks passed.");
