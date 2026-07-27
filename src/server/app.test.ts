import { describe, expect, test } from "bun:test";
import { RemoteSkillsClient } from "../lib/remote-client.js";
import { createSkillsFetchHandler } from "./app.js";
import { resolveStoreBackends, storeBackendNotices, type StoreBackendFixture } from "./store-fixtures.js";
import { runWorkerOnce } from "./worker.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const SEED = [
  { token: "sk_test_org_a", principal: { orgId: "org_a", orgSlug: "org-a", orgName: "Org A", userId: "user_a", email: "a@example.com", apiKeyId: "key_a" } },
  { token: "sk_test_org_b", principal: { orgId: "org_b", orgSlug: "org-b", orgName: "Org B", userId: "user_b", email: "b@example.com", apiKeyId: "key_b" } },
];

// Resolved once, before any describe body runs, because Postgres availability can only
// be determined by connecting. Whatever is skipped says so on stdout - the point of
// parameterising is to be able to state which backends were actually covered.
const backends = await resolveStoreBackends();
for (const notice of storeBackendNotices()) console.log(`[store-backends] ${notice}`);
console.log(`[store-backends] running the server API suite against: ${backends.map((b) => b.name).join(", ")}`);

async function testServer(backend: StoreBackendFixture) {
  const fixture = await backend.create(SEED);
  const fetch = await createSkillsFetchHandler({
    store: fixture.store,
    config: { inlineWorker: false, allowEphemeralStore: fixture.allowEphemeralStore },
  });
  const server = Bun.serve({ port: 0, fetch });
  return {
    server,
    store: fixture.store,
    baseUrl: `http://127.0.0.1:${server.port}`,
    async stop() {
      server.stop(true);
      await fixture.close();
    },
  };
}

for (const backend of backends) {
  describe(`skills API (${backend.name})`, () => {
    test("serves unauthenticated health and requires auth for API routes", async () => {
      const ctx = await testServer(backend);
      try {
        const health = await fetch(`${ctx.baseUrl}/health`);
        expect(health.status).toBe(200);
        const healthBody = await health.json();
        expect(healthBody).toMatchObject({ ok: true, service: "open-skills" });
        // The server does not describe who is running it. One product, one
        // deployment story; /health reports liveness, not a deployment variant.
        expect(healthBody).not.toHaveProperty("mode");

        const denied = await fetch(`${ctx.baseUrl}/api/v1/skills`);
        expect(denied.status).toBe(401);
        expect(await denied.json()).toMatchObject({ code: "AUTH_REQUIRED" });
      } finally {
        await ctx.stop();
      }
    });

    test("lists skills, runs a deterministic worker path, and downloads authorized artifacts", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const skills = await client.listSkills();
        expect(Array.isArray(skills)).toBe(true);
        expect(skills.some((skill) => skill.name === "audio-transcript-pack")).toBe(true);

        const submitted = await client.submitRun("audio-transcript-pack", { transcript: "Hello world from self hosted skills." }, ["--title", "Demo"]);
        expect(submitted.status).toBe("queued");
        expect(submitted.id).toBeTruthy();

        expect(await runWorkerOnce(ctx.store, "worker_test")).toBe(true);
        const run = await client.getRun(submitted.id!);
        expect(run).toMatchObject({ status: "succeeded", skill: "audio-transcript-pack" });

        const logs = await client.getRunLogs(submitted.id!);
        expect(logs.map((log) => log.message).join("\n")).toContain("generated");

        const artifacts = await client.getRunArtifacts(submitted.id!);
        expect(artifacts.map((artifact) => artifact.relativePath)).toContain("transcript.md");
        const transcript = artifacts.find((artifact) => artifact.relativePath === "transcript.md");
        const downloaded = await client.downloadRunArtifact(submitted.id!, transcript.id);
        expect(downloaded.status).toBe(200);
        expect(await downloaded.text()).toContain("Hello world");
      } finally {
        await ctx.stop();
      }
    });

    test("enforces organization ownership on run and artifact routes", async () => {
      const ctx = await testServer(backend);
      try {
        const orgA = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const orgB = new RemoteSkillsClient("sk_test_org_b", ctx.baseUrl);
        const submitted = await orgA.submitRun("audio-transcript-pack", { text: "secret run text" }, []);
        expect(await runWorkerOnce(ctx.store, "worker_test")).toBe(true);

        const crossRun = await orgB.getRun(submitted.id!);
        expect(crossRun).toBeNull();

        const artifacts = await orgA.getRunArtifacts(submitted.id!);
        const denied = await orgB.downloadRunArtifact(submitted.id!, artifacts[0].id);
        expect(denied.status).toBe(404);

        // Ownership is enforced on every read, not only the two the original test
        // covered. Logs and the artifact list are the paths that would leak a run's
        // contents to the wrong tenant if the org predicate were dropped from a JOIN.
        expect(await orgB.getRunLogs(submitted.id!)).toEqual([]);
        const crossArtifacts = await fetch(`${ctx.baseUrl}/api/v1/runs/${submitted.id}/artifacts`, {
          headers: { authorization: "Bearer sk_test_org_b" },
        });
        expect(crossArtifacts.status).toBe(404);
        expect(await crossArtifacts.json()).toMatchObject({ code: "RUN_NOT_FOUND" });
        expect((await orgB.listRuns()).map((run: { id: string }) => run.id)).not.toContain(submitted.id);
      } finally {
        await ctx.stop();
      }
    });
  });
}
