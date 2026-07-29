import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pullSkills, PullSkillError, type SkillPullClient } from "./pull.js";
import { getPortableSkillsRoot } from "./portable-skills.js";
import { clearRegistryCache, loadRegistryProfile } from "./registry.js";
import { MissingApiUrlError } from "./api-url.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * A stand-in for RemoteSkillsClient that answers from an in-memory table, so the
 * corpus-writing and enumeration behaviour of `pullSkills` can be tested without a
 * network or an origin. The real HTTP path is exercised end-to-end in pull.e2e.test.ts.
 */
function fakeClient(
  skills: Record<string, { md: string | null; meta?: Record<string, unknown> }>,
  listing?: unknown[],
): SkillPullClient {
  return {
    async listSkills() {
      return listing ?? Object.keys(skills).map((slug) => ({ slug, name: slug }));
    },
    async getSkill(slug: string) {
      return skills[slug]?.meta ?? null;
    },
    async getSkillMd(slug: string) {
      return skills[slug]?.md ?? null;
    },
  };
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "skills-pull-corpus-"));
}

const INSTRUCTION_MD =
  "---\nname: pulled-runbook\ndescription: The team deploy runbook\nkind: instruction\ncategory: Development Tools\ntags:\n  - ops\n  - deploy\n---\n\n# Pulled Runbook\n\nStep one. Step two.\n";

