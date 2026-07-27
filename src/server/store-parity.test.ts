/**
 * Behaviours that must be identical on every backend, asserted against each of them.
 *
 * These are the divergences an adversarial review actually found between the SQLite and
 * Postgres implementations - not hypotheticals. Each one is written as a single
 * expectation run per backend, so "SQLite behaves like Postgres" is a property the suite
 * checks rather than a claim the module header makes.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { ownBytes, type OwnedBytes } from "../lib/skill-bundle.js";
import { publicPrincipal } from "./auth.js";
import { resolveStoreBackends } from "./store-fixtures.js";
import type { ApiPrincipal, SkillsProductStore } from "./types.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const ORG: Partial<ApiPrincipal> = { orgId: "org_a", orgSlug: "org-a", orgName: "Org A", userId: "user_a", email: "a@example.com", apiKeyId: "key_a" };
const OTHER_ORG: Partial<ApiPrincipal> = { orgId: "org_b", orgSlug: "org-b", orgName: "Org B", userId: "user_b", email: "b@example.com", apiKeyId: "key_b" };
const backends = await resolveStoreBackends();

async function seeded(backend: (typeof backends)[number]) {
  const fixture = await backend.create([
    { token: "sk_parity", principal: ORG },
    { token: "sk_parity_other", principal: OTHER_ORG },
  ]);
  return { ...fixture, principal: publicPrincipal(ORG), otherPrincipal: publicPrincipal(OTHER_ORG) };
}

/** Distinguishable bytes, so "read its own" and "read the other org's" are different answers. */
function bundleBytes(marker: string): OwnedBytes {
  return ownBytes(new TextEncoder().encode(`bundle:${marker}:${"x".repeat(64)}`));
}

function digestOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function publishInput(principal: ApiPrincipal, slug: string, marker: string, bytes?: OwnedBytes) {
  return {
    principal,
    slug,
    displayName: `${marker} display`,
    description: `${marker} description`,
    category: "Development Tools",
    tags: [marker],
    source: "custom",
    kind: "executable" as const,
    version: "1.0.0",
    skillMd: `# ${marker}\n`,
    ...(bytes
      ? { bundle: { sha256: digestOf(bytes), byteSize: bytes.byteLength, contentType: "application/gzip", storageKind: "db" as const, bytes } }
      : {}),
  };
}

async function newRun(store: SkillsProductStore, principal: ApiPrincipal) {
  return store.createRun({ principal, slug: "audio-transcript-pack", input: {}, args: [] });
}

