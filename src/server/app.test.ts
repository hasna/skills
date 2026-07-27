import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { RemoteSkillsClient } from "../lib/remote-client.js";
import { packSkillBundle } from "../lib/skill-bundle.js";
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

/**
 * A packed skill bundle whose contents identify which org built it.
 *
 * Distinct bytes per caller is the point: a cross-org test that publishes identical
 * content to both orgs cannot tell "B read its own copy" from "B read A's copy", because
 * both answers are the same bytes. The marker makes the two outcomes distinguishable.
 */
function fixtureBundle(marker: string): { bytes: Uint8Array; sha256: string; skillMd: string } {
  const dir = mkdtempSync(join(tmpdir(), "skills-api-bundle-"));
  try {
    const skillMd = `---\nname: team-runbook\ndescription: ${marker} runbook\n---\n\n# ${marker}\n`;
    for (const [path, content] of Object.entries({
      "SKILL.md": skillMd,
      "skill.json": JSON.stringify({ standard: "hasna.skill.v1", name: "team-runbook" }),
      "src/index.ts": `console.log(${JSON.stringify(marker)});\n`,
    })) {
      const absolute = join(dir, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }
    const packed = packSkillBundle(dir);
    return { bytes: packed.bytes, sha256: packed.sha256, skillMd };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function manifestFor(slug: string, marker: string, skillMd: string, sha256: string): Record<string, unknown> {
  return {
    slug,
    displayName: `${marker} Runbook`,
    description: `${marker} deployment runbook`,
    category: "Development Tools",
    tags: ["ops", marker],
    kind: "executable",
    version: "1.2.3",
    source: "custom",
    skillMd,
    bundleSha256: sha256,
  };
}

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

    test("publishes a skill, serves it alongside the bundled corpus, and returns its bundle intact", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const bundle = fixtureBundle("alpha");

        const published = await client.publishSkill(manifestFor("team-runbook", "alpha", bundle.skillMd, bundle.sha256), bundle.bytes);
        expect(published.status).toBe(201);
        expect(await published.json()).toMatchObject({
          slug: "team-runbook",
          name: "team-runbook",
          displayName: "alpha Runbook",
          version: "1.2.3",
          kind: "executable",
          source: "remote",
          publishedSource: "custom",
          bundleSha256: bundle.sha256,
          bundleByteSize: bundle.bytes.byteLength,
        });

        const listed = await client.listSkills();
        expect(listed.some((skill) => skill.name === "team-runbook")).toBe(true);
        // Merged, not replaced: a bundled skill must still be there.
        expect(listed.some((skill) => skill.name === "audio-transcript-pack")).toBe(true);

        expect(await client.getSkill("team-runbook")).toMatchObject({ slug: "team-runbook", bundleSha256: bundle.sha256 });
        expect(await client.getSkillMd("team-runbook")).toBe(bundle.skillMd);

        const download = await client.downloadSkillBundle("team-runbook");
        expect(download.status).toBe(200);
        expect(download.headers.get("x-skill-bundle-sha256")).toBe(bundle.sha256);
        const bytes = new Uint8Array(await download.arrayBuffer());
        expect(Array.from(bytes)).toEqual(Array.from(bundle.bytes));
      } finally {
        await ctx.stop();
      }
    });

    test("a published skill overrides a bundled skill of the same slug for that org only", async () => {
      const ctx = await testServer(backend);
      try {
        const orgA = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const orgB = new RemoteSkillsClient("sk_test_org_b", ctx.baseUrl);
        const bundle = fixtureBundle("override");

        await orgA.publishSkill(manifestFor("audio-transcript-pack", "override", bundle.skillMd, bundle.sha256), bundle.bytes);

        expect(await orgA.getSkill("audio-transcript-pack")).toMatchObject({ description: "override deployment runbook", source: "remote" });
        const listedA = await orgA.listSkills();
        expect(listedA.filter((skill) => skill.name === "audio-transcript-pack")).toHaveLength(1);
        expect(listedA.find((skill) => skill.name === "audio-transcript-pack")).toMatchObject({ displayName: "override Runbook" });

        // Org B still sees the bundled one, unchanged.
        const bundledForB = await orgB.getSkill("audio-transcript-pack");
        expect(bundledForB.description).not.toBe("override deployment runbook");
        expect((await orgB.downloadSkillBundle("audio-transcript-pack")).status).toBe(404);
      } finally {
        await ctx.stop();
      }
    });

    test("published skills are invisible and untouchable across organizations", async () => {
      const ctx = await testServer(backend);
      try {
        const orgA = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const orgB = new RemoteSkillsClient("sk_test_org_b", ctx.baseUrl);
        const alpha = fixtureBundle("alpha");

        await orgA.publishSkill(manifestFor("team-runbook", "alpha", alpha.skillMd, alpha.sha256), alpha.bytes);

        // Anti-vacuity control FIRST: org A can read its own skill through every route
        // below. Without this, all the 404 assertions would pass just as well against a
        // server that had failed to store anything at all.
        expect(await orgA.getSkill("team-runbook")).toMatchObject({ slug: "team-runbook" });
        expect((await orgA.listSkills()).some((skill) => skill.name === "team-runbook")).toBe(true);
        expect((await orgA.downloadSkillBundle("team-runbook")).status).toBe(200);
        expect(await orgA.getSkillMd("team-runbook")).toBe(alpha.skillMd);

        // Org B: every read path.
        expect((await orgB.listSkills()).some((skill) => skill.name === "team-runbook")).toBe(false);
        expect(await orgB.getSkill("team-runbook")).toBeNull();
        expect(await orgB.getSkillMd("team-runbook")).toBeNull();
        expect((await orgB.downloadSkillBundle("team-runbook")).status).toBe(404);

        // Org B: every write path. A cross-org DELETE that reported success would be the
        // worst of these, since it destroys rather than discloses.
        expect((await orgB.deleteSkill("team-runbook")).status).toBe(404);
        const crossUpdate = await fetch(`${ctx.baseUrl}/api/v1/skills/team-runbook`, {
          method: "PATCH",
          headers: { authorization: "Bearer sk_test_org_b", "content-type": "application/json" },
          body: JSON.stringify({ description: "hijacked" }),
        });
        expect(crossUpdate.status).toBe(404);

        // Org A is untouched by all of that.
        expect(await orgA.getSkill("team-runbook")).toMatchObject({ description: "alpha deployment runbook" });

        // Org B publishes the SAME slug with DIFFERENT bytes. Each org must read its own.
        const beta = fixtureBundle("beta");
        expect(beta.sha256).not.toBe(alpha.sha256);
        expect((await orgB.publishSkill(manifestFor("team-runbook", "beta", beta.skillMd, beta.sha256), beta.bytes)).status).toBe(201);

        expect(await orgA.getSkill("team-runbook")).toMatchObject({ bundleSha256: alpha.sha256, description: "alpha deployment runbook" });
        expect(await orgB.getSkill("team-runbook")).toMatchObject({ bundleSha256: beta.sha256, description: "beta deployment runbook" });
        expect(await orgA.getSkillMd("team-runbook")).toBe(alpha.skillMd);
        expect(await orgB.getSkillMd("team-runbook")).toBe(beta.skillMd);

        const downloadedA = new Uint8Array(await (await orgA.downloadSkillBundle("team-runbook")).arrayBuffer());
        const downloadedB = new Uint8Array(await (await orgB.downloadSkillBundle("team-runbook")).arrayBuffer());
        expect(Array.from(downloadedA)).toEqual(Array.from(alpha.bytes));
        expect(Array.from(downloadedB)).toEqual(Array.from(beta.bytes));

        // Deleting B's copy must leave A's alone, including A's stored blob.
        expect((await orgB.deleteSkill("team-runbook")).status).toBe(200);
        expect(await orgB.getSkill("team-runbook")).toBeNull();
        expect((await orgA.downloadSkillBundle("team-runbook")).status).toBe(200);
        expect(Array.from(new Uint8Array(await (await orgA.downloadSkillBundle("team-runbook")).arrayBuffer()))).toEqual(Array.from(alpha.bytes));
      } finally {
        await ctx.stop();
      }
    });

    test("a published skill with no SKILL.md does not serve the bundled skill's instructions", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const bundle = fixtureBundle("shadow");

        // Control: the bundled skill's document is served before anything is published,
        // so the null below is the override taking effect and not a route that never works.
        const bundledDoc = await client.getSkillMd("audio-transcript-pack");
        expect(bundledDoc).toBeTruthy();

        const manifest = manifestFor("audio-transcript-pack", "shadow", "", bundle.sha256);
        delete manifest.skillMd;
        expect((await client.publishSkill(manifest, bundle.bytes)).status).toBe(201);

        // Falling through to the bundled document here would hand an agent one skill's
        // instructions under another skill's name - the published row is what this
        // instance serves under that slug, and it has no document.
        expect(await client.getSkillMd("audio-transcript-pack")).toBeNull();
        expect(await client.getSkill("audio-transcript-pack")).toMatchObject({ description: "shadow deployment runbook" });
      } finally {
        await ctx.stop();
      }
    });

    test("a metadata-only re-publish keeps the stored bundle instead of destroying it", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const bundle = fixtureBundle("alpha");
        await client.publishSkill(manifestFor("team-runbook", "alpha", bundle.skillMd, bundle.sha256), bundle.bytes);
        expect((await client.downloadSkillBundle("team-runbook")).status).toBe(200);

        // POST with JSON and no bundle part. This used to take the upsert path with a
        // NULL digest, hand the old digest to orphan collection, and delete the tarball -
        // so a metadata edit silently 404ed the bundle for every client, irreversibly.
        const metadataOnly = await fetch(`${ctx.baseUrl}/api/v1/skills`, {
          method: "POST",
          headers: { authorization: "Bearer sk_test_org_a", "content-type": "application/json" },
          body: JSON.stringify({ slug: "team-runbook", description: "just fixing a typo" }),
        });
        expect(metadataOnly.status).toBe(201);
        expect(await metadataOnly.json()).toMatchObject({ description: "just fixing a typo", bundleSha256: bundle.sha256 });

        const download = await client.downloadSkillBundle("team-runbook");
        expect(download.status).toBe(200);
        expect(Array.from(new Uint8Array(await download.arrayBuffer()))).toEqual(Array.from(bundle.bytes));
      } finally {
        await ctx.stop();
      }
    });

    test("refuses multipart parts the endpoint did not ask for", async () => {
      const ctx = await testServer(backend);
      try {
        const bundle = fixtureBundle("alpha");
        const form = new FormData();
        form.set("manifest", JSON.stringify(manifestFor("team-runbook", "alpha", bundle.skillMd, bundle.sha256)));
        form.set("bundle", new Blob([bundle.bytes as BlobPart], { type: "application/gzip" }), "b.tar.gz");
        // Only `manifest` and `bundle` were ever measured, so extra parts were buffered
        // and counted against nothing - a hole straight through the configured cap.
        form.set("filler", "x".repeat(50_000));

        const response = await fetch(`${ctx.baseUrl}/api/v1/skills`, {
          method: "POST",
          headers: { authorization: "Bearer sk_test_org_a" },
          body: form,
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "UNEXPECTED_PART" });

        // Control: the identical request without the extra part succeeds, so the 400 is
        // the new refusal and not a broken multipart body.
        const clean = new FormData();
        clean.set("manifest", JSON.stringify(manifestFor("team-runbook", "alpha", bundle.skillMd, bundle.sha256)));
        clean.set("bundle", new Blob([bundle.bytes as BlobPart], { type: "application/gzip" }), "b.tar.gz");
        const ok = await fetch(`${ctx.baseUrl}/api/v1/skills`, {
          method: "POST", headers: { authorization: "Bearer sk_test_org_a" }, body: clean,
        });
        expect(ok.status).toBe(201);
      } finally {
        await ctx.stop();
      }
    });

    test("rejects a bundle whose bytes do not match the declared digest", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const bundle = fixtureBundle("alpha");
        const wrongDigest = "0".repeat(64);
        const response = await client.publishSkill(manifestFor("team-runbook", "alpha", bundle.skillMd, wrongDigest), bundle.bytes);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "BUNDLE_DIGEST_MISMATCH" });
        // Nothing was stored: a rejected publish must not leave a half-published skill.
        expect(await client.getSkill("team-runbook")).toBeNull();
      } finally {
        await ctx.stop();
      }
    });

    test("refuses an oversized bundle without letting it reach the JSON reader", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const bundle = fixtureBundle("alpha");
        // The server's own limit, not the client's: lowered per-fixture so the test does
        // not have to transfer 25 MB to prove the cap exists.
        const small = await createSkillsFetchHandler({
          store: ctx.store,
          config: { inlineWorker: false, allowEphemeralStore: true, skillBundleLimitBytes: 128 },
        });
        const server = Bun.serve({ port: 0, fetch: small });
        try {
          const capped = new RemoteSkillsClient("sk_test_org_a", `http://127.0.0.1:${server.port}`);
          const response = await capped.publishSkill(manifestFor("team-runbook", "alpha", bundle.skillMd, bundle.sha256), bundle.bytes);
          expect(response.status).toBe(413);
          expect(await response.json()).toMatchObject({ code: "BODY_TOO_LARGE" });
          // Control: the same request succeeds against the default limit, so the 413 is
          // the cap firing rather than the request being broken.
          expect((await client.publishSkill(manifestFor("team-runbook", "alpha", bundle.skillMd, bundle.sha256), bundle.bytes)).status).toBe(201);
        } finally {
          server.stop(true);
        }
      } finally {
        await ctx.stop();
      }
    });

    test("rejects a slug that is not a valid skill name", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const bundle = fixtureBundle("alpha");
        for (const slug of ["../etc/passwd", "Has Spaces", "UPPER", "-leading-dash", ""]) {
          const response = await client.publishSkill(
            { ...manifestFor("team-runbook", "alpha", bundle.skillMd, bundle.sha256), slug },
            bundle.bytes,
          );
          expect([400, 404]).toContain(response.status);
        }
      } finally {
        await ctx.stop();
      }
    });

    test("updates metadata in place and leaves the bundle attached", async () => {
      const ctx = await testServer(backend);
      try {
        const client = new RemoteSkillsClient("sk_test_org_a", ctx.baseUrl);
        const bundle = fixtureBundle("alpha");
        await client.publishSkill(manifestFor("team-runbook", "alpha", bundle.skillMd, bundle.sha256), bundle.bytes);

        const patched = await fetch(`${ctx.baseUrl}/api/v1/skills/team-runbook`, {
          method: "PATCH",
          headers: { authorization: "Bearer sk_test_org_a", "content-type": "application/json" },
          body: JSON.stringify({ description: "now with more detail" }),
        });
        expect(patched.status).toBe(200);
        expect(await patched.json()).toMatchObject({
          description: "now with more detail",
          // Untouched by a patch that did not mention them.
          version: "1.2.3",
          displayName: "alpha Runbook",
          bundleSha256: bundle.sha256,
        });
        expect((await client.downloadSkillBundle("team-runbook")).status).toBe(200);

        // A patch against a slug this org never published is a 404, not an implicit create.
        const missing = await fetch(`${ctx.baseUrl}/api/v1/skills/never-published`, {
          method: "PATCH",
          headers: { authorization: "Bearer sk_test_org_a", "content-type": "application/json" },
          body: JSON.stringify({ description: "x" }),
        });
        expect(missing.status).toBe(404);
      } finally {
        await ctx.stop();
      }
    });
  });
}
