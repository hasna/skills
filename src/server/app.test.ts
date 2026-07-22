import { describe, expect, test } from "bun:test";
import { RemoteSkillsClient } from "../lib/remote-client.js";
import { createSkillsFetchHandler } from "./app.js";
import { ArtifactStorage } from "./artifact-storage.js";
import { hashApiKey } from "./auth.js";
import { executeClaimedRun, executeRun } from "./handlers.js";
import { MemorySkillsStore } from "./store.js";
import { runWorkerOnce } from "./worker.js";

const FULL_SCOPES = ["skills:read", "runs:read", "runs:write", "artifacts:read"];
const LOOPBACK_TEST_ENV = {
  SKILLS_TEST_MODE: "1",
  SKILLS_ALLOW_INSECURE_LOOPBACK: "1",
};

async function testServer() {
  const store = new MemorySkillsStore([
    { token: "sk_test_org_a", principal: { orgId: "org_a", orgSlug: "org-a", userId: "user_a", email: "a@example.com", apiKeyId: "key_a", scopes: FULL_SCOPES } },
    { token: "sk_test_org_b", principal: { orgId: "org_b", orgSlug: "org-b", userId: "user_b", email: "b@example.com", apiKeyId: "key_b", scopes: FULL_SCOPES } },
  ]);
  const fetch = await createSkillsFetchHandler({ store, config: { inlineWorker: false } });
  const server = Bun.serve({ port: 0, fetch });
  return { server, store, baseUrl: `http://127.0.0.1:${server.port}` };
}

