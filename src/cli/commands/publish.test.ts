/**
 * `skills push`, against a real server over HTTP.
 *
 * The corpus is redirected with `rootDir` rather than by moving $HOME: these tests must be
 * identical on a clean machine and on a developer's, and a suite that reads the real
 * ~/.hasna/skills/installed would pass or fail depending on what the operator happens to
 * have written there.
 */
import { describe, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../../test-preload.js";

useDefaultTestTimeout();
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { RemoteSkillsClient } from "../../lib/remote-client.js";
import { unpackSkillBundle } from "../../lib/skill-bundle.js";
import { createSkillsFetchHandler } from "../../server/app.js";
import { MemorySkillsStore } from "../../server/store.js";
import { PushSkillError, pushSkill } from "./publish.js";

const TOKEN = "sk_test_push";
const PRINCIPAL = { orgId: "org_push", orgSlug: "org-push", orgName: "Push Org", userId: "user_push", email: "push@example.com", apiKeyId: "key_push" };
const OTHER = { orgId: "org_other", orgSlug: "org-other", orgName: "Other", userId: "user_other", email: "other@example.com", apiKeyId: "key_other" };

const VALID_SKILL: Record<string, string> = {
  "SKILL.md": "---\nname: release-notes\ndescription: Draft release notes from a changelog\nversion: 2.1.0\n---\n\n# Release Notes\n\nDrafts release notes.\n",
  "skill.json": JSON.stringify({
    $schema: "https://hasna.dev/schemas/skill.v1.json",
    standard: "hasna.skill.v1",
    name: "release-notes",
    description: "Draft release notes from a changelog",
    version: "2.1.0",
    displayName: "Release Notes",
    category: "Content Generation",
    tags: ["custom", "release"],
    inputs: [{ name: "args", type: "string[]", required: false }],
    commands: [{ name: "release-notes", entry: "src/index.ts" }],
  }, null, 2),
  "AGENTS.md": "# Agent Build Instructions\n",
  "package.json": JSON.stringify({ name: "release-notes", version: "2.1.0", type: "module", bin: { "release-notes": "src/index.ts" } }, null, 2),
  "src/index.ts": "console.log('release notes');\n",
  "references/style-guide.md": "Use the imperative mood.\n",
};

function makeCorpus(skills: Record<string, Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "skills-push-corpus-"));
  for (const [name, files] of Object.entries(skills)) {
    for (const [path, content] of Object.entries(files)) {
      const absolute = join(root, name, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }
  }
  return root;
}

async function withServer(fn: (ctx: { baseUrl: string; store: MemorySkillsStore }) => Promise<void>): Promise<void> {
  const store = new MemorySkillsStore();
  await store.ensureBootstrapApiKey(TOKEN, PRINCIPAL);
  await store.ensureBootstrapApiKey("sk_test_other", OTHER);
  const fetchHandler = await createSkillsFetchHandler({ store, config: { inlineWorker: false, allowEphemeralStore: true } });
  const server = Bun.serve({ port: 0, fetch: fetchHandler });
  try {
    await fn({ baseUrl: `http://127.0.0.1:${server.port}`, store });
  } finally {
    server.stop(true);
  }
}