describe("pullSkills", () => {
  test("writes a pulled skill into the corpus with SKILL.md and skill.json", () => {
    const root = tempRoot();
    try {
      return pullSkills({
        names: ["pulled-runbook"],
        rootDir: root,
        client: fakeClient({
          "pulled-runbook": {
            md: INSTRUCTION_MD,
            meta: { kind: "instruction", category: "Development Tools", tags: ["ops", "deploy"], version: "2.0.0", description: "The team deploy runbook" },
          },
        }),
      }).then(({ results }) => {
        expect(results).toHaveLength(1);
        const [result] = results;
        expect(result.success).toBe(true);
        expect(result.name).toBe("pulled-runbook");
        expect(result.kind).toBe("instruction");
        expect(result.created).toBe(true);

        const skillDir = join(root, "pulled-runbook");
        expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
        expect(existsSync(join(skillDir, "skill.json"))).toBe(true);

        // SKILL.md is written verbatim — it is the agent-facing artifact.
        expect(readFileSync(join(skillDir, "SKILL.md"), "utf-8")).toBe(INSTRUCTION_MD);

        const manifest = JSON.parse(readFileSync(join(skillDir, "skill.json"), "utf-8"));
        expect(manifest.name).toBe("pulled-runbook");
        expect(manifest.kind).toBe("instruction");
        expect(manifest.version).toBe("2.0.0");
        expect(manifest.category).toBe("Development Tools");
        expect(manifest.tags).toEqual(["ops", "deploy"]);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("re-pulling the same skill is idempotent", async () => {
    const root = tempRoot();
    try {
      const client = fakeClient({ "pulled-runbook": { md: INSTRUCTION_MD, meta: { kind: "instruction" } } });
      const first = await pullSkills({ names: ["pulled-runbook"], rootDir: root, client });
      const skillDir = join(root, "pulled-runbook");
      const mdAfterFirst = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
      const jsonAfterFirst = readFileSync(join(skillDir, "skill.json"), "utf-8");

      const second = await pullSkills({ names: ["pulled-runbook"], rootDir: root, client });

      expect(first.results[0].created).toBe(true);
      expect(second.results[0].created).toBe(false);
      expect(second.results[0].success).toBe(true);
      // Same bytes on a re-pull: nothing drifts.
      expect(readFileSync(join(skillDir, "SKILL.md"), "utf-8")).toBe(mdAfterFirst);
      expect(readFileSync(join(skillDir, "skill.json"), "utf-8")).toBe(jsonAfterFirst);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("honours $HASNA_SKILLS_DIR for the corpus path", async () => {
    // The hermetic preload points $HASNA_SKILLS_DIR at a per-test temp dir, so pulling
    // with no explicit rootDir must land under getPortableSkillsRoot() — proving the
    // env override is honoured rather than a hard-coded $HOME path.
    const { results } = await pullSkills({
      names: ["pulled-runbook"],
      client: fakeClient({ "pulled-runbook": { md: INSTRUCTION_MD, meta: { kind: "instruction" } } }),
    });
    expect(results[0].success).toBe(true);
    const expected = join(getPortableSkillsRoot(), "pulled-runbook");
    expect(results[0].path).toBe(expected);
    expect(existsSync(join(expected, "SKILL.md"))).toBe(true);
  });

  test("a pulled skill is surfaced by loadRegistry (the CLI list --all / MCP list_skills path)", async () => {
    await pullSkills({
      names: ["pulled-runbook"],
      client: fakeClient({ "pulled-runbook": { md: INSTRUCTION_MD, meta: { kind: "instruction" } } }),
    });
    // Both `skills list --all` and the MCP `list_skills` tool read loadRegistryProfile("all").
    clearRegistryCache();
    const all = loadRegistryProfile("all");
    const found = all.find((skill) => skill.name === "pulled-runbook");
    expect(found).toBeDefined();
    expect(found?.kind).toBe("instruction");
    // It is NOT in the curated basic profile (custom/pulled skills are gated out of it).
    expect(loadRegistryProfile("basic").some((s) => s.name === "pulled-runbook")).toBe(false);
  });

  test("--all enumerates every skill the instance serves", async () => {
    const root = tempRoot();
    try {
      const { results } = await pullSkills({
        all: true,
        rootDir: root,
        client: fakeClient({
          alpha: { md: "---\nname: alpha\ndescription: A\nkind: instruction\n---\n# A\n" },
          beta: { md: "---\nname: beta\ndescription: B\nkind: instruction\n---\n# B\n" },
        }),
      });
      expect(results.map((r) => r.name).sort()).toEqual(["alpha", "beta"]);
      expect(results.every((r) => r.success)).toBe(true);
      expect(existsSync(join(root, "alpha", "SKILL.md"))).toBe(true);
      expect(existsSync(join(root, "beta", "SKILL.md"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports a clear failure when the instance has no such skill", async () => {
    const root = tempRoot();
    try {
      const { results } = await pullSkills({
        names: ["missing-skill"],
        rootDir: root,
        client: fakeClient({}),
      });
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain("not found");
      expect(existsSync(join(root, "missing-skill"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("requires at least one name or --all", async () => {
    await expect(
      pullSkills({ client: fakeClient({}) }),
    ).rejects.toBeInstanceOf(PullSkillError);
  });

  test("fails closed with MissingApiUrlError when no instance origin is configured", async () => {
    // A key is present but no origin: the client must refuse to invent a host.
    const savedUrl = process.env.SKILLS_API_URL;
    const savedKey = process.env.SKILLS_API_KEY;
    delete process.env.SKILLS_API_URL;
    process.env.SKILLS_API_KEY = "sk_test_key";
    try {
      await expect(pullSkills({ names: ["pulled-runbook"] })).rejects.toBeInstanceOf(MissingApiUrlError);
    } finally {
      if (savedUrl === undefined) delete process.env.SKILLS_API_URL;
      else process.env.SKILLS_API_URL = savedUrl;
      if (savedKey === undefined) delete process.env.SKILLS_API_KEY;
      else process.env.SKILLS_API_KEY = savedKey;
    }
  });

  test("errors clearly when no API key is available to reach the instance", async () => {
    // client: null models createRemoteSkillsClient() finding no credential.
    await expect(pullSkills({ names: ["x"], client: null })).rejects.toBeInstanceOf(PullSkillError);
  });
});
