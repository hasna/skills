/**
 * Behaviours that must be identical on every backend, asserted against each of them.
 *
 * These are the divergences an adversarial review actually found between the SQLite and
 * Postgres implementations - not hypotheticals. Each one is written as a single
 * expectation run per backend, so "SQLite behaves like Postgres" is a property the suite
 * checks rather than a claim the module header makes.
 */
import { describe, expect, test } from "bun:test";
import { publicPrincipal } from "./auth.js";
import { resolveStoreBackends } from "./store-fixtures.js";
import type { ApiPrincipal, SkillsProductStore } from "./types.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const ORG: Partial<ApiPrincipal> = { orgId: "org_a", orgSlug: "org-a", orgName: "Org A", userId: "user_a", email: "a@example.com", apiKeyId: "key_a" };
const backends = await resolveStoreBackends();

async function seeded(backend: (typeof backends)[number]) {
  const fixture = await backend.create([{ token: "sk_parity", principal: ORG }]);
  return { ...fixture, principal: publicPrincipal(ORG) };
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
  });
}