for (const backend of backends) {
  describe(`store parity (${backend.name})`, () => {
    test("concurrent appendLog calls all succeed with distinct sequences", async () => {
      const fixture = await seeded(backend);
      try {
        const run = await newRun(fixture.store, fixture.principal);
        // Postgres previously lost this race: SELECT MAX+1 then INSERT, with an await
        // between, gave 1 success and 4 `duplicate key value violates unique constraint`
        // - and executeRun's catch turns a logging failure into a failed run. Folding
        // MAX into the INSERT was not enough either, because READ COMMITTED hands every
        // concurrent statement the same snapshot.
        const results = await Promise.allSettled(
          Array.from({ length: 5 }, (_, i) => fixture.store.appendLog(run.id, fixture.principal.orgId, "info", `message ${i}`)),
        );
        expect(results.filter((r) => r.status === "rejected")).toEqual([]);

        const sequences = (await fixture.store.listLogs(fixture.principal, run.id)).map((log) => log.sequence).sort((a, b) => a - b);
        expect(sequences).toEqual([1, 2, 3, 4, 5]);
      } finally {
        await fixture.close();
      }
    }, 30_000);

    test("listRuns treats a nonsensical limit the same way everywhere", async () => {
      const fixture = await seeded(backend);
      try {
        for (let i = 0; i < 3; i += 1) await newRun(fixture.store, fixture.principal);

        expect(await fixture.store.listRuns(fixture.principal, 2)).toHaveLength(2);
        expect(await fixture.store.listRuns(fixture.principal, 0)).toHaveLength(0);
        // SQLite reads LIMIT -1 as *unlimited*, so an unnormalised negative limit
        // returned the org's entire history from the one argument whose job is to bound
        // the response, while Postgres threw. Neither is acceptable; both now clamp.
        expect(await fixture.store.listRuns(fixture.principal, -1)).toHaveLength(0);
        expect(await fixture.store.listRuns(fixture.principal, 1.5)).toHaveLength(1);
        expect(await fixture.store.listRuns(fixture.principal, Number.NaN)).toHaveLength(0);
      } finally {
        await fixture.close();
      }
    });

    test("updateRun on an unknown id returns null rather than throwing", async () => {
      const fixture = await seeded(backend);
      try {
        expect(await fixture.store.updateRun("run_does_not_exist", { status: "failed" })).toBeNull();
      } finally {
        await fixture.close();
      }
    });

    test("claiming drains the queue exactly once and then reports empty", async () => {
      const fixture = await seeded(backend);
      try {
        const runs = [await newRun(fixture.store, fixture.principal), await newRun(fixture.store, fixture.principal)];
        const claimed = [
          await fixture.store.claimNextRun({ workerId: "w1" }),
          await fixture.store.claimNextRun({ workerId: "w2" }),
        ];
        expect(claimed.map((run) => run?.id).sort()).toEqual(runs.map((run) => run.id).sort());
        expect(claimed.every((run) => run?.status === "running")).toBe(true);
        expect(await fixture.store.claimNextRun({ workerId: "w3" })).toBeNull();
      } finally {
        await fixture.close();
      }
    });

    test("authentication is repeatable and does not depend on a per-request write landing", async () => {
      const fixture = await seeded(backend);
      try {
        const { hashApiKey } = await import("./auth.js");
        const hash = hashApiKey("sk_parity");
        // SQLite now refreshes last_used_at at most once a minute rather than on every
        // call, because that write is synchronous and blocked the whole event loop.
        // Repeated authentication must still return the identical principal.
        const first = await fixture.store.authenticateApiKeyHash(hash);
        const second = await fixture.store.authenticateApiKeyHash(hash);
        expect(second).toEqual(first);
        expect(first).toMatchObject({ orgId: "org_a", scopes: ["skills:read", "runs:write"] });
      } finally {
        await fixture.close();
      }
    });

    test("published skills and their bundles are scoped to the publishing org", async () => {
      const fixture = await seeded(backend);
      try {
        const alpha = bundleBytes("alpha");
        const beta = bundleBytes("beta");
        expect(digestOf(alpha)).not.toBe(digestOf(beta));

        await fixture.store.publishSkill(publishInput(fixture.principal, "shared-slug", "alpha", alpha));
        await fixture.store.publishSkill(publishInput(fixture.otherPrincipal, "shared-slug", "beta", beta));

        // The same slug in two orgs is two rows, not one overwritten row. This is what
        // the composite (org_id, slug) primary key buys, and the reason 0002 had to
        // rebuild the table rather than add a column.
        const mine = await fixture.store.getSkill(fixture.principal, "shared-slug");
        const theirs = await fixture.store.getSkill(fixture.otherPrincipal, "shared-slug");
        expect(mine).toMatchObject({ orgId: "org_a", description: "alpha description" });
        expect(theirs).toMatchObject({ orgId: "org_b", description: "beta description" });

        expect((await fixture.store.listSkills(fixture.principal)).map((s) => s.description)).toEqual(["alpha description"]);
        expect((await fixture.store.listSkills(fixture.otherPrincipal)).map((s) => s.description)).toEqual(["beta description"]);

        // A digest is not a capability: knowing org A's digest must not fetch its bytes.
        expect(await fixture.store.getSkillBundle(fixture.otherPrincipal, digestOf(alpha))).toBeNull();
        expect(await fixture.store.getSkillBundle(fixture.principal, digestOf(beta))).toBeNull();

        const ownBundle = await fixture.store.getSkillBundle(fixture.principal, digestOf(alpha));
        expect(ownBundle).toBeTruthy();
        expect(Array.from(ownBundle!.bytes!)).toEqual(Array.from(alpha));
      } finally {
        await fixture.close();
      }
    });

    test("a cross-org delete or update reports not-found and changes nothing", async () => {
      const fixture = await seeded(backend);
      try {
        const alpha = bundleBytes("alpha");
        await fixture.store.publishSkill(publishInput(fixture.principal, "only-mine", "alpha", alpha));

        expect(await fixture.store.deleteSkill(fixture.otherPrincipal, "only-mine")).toBe(false);
        expect(await fixture.store.updateSkill(fixture.otherPrincipal, "only-mine", { description: "hijacked" })).toBeNull();

        expect(await fixture.store.getSkill(fixture.principal, "only-mine")).toMatchObject({ description: "alpha description" });
        expect(await fixture.store.getSkillBundle(fixture.principal, digestOf(alpha))).toBeTruthy();

        // The owning org can, which is what makes the two refusals above mean something.
        expect(await fixture.store.deleteSkill(fixture.principal, "only-mine")).toBe(true);
        expect(await fixture.store.getSkill(fixture.principal, "only-mine")).toBeNull();
      } finally {
        await fixture.close();
      }
    });

    test("republishing replaces the bundle and collects the one nothing references", async () => {
      const fixture = await seeded(backend);
      try {
        const first = bundleBytes("first");
        const second = bundleBytes("second");
        await fixture.store.publishSkill(publishInput(fixture.principal, "evolving", "first", first));
        expect(await fixture.store.getSkillBundle(fixture.principal, digestOf(first))).toBeTruthy();

        await fixture.store.publishSkill(publishInput(fixture.principal, "evolving", "second", second));
        expect(await fixture.store.getSkill(fixture.principal, "evolving")).toMatchObject({ bundleSha256: digestOf(second) });
        expect(await fixture.store.getSkillBundle(fixture.principal, digestOf(second))).toBeTruthy();
        // The superseded blob is gone rather than accumulating on every push.
        expect(await fixture.store.getSkillBundle(fixture.principal, digestOf(first))).toBeNull();

        // Publishing is an upsert: one row, not two.
        expect(await fixture.store.listSkills(fixture.principal)).toHaveLength(1);
      } finally {
        await fixture.close();
      }
    });

    test("a bundle shared by two skills survives deleting one of them", async () => {
      const fixture = await seeded(backend);
      try {
        const shared = bundleBytes("shared");
        await fixture.store.publishSkill(publishInput(fixture.principal, "skill-one", "shared", shared));
        await fixture.store.publishSkill(publishInput(fixture.principal, "skill-two", "shared", shared));

        expect(await fixture.store.deleteSkill(fixture.principal, "skill-one")).toBe(true);
        // Content addressing means one blob backs both rows; collecting it here would
        // silently empty a skill that was never touched.
        expect(await fixture.store.getSkillBundle(fixture.principal, digestOf(shared))).toBeTruthy();

        expect(await fixture.store.deleteSkill(fixture.principal, "skill-two")).toBe(true);
        expect(await fixture.store.getSkillBundle(fixture.principal, digestOf(shared))).toBeNull();
      } finally {
        await fixture.close();
      }
    });

    test("a metadata-only publish and update leave optional fields well-defined", async () => {
      const fixture = await seeded(backend);
      try {
        await fixture.store.publishSkill(publishInput(fixture.principal, "prose-only", "prose"));
        const record = await fixture.store.getSkill(fixture.principal, "prose-only");
        expect(record).toMatchObject({ slug: "prose-only", version: "1.0.0" });
        expect(record!.bundleSha256).toBeUndefined();
        expect(record!.bundleByteSize).toBeUndefined();
        expect(record!.publishedByUserId).toBe("user_a");

        const updated = await fixture.store.updateSkill(fixture.principal, "prose-only", { description: "revised" });
        expect(updated).toMatchObject({ description: "revised", version: "1.0.0", displayName: "prose display" });
        expect(await fixture.store.updateSkill(fixture.principal, "never-existed", { description: "x" })).toBeNull();
      } finally {
        await fixture.close();
      }
    });
  });
}