describe("self-hosted skills API", () => {
  test("executes one inline run for concurrent idempotent submissions", async () => {
    let releaseFirstStart!: () => void;
    let firstStartEntered!: () => void;
    const firstStartGate = new Promise<void>((resolve) => { releaseFirstStart = resolve; });
    const firstStartObserved = new Promise<void>((resolve) => { firstStartEntered = resolve; });
    class PausingInlineStore extends MemorySkillsStore {
      private paused = false;

      override async startRun(runId: string) {
        const started = await super.startRun(runId);
        if (!this.paused) {
          this.paused = true;
          firstStartEntered();
          await firstStartGate;
        }
        return started;
      }
    }
    const store = new PausingInlineStore([
      { token: "sk_test_inline", principal: { orgId: "org_inline", scopes: FULL_SCOPES } },
    ]);
    const handler = await createSkillsFetchHandler({ store, config: { inlineWorker: true } });
    const server = Bun.serve({ port: 0, fetch: handler });
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const principal = await store.authenticateApiKeyHash(hashApiKey("sk_test_inline"));

    try {
      const firstSubmission = fetch(
        `${baseUrl}/api/v1/runs/audio-transcript-pack`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer sk_test_inline",
            "Content-Type": "application/json",
            "Idempotency-Key": "inline-concurrent-once",
          },
          body: JSON.stringify({ input: { text: "execute this exactly once" } }),
        },
      );
      await firstStartObserved;
      const retries = await Promise.all(Array.from({ length: 19 }, () => fetch(
        `${baseUrl}/api/v1/runs/audio-transcript-pack`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer sk_test_inline",
            "Content-Type": "application/json",
            "Idempotency-Key": "inline-concurrent-once",
          },
          body: JSON.stringify({ input: { text: "execute this exactly once" } }),
        },
      )));
      releaseFirstStart();
      const submissions = [await firstSubmission, ...retries];
      const submitted = await Promise.all(submissions.map((response) => response.json()));
      expect(new Set(submitted.map((run) => run.id)).size).toBe(1);

      const runId = submitted[0].id as string;
      let run = await store.getRun(principal!, runId);
      for (let attempt = 0; attempt < 100 && run?.status === "running"; attempt += 1) {
        await fetch(`${baseUrl}/health`);
        run = await store.getRun(principal!, runId);
      }

      expect(await store.listRuns(principal!, 100)).toHaveLength(1);
      expect(run).toMatchObject({ status: "succeeded" });
      const artifacts = await store.listArtifacts(principal!, runId);
      expect(artifacts.map((artifact) => artifact.relativePath).sort()).toEqual([
        "clips.csv",
        "manifest.json",
        "show-notes.md",
        "summary.md",
        "transcript.md",
      ]);
      expect((await store.listLogs(principal!, runId)).map(({ level, message }) => ({ level, message }))).toEqual([
        { level: "info", message: "starting self-hosted run audio-transcript-pack" },
        { level: "info", message: "generated 5 artifacts" },
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("does not re-enter execution when executeRun is called twice for one run", async () => {
    const store = new MemorySkillsStore([
      { token: "sk_test_execute_once", principal: { orgId: "org_execute_once", scopes: FULL_SCOPES } },
    ]);
    const principal = await store.authenticateApiKeyHash(hashApiKey("sk_test_execute_once"));
    const { run } = await store.createRun({
      principal: principal!,
      slug: "audio-transcript-pack",
      input: { text: "execute direct call exactly once" },
      args: [],
    });

    await Promise.all([
      executeRun(store, run),
      executeRun(store, run),
    ]);

    expect(await store.getRun(principal!, run.id)).toMatchObject({ status: "succeeded" });
    const artifacts = await store.listArtifacts(principal!, run.id);
    expect(artifacts.map((artifact) => artifact.relativePath).sort()).toEqual([
      "clips.csv",
      "manifest.json",
      "show-notes.md",
      "summary.md",
      "transcript.md",
    ]);
    expect((await store.listLogs(principal!, run.id)).map(({ level, message }) => ({ level, message }))).toEqual([
      { level: "info", message: "starting self-hosted run audio-transcript-pack" },
      { level: "info", message: "generated 5 artifacts" },
    ]);
  });

  test("keeps concurrent idempotent non-inline submissions queued for one worker claim", async () => {
    const { server, store, baseUrl } = await testServer();
    const principal = await store.authenticateApiKeyHash(hashApiKey("sk_test_org_a"));
    try {
      const submissions = await Promise.all(Array.from({ length: 20 }, () => fetch(
        `${baseUrl}/api/v1/runs/audio-transcript-pack`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer sk_test_org_a",
            "Content-Type": "application/json",
            "Idempotency-Key": "queued-concurrent-once",
          },
          body: JSON.stringify({ input: { text: "one queued worker execution" } }),
        },
      )));
      const submitted = await Promise.all(submissions.map((response) => response.json()));
      expect(new Set(submitted.map((run) => run.id)).size).toBe(1);
      expect(submitted.every((run) => run.status === "queued")).toBe(true);
      expect(await store.listRuns(principal!, 100)).toHaveLength(1);
      expect(await store.listArtifacts(principal!, submitted[0].id)).toEqual([]);
      expect(await store.listLogs(principal!, submitted[0].id)).toEqual([]);

      expect(await runWorkerOnce(store, "worker_idempotent_once")).toBe(true);
      expect(await runWorkerOnce(store, "worker_idempotent_retry")).toBe(false);
      expect(await store.getRun(principal!, submitted[0].id)).toMatchObject({ status: "succeeded" });
      expect(await store.listArtifacts(principal!, submitted[0].id)).toHaveLength(5);
      expect((await store.listLogs(principal!, submitted[0].id)).map((log) => log.message)).toEqual([
        "starting self-hosted run audio-transcript-pack",
        "generated 5 artifacts",
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("binds an idempotency key to the exact canonical run request within one organization", async () => {
    const { server, store, baseUrl } = await testServer();
    const submit = async (
      token: string,
      slug: string,
      idempotencyKey: string,
      body: Record<string, unknown>,
    ) => {
      const response = await fetch(`${baseUrl}/api/v1/runs/${slug}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      return { response, payload: await response.json() as Record<string, unknown> };
    };

    try {
      const original = await submit("sk_test_org_a", "audio-transcript-pack", "request-bound-key", {
        input: { alpha: 1, nested: { z: 2, a: 3 } },
        args: ["--title", "Exact"],
        approved: true,
        quoteToken: "quote_exact",
      });
      expect(original.response.status).toBe(202);

      const replay = await submit("sk_test_org_a", "audio-transcript-pack", "request-bound-key", {
        input: { nested: { a: 3, z: 2 }, alpha: 1 },
        args: ["--title", "Exact"],
        quoteToken: "quote_exact",
        approved: true,
      });
      expect(replay.response.status).toBe(202);
      expect(replay.payload.id).toBe(original.payload.id);

      const conflictingBodies = [
        { input: { alpha: 2, nested: { a: 3, z: 2 } }, args: ["--title", "Exact"], approved: true, quoteToken: "quote_exact" },
        { input: { alpha: 1, nested: { a: 3, z: 2 } }, args: ["--title", "Changed"], approved: true, quoteToken: "quote_exact" },
        { input: { alpha: 1, nested: { a: 3, z: 2 } }, args: ["--title", "Exact"], approved: false, quoteToken: "quote_exact" },
        { input: { alpha: 1, nested: { a: 3, z: 2 } }, args: ["--title", "Exact"], approved: true, quoteToken: "quote_changed" },
      ];
      for (const body of conflictingBodies) {
        const conflict = await submit("sk_test_org_a", "audio-transcript-pack", "request-bound-key", body);
        expect(conflict.response.status).toBe(409);
        expect(conflict.payload).toEqual({
          error: "This idempotency key was already used for a different run request.",
          code: "IDEMPOTENCY_KEY_REUSED",
        });
      }

      const slugConflict = await submit("sk_test_org_a", "transcript", "request-bound-key", {
        input: { alpha: 1, nested: { a: 3, z: 2 } },
        args: ["--title", "Exact"],
        approved: true,
        quoteToken: "quote_exact",
      });
      expect(slugConflict.response.status).toBe(409);
      expect(slugConflict.payload).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

      const otherTenant = await submit("sk_test_org_b", "transcript", "request-bound-key", {
        input: { tenant: "org-b" },
        args: [],
      });
      expect(otherTenant.response.status).toBe(202);
      expect(otherTenant.payload.id).not.toBe(original.payload.id);

      const orgA = await store.authenticateApiKeyHash(hashApiKey("sk_test_org_a"));
      const orgB = await store.authenticateApiKeyHash(hashApiKey("sk_test_org_b"));
      expect(await store.listRuns(orgA!, 100)).toHaveLength(1);
      expect(await store.listRuns(orgB!, 100)).toHaveLength(1);
    } finally {
      server.stop(true);
    }
  });

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
      const client = new RemoteSkillsClient("sk_test_org_a", baseUrl, LOOPBACK_TEST_ENV);
      const skills = await client.listSkills();
      expect(Array.isArray(skills)).toBe(true);
      expect(skills.some((skill) => skill.name === "audio-transcript-pack")).toBe(true);

      const submitted = await client.submitRun("audio-transcript-pack", { transcript: "Hello world from self hosted skills." }, ["--title", "Demo"], { idempotencyKey: "app-artifact-run" });
      expect(submitted.status).toBe("queued");
      expect(submitted.id).toBeTruthy();
      expect(submitted.credits).toBeUndefined();

      expect(await runWorkerOnce(store, "worker_test")).toBe(true);
      const run = await client.getRun(submitted.id!);
      expect(run).toMatchObject({ status: "succeeded", skill: "audio-transcript-pack" });

      const logs = await client.getRunLogs(submitted.id!);
      expect(logs.map((log) => log.message).join("\n")).toContain("generated");

      const artifacts = await client.getRunArtifacts(submitted.id!);
      expect(artifacts.some((artifact) => artifact.contentType === "text/markdown; charset=utf-8")).toBe(true);
      expect(artifacts.every((artifact) => artifact.relativePath?.startsWith("generated-output-"))).toBe(true);
      const transcript = artifacts.find((artifact) => artifact.contentType === "text/markdown; charset=utf-8");
      const downloaded = await client.downloadRunArtifact(submitted.id!, transcript!.id);
      expect(downloaded.status).toBe(200);
      expect(await downloaded.text()).toContain("Hello world");
    } finally {
      server.stop(true);
    }
  });

  test("advertises and quotes only executable self-hosted handlers truthfully", async () => {
    const { server, baseUrl } = await testServer();
    try {
      const client = new RemoteSkillsClient("sk_test_org_a", baseUrl, LOOPBACK_TEST_ENV);
      const skills = await client.listSkills();
      const supported = skills.find((skill) => skill.name === "audio-transcript-pack");
      const unsupported = skills.find((skill) => skill.name === "logo-design");

      expect(supported).toMatchObject({
        availability: { status: "available" },
        creditQuote: {
          tier: "free",
          credits: 0,
          formattedCredits: "0 credits",
          quoteRequired: false,
        },
      });
      expect(unsupported).toMatchObject({
        availability: { status: "unavailable", code: "HANDLER_UNAVAILABLE" },
      });
      expect(unsupported!.creditQuote).toBeUndefined();

      expect(await client.quoteSkill("audio-transcript-pack")).toMatchObject({
        availability: { status: "available" },
        creditQuote: { tier: "free", credits: 0, formattedCredits: "0 credits", quoteRequired: false },
      });
      const unsupportedQuote = await client.quoteSkill("logo-design");
      expect(unsupportedQuote).toMatchObject({
        availability: { status: "unavailable", code: "HANDLER_UNAVAILABLE" },
        code: "HANDLER_UNAVAILABLE",
      });
      expect(unsupportedQuote.creditQuote).toBeUndefined();
      expect(JSON.stringify(unsupportedQuote)).not.toMatch(/debit/i);
      expect(unsupportedQuote.availability?.details).toContain("No credits were charged.");
    } finally {
      server.stop(true);
    }
  });

  test("rejects unsupported skills before creating or queueing a run", async () => {
    const { server, baseUrl } = await testServer();
    try {
      const denied = await fetch(`${baseUrl}/api/v1/runs/logo-design`, {
        method: "POST",
        headers: { Authorization: "Bearer sk_test_org_a", "Content-Type": "application/json" },
        body: JSON.stringify({ input: { prompt: "A logo" } }),
      });
      expect(denied.status).toBe(503);
      expect(await denied.json()).toMatchObject({ code: "HANDLER_UNAVAILABLE" });

      const runs = await new RemoteSkillsClient("sk_test_org_a", baseUrl, LOOPBACK_TEST_ENV).listRuns();
      expect(runs).toEqual([]);
    } finally {
      server.stop(true);
    }
  });

  test("rejects extra route components instead of executing a shorter matching route", async () => {
    const { server, store, baseUrl } = await testServer();
    try {
      const quote = await fetch(`${baseUrl}/api/v1/skills/audio-transcript-pack/quote/extra`, {
        method: "POST",
        headers: { Authorization: "Bearer sk_test_org_a" },
      });
      expect(quote.status).toBe(404);

      for (const path of [
        "/api/v1/billing/status/extra",
        "/api/v1/billing/credits/extra",
        "/api/v1/billing/arbitrary/extra",
      ]) {
        const response = await fetch(`${baseUrl}${path}`, {
          headers: { Authorization: "Bearer sk_test_org_a" },
        });
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
      }

      const client = new RemoteSkillsClient("sk_test_org_a", baseUrl, LOOPBACK_TEST_ENV);
      const submitted = await client.submitRun("audio-transcript-pack", { text: "do not cancel" }, [], { idempotencyKey: "app-route-run" });
      const cancel = await fetch(`${baseUrl}/api/v1/runs/${submitted.id}/cancel/extra`, {
        method: "POST",
        headers: { Authorization: "Bearer sk_test_org_a" },
      });
      expect(cancel.status).toBe(404);
      const principal = await store.authenticateApiKeyHash(hashApiKey("sk_test_org_a"));
      expect(await store.getRun(principal!, submitted.id!)).toMatchObject({ status: "queued" });
    } finally {
      server.stop(true);
    }
  });

  test("enforces API-key scopes per registry, run, and artifact route", async () => {
    const org = { orgId: "org_scope", orgSlug: "org-scope", userId: "user_scope", email: "scope@example.com" };
    const store = new MemorySkillsStore([
      { token: "key_skills_read", principal: { ...org, apiKeyId: "key_skills", scopes: ["skills:read"] } },
      { token: "key_runs_read", principal: { ...org, apiKeyId: "key_run_read", scopes: ["runs:read"] } },
      { token: "key_runs_write", principal: { ...org, apiKeyId: "key_run_write", scopes: ["runs:write"] } },
      { token: "key_artifacts_read", principal: { ...org, apiKeyId: "key_artifact_read", scopes: ["artifacts:read"] } },
      { token: "key_full", principal: { ...org, apiKeyId: "key_full", scopes: FULL_SCOPES } },
    ]);
    const handler = await createSkillsFetchHandler({ store, config: { inlineWorker: false } });
    const server = Bun.serve({ port: 0, fetch: handler });
    const baseUrl = `http://127.0.0.1:${server.port}`;

    async function request(token: string, path: string, init: RequestInit = {}) {
      return fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
      });
    }

    try {
      expect((await request("key_skills_read", "/api/v1/skills")).status).toBe(200);
      const skillsDenied = await request("key_skills_read", "/api/v1/runs");
      expect(skillsDenied.status).toBe(403);
      expect(await skillsDenied.json()).toMatchObject({ code: "INSUFFICIENT_SCOPE", requiredScope: "runs:read" });

      expect((await request("key_runs_read", "/api/v1/runs")).status).toBe(200);
      const writeDenied = await request("key_runs_read", "/api/v1/runs/audio-transcript-pack", { method: "POST", body: "{}" });
      expect(writeDenied.status).toBe(403);
      expect(await writeDenied.json()).toMatchObject({ requiredScope: "runs:write" });

      const created = await request("key_runs_write", "/api/v1/runs/audio-transcript-pack", {
        method: "POST",
        body: JSON.stringify({ input: { text: "scope fixture" } }),
      });
      expect(created.status).toBe(202);
      const createdRun = await created.json();
      expect((await request("key_runs_write", `/api/v1/runs/${createdRun.id}`)).status).toBe(403);
      expect(await runWorkerOnce(store, "worker_scope")).toBe(true);

      const artifactsDenied = await request("key_runs_read", `/api/v1/runs/${createdRun.id}/artifacts`);
      expect(artifactsDenied.status).toBe(403);
      expect(await artifactsDenied.json()).toMatchObject({ requiredScope: "artifacts:read" });

      const artifacts = await request("key_artifacts_read", `/api/v1/runs/${createdRun.id}/artifacts`);
      expect(artifacts.status).toBe(200);
      const artifactList = await artifacts.json();
      expect(artifactList.length).toBeGreaterThan(0);
      expect((await request("key_artifacts_read", `/api/v1/runs/${createdRun.id}/artifacts/${artifactList[0].id}/download`)).status).toBe(200);
    } finally {
      server.stop(true);
    }
  });

  test("cancels queued work terminally so a worker cannot claim it", async () => {
    const { server, store, baseUrl } = await testServer();
    try {
      const client = new RemoteSkillsClient("sk_test_org_a", baseUrl, LOOPBACK_TEST_ENV);
      const submitted = await client.submitRun("audio-transcript-pack", { text: "cancel before claim" }, [], { idempotencyKey: "app-cancel-before-claim" });
      const cancelled = await fetch(`${baseUrl}/api/v1/runs/${submitted.id}/cancel`, {
        method: "POST",
        headers: { Authorization: "Bearer sk_test_org_a" },
      });
      expect(cancelled.status).toBe(200);
      expect(await cancelled.json()).toMatchObject({ status: "cancelled", completedAt: expect.any(String) });
      expect(await runWorkerOnce(store, "worker_after_cancel")).toBe(false);
      expect(await client.getRun(submitted.id!)).toMatchObject({ status: "cancelled" });
    } finally {
      server.stop(true);
    }
  });

  test("preserves running cancellation when a worker races to commit success", async () => {
    const { server, store, baseUrl } = await testServer();
    try {
      const client = new RemoteSkillsClient("sk_test_org_a", baseUrl, LOOPBACK_TEST_ENV);
      const submitted = await client.submitRun("audio-transcript-pack", { text: "cancel during execution" }, [], { idempotencyKey: "app-cancel-during-run" });
      const claimed = await store.claimNextRun({ workerId: "worker_race" });
      expect(claimed).toMatchObject({ claimed: true, run: { id: submitted.id, status: "running" } });

      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const materializing = new Promise<void>((resolve) => { entered = resolve; });
      class PausingArtifactStorage extends ArtifactStorage {
        private signalled = false;

        override async materialize(...args: Parameters<ArtifactStorage["materialize"]>) {
          if (!this.signalled) {
            this.signalled = true;
            entered();
            await gate;
          }
          return super.materialize(...args);
        }
      }

      const execution = executeClaimedRun(store, claimed!, new PausingArtifactStorage());
      await materializing;
      const cancellation = await fetch(`${baseUrl}/api/v1/runs/${submitted.id}/cancel`, {
        method: "POST",
        headers: { Authorization: "Bearer sk_test_org_a" },
      });
      expect(await cancellation.json()).toMatchObject({ status: "cancel_requested" });
      release();

      expect(await execution).toMatchObject({ status: "cancelled" });
      expect(await client.getRun(submitted.id!)).toMatchObject({ status: "cancelled" });
    } finally {
      server.stop(true);
    }
  });

  test("makes an already-requested memory-store cancellation win the terminal commit race", async () => {
    const store = new MemorySkillsStore([
      { token: "key_race", principal: { orgId: "org_race", scopes: FULL_SCOPES } },
    ]);
    const principal = await store.authenticateApiKeyHash(hashApiKey("key_race"));
    const { run } = await store.createRun({
      principal: principal!,
      slug: "audio-transcript-pack",
      input: { text: "race" },
      args: [],
    });
    expect(await store.claimNextRun({ workerId: "worker_store_race" })).toMatchObject({
      claimed: true,
      run: { status: "running" },
    });

    const cancellation = store.requestCancellation(principal!, run.id);
    const completion = store.finishRun(run.id, {
      status: "succeeded",
      outputType: "artifact_bundle",
      completedAt: new Date().toISOString(),
    });

    expect(await cancellation).toMatchObject({ status: "cancel_requested" });
    expect(await completion).toMatchObject({ status: "cancelled" });
    expect(await store.getRun(principal!, run.id)).toMatchObject({ status: "cancelled" });
  });

  test("enforces organization ownership on run and artifact routes", async () => {
    const { server, store, baseUrl } = await testServer();
    try {
      const orgA = new RemoteSkillsClient("sk_test_org_a", baseUrl, LOOPBACK_TEST_ENV);
      const orgB = new RemoteSkillsClient("sk_test_org_b", baseUrl, LOOPBACK_TEST_ENV);
      const submitted = await orgA.submitRun("audio-transcript-pack", { text: "secret run text" }, [], { idempotencyKey: "app-ownership-run" });
      expect(await runWorkerOnce(store, "worker_test")).toBe(true);

      const crossRun = await orgB.getRun(submitted.id!);
      expect(crossRun).toBeNull();

      const artifacts = await orgA.getRunArtifacts(submitted.id!);
      const denied = await orgB.downloadRunArtifact(submitted.id!, artifacts[0]!.id);
      expect(denied.status).toBe(404);
    } finally {
      server.stop(true);
    }
  });
});