describe("skills push", () => {
  test("packs, validates, uploads, and the skill is then served to a fresh client", async () => {
    const root = makeCorpus({ "release-notes": VALID_SKILL });
    try {
      await withServer(async (ctx) => {
        const result = await pushSkill("release-notes", {
          rootDir: root,
          client: new RemoteSkillsClient(TOKEN, ctx.baseUrl),
        });
        expect(result.published).toBe(true);
        expect(result.status).toBe(201);
        expect(result.slug).toBe("release-notes");
        expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(result.paths).toEqual([
          "AGENTS.md",
          "SKILL.md",
          "package.json",
          "references/style-guide.md",
          "skill.json",
          "src/index.ts",
        ]);

        // A FRESH client, constructed after the push, with no shared state beyond the
        // server: this is the "another machine sees it" claim.
        const reader = new RemoteSkillsClient(TOKEN, ctx.baseUrl);
        const listed = await reader.listSkills();
        const found = listed.find((skill) => skill.name === "release-notes");
        expect(found).toMatchObject({
          displayName: "Release Notes",
          description: "Draft release notes from a changelog",
          category: "Content Generation",
          version: "2.1.0",
          source: "remote",
          bundleSha256: result.sha256,
        });
        // Merged with the bundled corpus, not replacing it.
        expect(listed.length).toBeGreaterThan(1);

        expect(await reader.getSkillMd("release-notes")).toBe(VALID_SKILL["SKILL.md"]);

        const download = await reader.downloadSkillBundle("release-notes");
        expect(download.status).toBe(200);
        const entries = unpackSkillBundle(new Uint8Array(await download.arrayBuffer()));
        expect(entries.map((entry) => entry.path)).toEqual(result.paths);
        expect(new TextDecoder().decode(entries.find((entry) => entry.path === "src/index.ts")!.bytes))
          .toBe(VALID_SKILL["src/index.ts"]);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("another organization cannot see or fetch what was pushed", async () => {
    const root = makeCorpus({ "release-notes": VALID_SKILL });
    try {
      await withServer(async (ctx) => {
        await pushSkill("release-notes", { rootDir: root, client: new RemoteSkillsClient(TOKEN, ctx.baseUrl) });
        const stranger = new RemoteSkillsClient("sk_test_other", ctx.baseUrl);
        expect((await stranger.listSkills()).some((skill) => skill.name === "release-notes")).toBe(false);
        expect(await stranger.getSkill("release-notes")).toBeNull();
        expect((await stranger.downloadSkillBundle("release-notes")).status).toBe(404);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("re-pushing unchanged sources produces the same digest", async () => {
    const root = makeCorpus({ "release-notes": VALID_SKILL });
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(TOKEN, ctx.baseUrl);
        const first = await pushSkill("release-notes", { rootDir: root, client });
        const second = await pushSkill("release-notes", { rootDir: root, client });
        expect(second.sha256).toBe(first.sha256);
        // Still one skill, not two.
        expect((await client.listSkills()).filter((skill) => skill.name === "release-notes")).toHaveLength(1);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refuses to publish a skill that fails validation", async () => {
    // Missing AGENTS.md and a manifest name that disagrees with the folder: exactly what
    // validatePortableSkillDirectory() exists to catch, checked before anything is packed
    // or uploaded.
    const root = makeCorpus({
      broken: {
        "SKILL.md": "---\nname: something-else\ndescription: mismatched\n---\n\n# Broken\n",
        "skill.json": JSON.stringify({ standard: "hasna.skill.v1", name: "something-else", description: "mismatched", version: "0.1.0" }),
      },
    });
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(TOKEN, ctx.baseUrl);
        await expect(pushSkill("broken", { rootDir: root, client })).rejects.toThrow(/is not valid and was not published/);
        // Nothing reached the server.
        expect((await client.listSkills()).some((skill) => skill.name === "broken")).toBe(false);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a top-level .env stops the push outright, at the validation layer", async () => {
    const root = makeCorpus({
      "release-notes": { ...VALID_SKILL, ".env": "OPENAI_API_KEY=would-have-leaked\n" },
    });
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(TOKEN, ctx.baseUrl);
        const error = await pushSkill("release-notes", { rootDir: root, client }).catch((e) => e);
        expect(error).toBeInstanceOf(PushSkillError);
        expect((error as PushSkillError).detail?.join(" ")).toMatch(/Reserved file '\.env'/);
        expect((await client.listSkills()).some((skill) => skill.name === "release-notes")).toBe(false);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("credential files validation does not reach are still never uploaded", async () => {
    // validateSkillDirectory()'s reserved-file check is TOP LEVEL ONLY and matches the
    // exact name `.env`. Everything below passes validation, so if the packer did not
    // exclude it, `skills push` would publish live credentials to a server other people
    // can read. This is the layer that stops that.
    const root = makeCorpus({
      "release-notes": {
        ...VALID_SKILL,
        ".env.local": "OPENAI_API_KEY=local-would-have-leaked\n",
        ".env.production": "STRIPE_SECRET=prod-would-have-leaked\n",
        "references/.env": "NESTED_TOKEN=nested-would-have-leaked\n",
        "references/.npmrc": "//registry.npmjs.org/:_authToken=npmrc-would-have-leaked\n",
        ".env.example": "OPENAI_API_KEY=\n",
      },
    });
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(TOKEN, ctx.baseUrl);
        const result = await pushSkill("release-notes", { rootDir: root, client });
        expect(result.published).toBe(true);
        expect(result.paths).toContain(".env.example");
        for (const leak of [".env.local", ".env.production", "references/.env", "references/.npmrc"]) {
          expect(result.paths).not.toContain(leak);
        }

        // Assert on what the SERVER holds, not on the client's report of what it sent.
        // A packer that reported the right path list while still writing the bytes would
        // satisfy a path-only assertion.
        const entries = unpackSkillBundle(new Uint8Array(await (await client.downloadSkillBundle("release-notes")).arrayBuffer()));
        const stored = entries.map((entry) => new TextDecoder().decode(entry.bytes)).join("\n");
        for (const secret of ["local-would-have-leaked", "prod-would-have-leaked", "nested-would-have-leaked", "npmrc-would-have-leaked"]) {
          expect(stored).not.toContain(secret);
        }
        // Anti-vacuity: the bundle is not empty and does contain the real content, so the
        // four assertions above are not passing because nothing was stored at all.
        expect(stored).toContain("release notes");
        expect(entries.map((entry) => entry.path)).toContain(".env.example");
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("--dry-run packs and reports without uploading", async () => {
    const root = makeCorpus({ "release-notes": VALID_SKILL });
    try {
      await withServer(async (ctx) => {
        const client = new RemoteSkillsClient(TOKEN, ctx.baseUrl);
        const result = await pushSkill("release-notes", { rootDir: root, client, dryRun: true });
        expect(result.published).toBe(false);
        expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(result.fileCount).toBe(6);
        expect((await client.listSkills()).some((skill) => skill.name === "release-notes")).toBe(false);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("names the problem when the skill is not in the corpus", async () => {
    const root = makeCorpus({ "release-notes": VALID_SKILL });
    try {
      await expect(pushSkill("no-such-skill", { rootDir: root, client: null })).rejects.toThrow(/not found in the local corpus/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("names the problem when no API key is configured", async () => {
    const root = makeCorpus({ "release-notes": VALID_SKILL });
    try {
      const error = await pushSkill("release-notes", { rootDir: root, client: null }).catch((e) => e);
      expect(error).toBeInstanceOf(PushSkillError);
      expect(error.message).toMatch(/No API key configured/);
      // Actionable, not just a refusal.
      expect((error as PushSkillError).detail?.join(" ")).toMatch(/skills login/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("surfaces a server rejection instead of reporting success", async () => {
    const root = makeCorpus({ "release-notes": VALID_SKILL });
    try {
      await withServer(async (ctx) => {
        const wrongKey = new RemoteSkillsClient("sk_not_a_real_key", ctx.baseUrl);
        await expect(pushSkill("release-notes", { rootDir: root, client: wrongKey })).rejects.toThrow(/failed: 401/);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
