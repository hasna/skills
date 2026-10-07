import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { MemorySkillsStore, PostgresSkillsStore } from "./store.js";
import { SqliteSkillsStore, applySqliteMigrations } from "./sqlite-store.js";
import { runMigrations } from "./migrate.js";
import { publicPrincipal } from "./auth.js";
import type { SkillsProductStore } from "./types.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const migrations = resolve(import.meta.dir, "../../migrations");
const url = process.env.HASNA_SKILLS_EPOCH_TEST_DATABASE_URL;
for (const backend of ["memory", "sqlite", "postgres"] as const) test.skipIf(backend === "postgres" && !url)(`${backend} lifecycle epochs preserve upgrades and fence all lifecycle breaks`, async () => {
  const root = mkdtempSync(join(tmpdir(), "skills-epoch-store-")); roots.push(root);
  let store: SkillsProductStore;
  if (backend === "postgres") {
    const target = new URL(url!);
    expect(target.hostname).toBe("127.0.0.1"); expect(target.pathname).toBe("/skills_epoch_fixture"); expect(target.username).toBe("fixture");
    const oldMigrations = join(root, "old-migrations"); mkdirSync(oldMigrations);
    for (const name of readdirSync(join(migrations, "postgres")).filter(name => name.endsWith(".sql") && name < "0011")) writeFileSync(join(oldMigrations, name), readFileSync(join(migrations, "postgres", name)));
    await runMigrations(url!, oldMigrations);
    const seed = new PostgresSkillsStore(url!, { max: 1 });
    const seedPrincipal = publicPrincipal({ orgId: "baseline-org", orgSlug: "baseline", userId: "baseline-user", email: "baseline@example.com", apiKeyId: "baseline-key" });
    await seed.ensureBootstrapApiKey(randomUUID(), seedPrincipal);
    const before = [];
    for (const slug of ["baseline-one", "baseline-two"]) before.push(await seed.publishSkill({ principal: seedPrincipal, slug, displayName: "Baseline", description: "Preserved", category: "test", tags: [], source: "custom", kind: "instruction", version: "1.0.0" }));
    expect(await runMigrations(url!)).toMatchObject({ applied: ["0011_skill_authorization_epoch"] });
    const after = await Promise.all(before.map(row => seed.getSkill(seedPrincipal, row.slug)));
    expect(after.map(row => { const { authorizationEpoch, ...rest } = row!; return rest; })).toEqual(before);
    expect(after[0]!.authorizationEpoch).toMatch(/^[a-f0-9]{32}$/); expect(after[1]!.authorizationEpoch).not.toBe(after[0]!.authorizationEpoch);
    expect(await runMigrations(url!)).toMatchObject({ applied: [] });
    expect(await seed.getSkill(seedPrincipal, before[0]!.slug)).toEqual(after[0]);
    await seed.close();
    store = new PostgresSkillsStore(url!, { max: 1 });
  } else store = backend === "memory" ? new MemorySkillsStore() : new SqliteSkillsStore(join(root, "fixture.sqlite"));
  const principal = publicPrincipal({ orgId: `epoch-${backend}`, orgSlug: "fixture", userId: "fixture", email: "fixture@example.com", apiKeyId: "fixture-key" });
  await store.ensureBootstrapApiKey?.(randomUUID(), principal);
  const input = { principal, slug: "renewal-fixture", displayName: "Fixture", description: "Synthetic", category: "test", tags: [], source: "custom", kind: "instruction" as const, version: "1.0.0" };
  try {
    const first = await store.publishSkill(input); const initial = first.authorizationEpoch;
    expect(initial).toMatch(/^[a-f0-9]{32}$/);
    const other = await store.publishSkill({ ...input, slug: "other-fixture" }); expect(other.authorizationEpoch).not.toBe(initial);
    await expect(store.publishSkill({ ...input, version: "2.0.0", expectedRevisionId: "wrong" })).rejects.toThrow();
    expect((await store.getSkill(principal, input.slug))!.authorizationEpoch).toBe(initial);
    const upgraded = await store.publishSkill({ ...input, version: "2.0.0", expectedRevisionId: first.revisionId });
    expect(upgraded.authorizationEpoch).toBe(initial);
    expect((await store.getPublishedSelectionStates(principal, [{ slug: input.slug, version: "1.0.0" }]))[0]!.current!.authorizationEpoch).toBe(initial);
    const deleted = (await store.deleteSkill(principal, input.slug, 60_000))!;
    expect(deleted.authorizationEpoch).toMatch(/^[a-f0-9]{32}$/); expect(deleted.authorizationEpoch).not.toBe(initial);
    expect((await store.deleteSkill(principal, input.slug, 60_000))!.authorizationEpoch).toBe(deleted.authorizationEpoch);
    const revived = await store.publishSkill({ ...input, version: "3.0.0" });
    expect(revived.authorizationEpoch).toBe(deleted.authorizationEpoch);
    const archived = (await store.setSkillLifecycle(principal, input.slug, { lifecycle: "archived" }, revived.revisionId))!;
    expect(archived.authorizationEpoch).not.toBe(revived.authorizationEpoch);
    const same = (await store.setSkillLifecycle(principal, input.slug, { lifecycle: "archived" }, archived.revisionId))!;
    expect(same.authorizationEpoch).toBe(archived.authorizationEpoch);
    const active = (await store.setSkillLifecycle(principal, input.slug, { lifecycle: "active" }, same.revisionId))!;
    expect(active.authorizationEpoch).not.toBe(archived.authorizationEpoch);
    await expect(store.setSkillLifecycle(principal, input.slug, { lifecycle: "archived" }, "wrong")).rejects.toThrow();
    expect((await store.getSkill(principal, input.slug))!.authorizationEpoch).toBe(active.authorizationEpoch);
    const purge = (await store.deleteSkill(principal, input.slug, 0))!;
    await store.purgeExpiredTombstones(principal);
    expect(await store.getSkill(principal, input.slug)).toBeNull();
    const recreated = await store.publishSkill({ ...input, version: "4.0.0" });
    expect(recreated.authorizationEpoch).not.toBe(purge.authorizationEpoch);
    expect(recreated.authorizationEpoch).not.toBe(initial);
  } finally { await store.close?.(); }
});

