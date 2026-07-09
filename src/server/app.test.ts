import { describe, expect, test } from "bun:test";
import { RemoteSkillsClient } from "../lib/remote-client.js";
import { createSkillsFetchHandler } from "./app.js";
import { MemorySkillsStore } from "./store.js";
import { runWorkerOnce } from "./worker.js";

async function testServer() {
  const store = new MemorySkillsStore([
    { token: "sk_test_org_a", principal: { orgId: "org_a", orgSlug: "org-a", userId: "user_a", email: "a@example.com", apiKeyId: "key_a" } },
    { token: "sk_test_org_b", principal: { orgId: "org_b", orgSlug: "org-b", userId: "user_b", email: "b@example.com", apiKeyId: "key_b" } },
  ]);
  const fetch = await createSkillsFetchHandler({ store, config: { inlineWorker: false } });
  const server = Bun.serve({ port: 0, fetch });
  return { server, store, baseUrl: `http://127.0.0.1:${server.port}` };
}

describe("self-hosted skills API", () => {
  test("serves unauthenticated health and requires auth for API routes", async () => {
    const { server, baseUrl } = await testServer();
    try {
      const health = await fetch(`${baseUrl}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ ok: true, mode: "self-hosted" });

      const denied = await fetch(`${baseUrl}/api/v1/skills`);
      expect(denied.status).toBe(401);
      expect(await denied.json()).toMatchObject({ code: "AUTH_REQUIRED" });
    } finally {
      server.stop(true);
    }
  });

  test("lists skills, runs a deterministic worker path, and downloads authorized artifacts", async () => {
    const { server, store, baseUrl } = await testServer();
    try {
      const client = new RemoteSkillsClient("sk_test_org_a", baseUrl);
      const skills = await client.listSkills();
      expect(Array.isArray(skills)).toBe(true);
      expect(skills.some((skill) => skill.name === "audio-transcript-pack")).toBe(true);

      const submitted = await client.submitRun("audio-transcript-pack", { transcript: "Hello world from self hosted skills." }, ["--title", "Demo"]);
      expect(submitted.status).toBe("queued");
      expect(submitted.id).toBeTruthy();

      expect(await runWorkerOnce(store, "worker_test")).toBe(true);
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
      server.stop(true);
    }
  });

  test("enforces organization ownership on run and artifact routes", async () => {
    const { server, store, baseUrl } = await testServer();
    try {
      const orgA = new RemoteSkillsClient("sk_test_org_a", baseUrl);
      const orgB = new RemoteSkillsClient("sk_test_org_b", baseUrl);
      const submitted = await orgA.submitRun("audio-transcript-pack", { text: "secret run text" }, []);
      expect(await runWorkerOnce(store, "worker_test")).toBe(true);

      const crossRun = await orgB.getRun(submitted.id!);
      expect(crossRun).toBeNull();

      const artifacts = await orgA.getRunArtifacts(submitted.id!);
      const denied = await orgB.downloadRunArtifact(submitted.id!, artifacts[0].id);
      expect(denied.status).toBe(404);
    } finally {
      server.stop(true);
    }
  });
});