test("SQLite migration mints distinct current baselines without changing historical bytes, and is idempotent", () => {
  const root = mkdtempSync(join(tmpdir(), "skills-epoch-migrate-")); roots.push(root);
  const oldMigrations = join(root, "old-migrations"); mkdirSync(oldMigrations);
  for (const name of readdirSync(join(migrations, "sqlite")).filter(name => name.endsWith(".sql") && name < "0011")) writeFileSync(join(oldMigrations, name), readFileSync(join(migrations, "sqlite", name)));
  const db = new Database(join(root, "old.sqlite"));
  try {
    applySqliteMigrations(db, oldMigrations);
    const table = db.query("PRAGMA table_info(skills_registry)").all() as any[];
    const values: Record<string, unknown> = { org_id: "org", slug: "first", display_name: "Fixture", description: "Preserved", category: "test", source: "custom", kind: "instruction", tags_json: "[]", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", revision_id: "old", revision_number: 1, lifecycle: "active" };
    const names = table.filter(row => row.notnull && row.dflt_value === null).map(row => row.name);
    for (const slug of ["first", "second"]) { values.slug = slug; db.query(`INSERT INTO skills_registry (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`).run(...names.map(name => values[name] as any)); }
    const before = db.query("SELECT * FROM skills_registry ORDER BY slug").all() as any[];
    expect(applySqliteMigrations(db, join(migrations, "sqlite"))).toEqual(["0011_skill_authorization_epoch"]);
    const after = db.query("SELECT * FROM skills_registry ORDER BY slug").all() as any[];
    expect(after.map(({ authorization_epoch, ...row }) => row)).toEqual(before);
    expect(after[0].authorization_epoch).toMatch(/^[a-f0-9]{32}$/); expect(after[1].authorization_epoch).not.toBe(after[0].authorization_epoch);
    expect(applySqliteMigrations(db, join(migrations, "sqlite"))).toEqual([]);
    expect(db.query("SELECT * FROM skills_registry ORDER BY slug").all()).toEqual(after);
  } finally { db.close(); }
});
