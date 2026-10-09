import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  adaptSkillMdForAgent,
  agentGlobalSkillsDir,
  isPointerSkillMd,
  pointerSkillMd,
  resolveSyncAgents,
  resolveSyncCorpus,
  SYNC_AGENTS,
  SYNC_MARKER_FILE,
  syncSkillsToAgents,
  writeManagedAgentSkill,
  writeManagedSkillDir,
} from "./agent-sync.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); });

/**
 * The repo package root: the canonical public-corpus source a checkout provides
 * (`skills/` below it). The npm package ships no bundled corpus, so the checkout is
 * the source for public skills. The private agent-workflow skills are NOT exercised
 * through the repo anymore — they moved to the private per-station store (owner ruling
 * 2026-08-15) — so the tests that need a named workflow skill seed a temp corpus.
 */
const REPO_ROOT = join(import.meta.dir, "..", "..");

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Seed a corpus (the directory listPortableSkills reads) with one skill. */
function seedCorpusSkill(
  root: string,
  name: string,
  skillMd: string,
  extra: Record<string, string> = {},
): void {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), skillMd);
  for (const [file, content] of Object.entries(extra)) {
    const target = join(dir, file);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
}

const INSTRUCTION_MD =
  "---\nname: deploy-runbook\ndescription: The team deploy runbook\nkind: instruction\nuser_invocable: true\n---\n\n# Deploy Runbook\n\nStep one.\n";

/** Seed a temp corpus with the `inbox` workflow skill shape (SKILL.md + helper). */
function seedInboxCorpus(corpus: string): void {
  seedCorpusSkill(corpus, "inbox", INBOX_MD, {
    "skill.json": JSON.stringify({ standard: "hasna.skill.v1", name: "inbox", kind: "instruction" }),
    "scripts/inbox": INBOX_HELPER_BYTES,
  });
}

const INBOX_MD =
  "---\nname: inbox\ndescription: Interactive Session Inbox\nkind: instruction\nuser_invocable: true\n---\n\n# inbox — Interactive Session Inbox\n\nSession-scoped inbox watch.\n";
const INBOX_HELPER_BYTES = "SEED_INBOX_HELPER_BYTES\n";

describe("adaptSkillMdForAgent", () => {
  test("Claude keeps user_invocable in frontmatter", () => {
    const out = adaptSkillMdForAgent(INSTRUCTION_MD, "claude");
    expect(out).toMatch(/^---\r?\n[\s\S]*user_invocable:\s*true[\s\S]*?\n---/);
  });

  test("Claude adds user_invocable when the source lacks it", () => {
    const withoutFlag = "---\nname: x\ndescription: y\nkind: instruction\n---\n\n# X\n";
    const out = adaptSkillMdForAgent(withoutFlag, "claude");
    expect(out).toContain("user_invocable: true");
  });

  test("Codewith / Codex / OpenCode / Cursor strip user_invocable", () => {
    for (const agent of ["codewith", "codex", "opencode", "cursor"] as const) {
      const out = adaptSkillMdForAgent(INSTRUCTION_MD, agent);
      expect(out).not.toContain("user_invocable");
      // Body is preserved verbatim.
      expect(out).toContain("# Deploy Runbook");
      expect(out).toContain("Step one.");
    }
  });
});

describe("agentGlobalSkillsDir", () => {
  test("resolves per-tool global paths under a given home", () => {
    const home = "/home/somebody";
    expect(agentGlobalSkillsDir("claude", home)).toBe(join(home, ".claude", "skills"));
    expect(agentGlobalSkillsDir("codewith", home)).toBe(join(home, ".codewith", "skills"));
    expect(agentGlobalSkillsDir("codex", home)).toBe(join(home, ".codex", "skills"));
    expect(agentGlobalSkillsDir("cursor", home)).toBe(join(home, ".cursor", "skills"));
    expect(agentGlobalSkillsDir("opencode", home)).toBe(join(home, ".config", "opencode", "skills"));
  });
});

describe("resolveSyncAgents", () => {
  test("all -> every default agent", () => {
    expect(resolveSyncAgents("all")).toEqual([...SYNC_AGENTS]);
    expect(resolveSyncAgents(undefined)).toEqual([...SYNC_AGENTS]);
  });
  test("a single named agent", () => {
    expect(resolveSyncAgents("codewith")).toEqual(["codewith"]);
  });
  test("rejects an unknown agent", () => {
    expect(() => resolveSyncAgents("gemini")).toThrow("Unknown agent");
  });
});

describe("syncSkillsToAgents", () => {
  test("dry-run lists intended writes and touches nothing on disk", () => {
    const corpus = tempDir("sync-corpus-");
    const home = tempDir("sync-home-");
    try {
      seedCorpusSkill(corpus, "deploy-runbook", INSTRUCTION_MD, {
        "skill.json": JSON.stringify({ standard: "hasna.skill.v1", name: "deploy-runbook", kind: "instruction" }),
      });
      const { actions } = syncSkillsToAgents({ rootDir: corpus, homeDir: home, dryRun: true, agents: ["claude", "codex"] });
      expect(actions).toHaveLength(2);
      expect(actions.every((a) => a.action === "create")).toBe(true);
      // Nothing written.
      expect(existsSync(join(home, ".claude", "skills", "deploy-runbook", "SKILL.md"))).toBe(false);
      expect(existsSync(join(home, ".codex", "skills", "deploy-runbook", "SKILL.md"))).toBe(false);
    } finally {
      rmSync(corpus, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a real sync writes per-tool-adapted SKILL.md into each agent folder plus a marker", () => {
    const corpus = tempDir("sync-corpus-");
    const home = tempDir("sync-home-");
    try {
      seedCorpusSkill(corpus, "deploy-runbook", INSTRUCTION_MD, {
        "skill.json": JSON.stringify({ standard: "hasna.skill.v1", name: "deploy-runbook", kind: "instruction" }),
      });
      admitCorpusFixture(join(home, ".codex"));
      const { actions } = syncSkillsToAgents({ rootDir: corpus, homeDir: home });
      expect(actions).toHaveLength(SYNC_AGENTS.length);
      expect(actions.every((a) => a.action === "create")).toBe(true);

      const claudeMd = readFileSync(join(home, ".claude", "skills", "deploy-runbook", "SKILL.md"), "utf-8");
      expect(claudeMd).toContain("user_invocable: true");
      expect(existsSync(join(home, ".claude", "skills", "deploy-runbook", SYNC_MARKER_FILE))).toBe(true);

      const codexMd = readFileSync(join(home, ".codex", "skills", "deploy-runbook", "SKILL.md"), "utf-8");
      expect(codexMd).not.toContain("user_invocable");

      const codewithMd = readFileSync(join(home, ".codewith", "skills", "deploy-runbook", "SKILL.md"), "utf-8");
      expect(codewithMd).not.toContain("user_invocable");

      const openCodeMd = readFileSync(join(home, ".config", "opencode", "skills", "deploy-runbook", "SKILL.md"), "utf-8");
      expect(openCodeMd).not.toContain("user_invocable");
    } finally {
      rmSync(corpus, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("re-syncing a managed skill updates it in place (idempotent)", () => {
    const corpus = tempDir("sync-corpus-");
    const home = tempDir("sync-home-");
    try {
      seedCorpusSkill(corpus, "deploy-runbook", INSTRUCTION_MD, {
        "skill.json": JSON.stringify({ standard: "hasna.skill.v1", name: "deploy-runbook", kind: "instruction" }),
      });
      const first = syncSkillsToAgents({ rootDir: corpus, homeDir: home, agents: ["claude"] });
      const second = syncSkillsToAgents({ rootDir: corpus, homeDir: home, agents: ["claude"] });
      expect(first.actions[0].action).toBe("create");
      expect(second.actions[0].action).toBe("update");
    } finally {
      rmSync(corpus, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("never clobbers a hand-authored (unmanaged) agent skill", () => {
    const corpus = tempDir("sync-corpus-");
    const home = tempDir("sync-home-");
    try {
      seedCorpusSkill(corpus, "deploy-runbook", INSTRUCTION_MD, {
        "skill.json": JSON.stringify({ standard: "hasna.skill.v1", name: "deploy-runbook", kind: "instruction" }),
      });
      // A pre-existing, user-authored skill with NO marker.
      const userDir = join(home, ".claude", "skills", "deploy-runbook");
      mkdirSync(userDir, { recursive: true });
      const userContent = "---\nname: deploy-runbook\ndescription: MINE, do not touch\n---\n\n# Mine\n";
      writeFileSync(join(userDir, "SKILL.md"), userContent);

      const { actions } = syncSkillsToAgents({ rootDir: corpus, homeDir: home, agents: ["claude"] });
      expect(actions[0].action).toBe("skip");
      expect(actions[0].reason).toContain("hand-authored");
      // Untouched.
      expect(readFileSync(join(userDir, "SKILL.md"), "utf-8")).toBe(userContent);
      expect(existsSync(join(userDir, SYNC_MARKER_FILE))).toBe(false);
    } finally {
      rmSync(corpus, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("never adopts an unmanaged directory without SKILL.md, even with --force", () => {
    for (const force of [false, true]) {
      const corpus = tempDir("sync-corpus-");
      const home = tempDir("sync-home-");
      try {
        seedInboxCorpus(corpus);
        const userDir = join(home, ".codewith", "skills", "inbox");
        const helperPath = join(userDir, "scripts", "inbox");
        mkdirSync(join(userDir, "scripts"), { recursive: true });
        writeFileSync(helperPath, "USER_BYTES");

        const { actions } = syncSkillsToAgents({
          rootDir: corpus,
          homeDir: home,
          names: ["inbox"],
          agents: ["codewith"],
          force,
        });

        expect(actions).toEqual([{
          skill: "inbox",
          agent: "codewith",
          path: join(userDir, "SKILL.md"),
          action: "skip",
          reason: "an unmanaged directory already exists here without SKILL.md; refusing to overwrite or adopt it",
        }]);
        expect(readFileSync(helperPath, "utf-8")).toBe("USER_BYTES");
        expect(existsSync(join(userDir, "SKILL.md"))).toBe(false);
        expect(existsSync(join(userDir, SYNC_MARKER_FILE))).toBe(false);
      } finally {
        rmSync(corpus, { recursive: true, force: true });
        rmSync(home, { recursive: true, force: true });
      }
    }
  });

  test("--force adopts an unmanaged skill with SKILL.md as an exact managed mirror", () => {
    const corpus = tempDir("sync-corpus-");
    const home = tempDir("sync-home-");
    try {
      seedInboxCorpus(corpus);
      const userDir = join(home, ".codewith", "skills", "inbox");
      const helperPath = join(userDir, "scripts", "inbox");
      mkdirSync(join(userDir, "scripts"), { recursive: true });
      writeFileSync(join(userDir, "SKILL.md"), "---\nname: inbox\ndescription: mine\n---\n");
      writeFileSync(helperPath, "USER_BYTES");
      writeFileSync(join(userDir, "obsolete.txt"), "remove me");

      const { actions } = syncSkillsToAgents({
        rootDir: corpus,
        homeDir: home,
        names: ["inbox"],
        agents: ["codewith"],
        sourceDir: corpus,
        force: true,
      });
      expect(actions[0].action).toBe("update");
      expect(readFileSync(join(userDir, "SKILL.md"), "utf-8")).toContain("# inbox — Interactive Session Inbox");
      expect(readFileSync(helperPath, "utf-8")).toBe(
        readFileSync(join(corpus, "inbox", "scripts", "inbox"), "utf-8"),
      );
      expect(existsSync(join(userDir, "obsolete.txt"))).toBe(false);
      expect(existsSync(join(userDir, SYNC_MARKER_FILE))).toBe(true);
    } finally {
      rmSync(corpus, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("executable skills sync as a pointer, not their runnable SKILL.md", () => {
    const corpus = tempDir("sync-corpus-");
    const home = tempDir("sync-home-");
    try {
      const execMd = "---\nname: pdf-tool\ndescription: Make a PDF\nkind: executable\n---\n\n# PDF Tool\n\nInternal build notes that should NOT reach an agent folder.\n";
      seedCorpusSkill(corpus, "pdf-tool", execMd, {
        "skill.json": JSON.stringify({ standard: "hasna.skill.v1", name: "pdf-tool", kind: "executable" }),
      });
      admitCorpusFixture(join(home, ".codex"));
      const { actions } = syncSkillsToAgents({ rootDir: corpus, homeDir: home, agents: ["codex"] });
      expect(actions[0].action).toBe("create");
      const synced = readFileSync(join(home, ".codex", "skills", "pdf-tool", "SKILL.md"), "utf-8");
      expect(synced).toContain("executable skill from the @hasna/skills catalog");
      expect(synced).toContain("skills run pdf-tool");
      expect(synced).not.toContain("Internal build notes");
    } finally {
      rmSync(corpus, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a kind-less content-bearing skill synced into a fresh home writes the full body, not a pointer stub", () => {
    // Regression for P-01641 (task 568efaaa): an ABSENT `kind` was coerced to
    // `executable`, so corpus-mode sync distributed a pointer stub on the CREATE path
    // and the full body was discarded (claude-code-deepseek 6541B -> 465B, merge-pr
    // 7143B -> 629B). Only an explicit `kind: executable` may produce a stub.
    const corpus = tempDir("sync-corpus-");
    const home = tempDir("sync-home-");
    try {
      const fullMd = "---\nname: claude-code-deepseek\ndescription: Deepseek through Claude Code\n---\n\n# Claude Code Deepseek\n\nLong-form body that must reach the agent folder in full, never a 15-line pointer.\n";
      // No kind in frontmatter and no kind in skill.json: the laundering shape.
      seedCorpusSkill(corpus, "claude-code-deepseek", fullMd, {
        "skill.json": JSON.stringify({ standard: "hasna.skill.v1", name: "claude-code-deepseek" }),
      });
      const { actions } = syncSkillsToAgents({ rootDir: corpus, homeDir: home, agents: ["claude"] });
      expect(actions).toHaveLength(1);
      expect(actions[0].action).toBe("create");
      const synced = readFileSync(join(home, ".claude", "skills", "claude-code-deepseek", "SKILL.md"), "utf-8");
      expect(synced).toContain("Long-form body that must reach the agent folder in full, never a 15-line pointer.");
      expect(synced).not.toContain("This is an executable skill from the @hasna/skills catalog");
      expect(synced).not.toMatch(/^kind:\s*executable\b/m);
    } finally {
      rmSync(corpus, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("sync refuses to replace a content-bearing managed home with an executable pointer stub", () => {
    // Regression for O15-00102 (task 60f2ab27): a corpus skill synced over an adopted
    // full-content managed home, replacing it with a 15-line pointer stub at rc=0 with
    // no warning. The corpus entry DECLARES kind: executable — the one shape that still
    // yields a pointer (an absent kind is content, see P-01641 / task 568efaaa).
    const corpus = tempDir("sync-corpus-");
    const home = tempDir("sync-home-");
    try {
      const fullMd = "---\nname: oss-pr-zero-drain\ndescription: Drain the PR queues\nkind: executable\n---\n\n# OSS PR-Zero Drain\n\nFull content that must survive.\n";
      // Declared executable in frontmatter AND skill.json: a genuine declaration.
      seedCorpusSkill(corpus, "oss-pr-zero-drain", fullMd, {
        "skill.json": JSON.stringify({ standard: "hasna.skill.v1", name: "oss-pr-zero-drain", kind: "executable" }),
      });
      const homeDir = join(home, ".claude", "skills", "oss-pr-zero-drain");
      mkdirSync(homeDir, { recursive: true });
      // The managed home holds the FULL content (adopted state, marker present).
      writeFileSync(join(homeDir, "SKILL.md"), fullMd);
      writeFileSync(join(homeDir, SYNC_MARKER_FILE), JSON.stringify({ managedBy: "@hasna/skills", skill: "oss-pr-zero-drain", source: "adopted", syncedAt: "2026-08-15T00:00:00.000Z" }));

      const { actions } = syncSkillsToAgents({ rootDir: corpus, homeDir: home, agents: ["claude"] });

      expect(actions).toHaveLength(1);
      expect(actions[0].action).toBe("skip");
      expect(actions[0].reason).toContain("pointer stub");
      // The full content is untouched; the marker survives.
      expect(readFileSync(join(homeDir, "SKILL.md"), "utf-8")).toBe(fullMd);
      expect(existsSync(join(homeDir, SYNC_MARKER_FILE))).toBe(true);
    } finally {
      rmSync(corpus, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a named workflow skill syncs its complete bundled directory", () => {
    const corpus = tempDir("sync-corpus-");
    const home = tempDir("sync-home-");
    try {
      seedInboxCorpus(corpus);
      const { actions } = syncSkillsToAgents({
        rootDir: corpus,
        homeDir: home,
        names: ["inbox"],
        agents: ["codewith"],
        sourceDir: corpus,
      });
      const skillDir = join(home, ".codewith", "skills", "inbox");
      const skillPath = join(skillDir, "SKILL.md");
      const helperPath = join(skillDir, "scripts", "inbox");

      expect(actions).toEqual([{
        skill: "inbox",
        agent: "codewith",
        path: skillPath,
        action: "create",
      }]);
      expect(existsSync(skillPath)).toBe(true);
      const synced = existsSync(skillPath) ? readFileSync(skillPath, "utf-8") : "";
      expect(synced).toContain("# inbox — Interactive Session Inbox");
      expect(synced).not.toContain("user_invocable");
      expect(existsSync(helperPath)).toBe(true);
      expect(readFileSync(helperPath, "utf-8")).toBe(
        readFileSync(join(corpus, "inbox", "scripts", "inbox"), "utf-8"),
      );
    } finally {
      rmSync(corpus, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a named skill absent from the corpus is reported as skipped, not written", () => {
    const corpus = tempDir("sync-corpus-");
    const home = tempDir("sync-home-");
    try {
      const { actions } = syncSkillsToAgents({ rootDir: corpus, homeDir: home, names: ["ghost"], agents: ["claude"] });
      expect(actions).toHaveLength(1);
      expect(actions[0].action).toBe("skip");
      expect(actions[0].reason).toContain("not found");
      expect(existsSync(join(home, ".claude", "skills", "ghost"))).toBe(false);
    } finally {
      rmSync(corpus, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("rejects an invalid named skill before corpus migration or agent writes", () => {
    const home = tempDir("sync-home-");
    try {
      seedCorpusSkill(
        join(home, ".hasna", "skills"),
        "legacy-skill",
        "---\nname: legacy-skill\ndescription: Legacy skill\n---\n",
      );

      expect(() => syncSkillsToAgents({
        homeDir: home,
        names: ["../../skills/todos-plan"],
        agents: ["codewith"],
      })).toThrow("Invalid skill name");
      expect(() => syncSkillsToAgents({
        homeDir: home,
        names: ["../nested/skill-name"],
        agents: ["codewith"],
      })).toThrow("Invalid skill name");

      expect(existsSync(join(home, ".hasna", "skills", "installed", "legacy-skill", "SKILL.md"))).toBe(false);
      expect(existsSync(join(home, "skills", "todos-plan", "SKILL.md"))).toBe(false);
      expect(existsSync(join(home, ".codewith", "skills", "todos-plan", "SKILL.md"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("isPointerSkillMd", () => {
  test("recognises a sync pointer stub", () => {
    expect(isPointerSkillMd(pointerSkillMd("my-skill", "Does a thing"))).toBe(true);
  });

  test("recognises an agent-adapted pointer stub (user_invocable inserted)", () => {
    const adapted = adaptSkillMdForAgent(pointerSkillMd("my-skill", "Does a thing"), "claude");
    expect(adapted).toContain("user_invocable: true");
    expect(isPointerSkillMd(adapted)).toBe(true);
  });

  test("rejects a full-content skill document", () => {
    const full = "---\nname: my-skill\ndescription: Real content\nkind: instruction\n---\n\n# My Skill\n\nReal body.\n";
    expect(isPointerSkillMd(full)).toBe(false);
  });

  test("rejects content that merely mentions the catalog sentence without the pointer shape", () => {
    const prose = "---\nname: my-skill\ndescription: Prose\n---\n\nThis is an executable skill from the @hasna/skills catalog. But this is real body text, not a pointer.\n";
    expect(isPointerSkillMd(prose)).toBe(false);
  });
});

describe("writeManagedAgentSkill", () => {
  test("pointerSkillMd carries name, description, and run guidance", () => {
    const md = pointerSkillMd("my-skill", "Does a thing");
    expect(md).toContain("name: my-skill");
    expect(md).toContain("Does a thing");
    expect(md).toContain("skills run my-skill");
  });

  test("writes a marker so a later sync recognises its own output", () => {
    const home = tempDir("sync-home-");
    try {
      const first = writeManagedAgentSkill({ skill: "s", agent: "cursor", skillMd: "---\nname: s\ndescription: d\n---\n", homeDir: home });
      expect(first.action).toBe("create");
      const markerPath = join(home, ".cursor", "skills", "s", SYNC_MARKER_FILE);
      expect(existsSync(markerPath)).toBe(true);
      const marker = JSON.parse(readFileSync(markerPath, "utf-8"));
      expect(marker.managedBy).toBe("@hasna/skills");
      const second = writeManagedAgentSkill({ skill: "s", agent: "cursor", skillMd: "---\nname: s\ndescription: d2\n---\n", homeDir: home });
      expect(second.action).toBe("update");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("writeManagedSkillDir", () => {
  test("managed updates exactly mirror the current source and remove stale resources", () => {
    const root = tempDir("sync-managed-dir-");
    try {
      const target = join(root, "target");
      const sourceV1 = join(root, "source-v1");
      const sourceV2 = join(root, "source-v2");
      mkdirSync(join(sourceV1, "scripts"), { recursive: true });
      mkdirSync(join(sourceV2, "scripts"), { recursive: true });
      writeFileSync(join(sourceV1, "SKILL.md"), "source v1");
      writeFileSync(join(sourceV1, "scripts", "obsolete"), "obsolete");
      writeFileSync(join(sourceV1, "scripts", "current"), "current v1");
      writeFileSync(join(sourceV2, "SKILL.md"), "source v2");
      writeFileSync(join(sourceV2, "scripts", "current"), "current v2");

      const first = writeManagedSkillDir(target, "adapted v1", {
        skill: "managed",
        source: "bundled",
        resourceDir: sourceV1,
      });
      const second = writeManagedSkillDir(target, "adapted v2", {
        skill: "managed",
        source: "bundled",
        resourceDir: sourceV2,
      });

      expect(first.action).toBe("create");
      expect(second.action).toBe("update");
      expect(readFileSync(join(target, "SKILL.md"), "utf-8")).toBe("adapted v2\n");
      expect(readFileSync(join(target, "scripts", "current"), "utf-8")).toBe("current v2");
      expect(existsSync(join(target, "scripts", "obsolete"))).toBe(false);
      expect(existsSync(join(target, SYNC_MARKER_FILE))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refuses to replace a content-bearing managed home with a pointer stub", () => {
    const root = tempDir("sync-managed-dir-");
    try {
      const target = join(root, "target");
      const fullContent = "---\nname: s\ndescription: Full skill\n---\n\n# Full skill\n\nReal content.\n";
      // Seed the managed home with FULL content (adopted state, marker present).
      const first = writeManagedSkillDir(target, fullContent, { skill: "s", source: "adopted" });
      expect(first.action).toBe("create");

      const stub = pointerSkillMd("s", "Full skill");
      const second = writeManagedSkillDir(target, stub, { skill: "s", source: "corpus" });

      expect(second.action).toBe("skip");
      expect(second.reason).toContain("pointer stub");
      // The full content and marker are untouched (fullContent already ends with a newline).
      expect(readFileSync(join(target, "SKILL.md"), "utf-8")).toBe(fullContent);
      expect(existsSync(join(target, SYNC_MARKER_FILE))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("stub-over-content refusal is overridable with --force", () => {
    const root = tempDir("sync-managed-dir-");
    try {
      const target = join(root, "target");
      const fullContent = "---\nname: s\ndescription: Full skill\n---\n\n# Full skill\n\nReal content.\n";
      writeManagedSkillDir(target, fullContent, { skill: "s", source: "adopted" });

      const stub = pointerSkillMd("s", "Full skill");
      const forced = writeManagedSkillDir(target, stub, { skill: "s", source: "corpus", force: true });

      expect(forced.action).toBe("update");
      // pointerSkillMd output already ends with a newline; the writer stores it verbatim.
      expect(readFileSync(join(target, "SKILL.md"), "utf-8")).toBe(stub);
      expect(existsSync(join(target, SYNC_MARKER_FILE))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("stub over an existing stub home is a normal update, not a refusal", () => {
    const root = tempDir("sync-managed-dir-");
    try {
      const target = join(root, "target");
      const stub = pointerSkillMd("s", "Full skill");
      writeManagedSkillDir(target, stub, { skill: "s", source: "corpus" });

      const reSync = writeManagedSkillDir(target, pointerSkillMd("s", "Full skill"), { skill: "s", source: "corpus" });

      expect(reSync.action).toBe("update");
      expect(readFileSync(join(target, "SKILL.md"), "utf-8")).toBe(stub);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("full content over full content is a normal update, never a refusal", () => {
    const root = tempDir("sync-managed-dir-");
    try {
      const target = join(root, "target");
      const fullContent = "---\nname: s\ndescription: Full skill\n---\n\n# Full skill\n\nReal content.\n";
      writeManagedSkillDir(target, fullContent, { skill: "s", source: "corpus" });

      const second = writeManagedSkillDir(target, fullContent + "v2\n", { skill: "s", source: "corpus" });

      expect(second.action).toBe("update");
      expect(readFileSync(join(target, "SKILL.md"), "utf-8")).toBe(fullContent + "v2\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("restores the original managed directory when the staged swap fails", () => {
    const root = tempDir("sync-managed-dir-");
    try {
      const target = join(root, "target");
      const sourceV1 = join(root, "source-v1");
      const sourceV2 = join(root, "source-v2");
      mkdirSync(sourceV1, { recursive: true });
      mkdirSync(sourceV2, { recursive: true });
      writeFileSync(join(sourceV1, "SKILL.md"), "source v1");
      writeFileSync(join(sourceV1, "original-resource"), "ORIGINAL_BYTES");
      writeFileSync(join(sourceV2, "SKILL.md"), "source v2");
      writeFileSync(join(sourceV2, "replacement-resource"), "REPLACEMENT_BYTES");

      writeManagedSkillDir(target, "adapted v1", {
        skill: "managed",
        source: "bundled",
        resourceDir: sourceV1,
      });
      const originalSkillMd = readFileSync(join(target, "SKILL.md"), "utf-8");
      const originalMarker = readFileSync(join(target, SYNC_MARKER_FILE), "utf-8");
      let renameCount = 0;

      expect(() => writeManagedSkillDir(target, "adapted v2", {
        skill: "managed",
        source: "bundled",
        resourceDir: sourceV2,
        renameDirectory: (from, to) => {
          renameCount += 1;
          if (renameCount === 2) throw new Error("synthetic swap failure");
          renameSync(from, to);
        },
      })).toThrow("synthetic swap failure");

      expect(readFileSync(join(target, "SKILL.md"), "utf-8")).toBe(originalSkillMd);
      expect(readFileSync(join(target, SYNC_MARKER_FILE), "utf-8")).toBe(originalMarker);
      expect(readFileSync(join(target, "original-resource"), "utf-8")).toBe("ORIGINAL_BYTES");
      expect(existsSync(join(target, "replacement-resource"))).toBe(false);
      expect(renameCount).toBe(3);
      expect(readdirSync(root).filter((entry) => entry.startsWith(".hasna-skills-write-"))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("resolveSyncCorpus (zero-corpus source resolution)", () => {
  function explicitSource(): string {
    const root = join(process.env.HASNA_SKILLS_DIR!, "private-package");
    const dir = join(root, "skills", "source-fixture");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: source-fixture\ndescription: Synthetic source fixture\nkind: instruction\n---\n# Fixture\n");
    return root;
  }
  test("no explicit source resolves to the installed corpus cache", () => {
    const { roots, source } = resolveSyncCorpus({ rootDir: "/tmp/nonexistent-corpus-x" });
    expect(source).toBe("corpus");
    expect(roots).toHaveLength(1);
    expect(roots[0]).toBe("/tmp/nonexistent-corpus-x");
  });

  test("an explicit sourceDir pointing at a package root resolves skills/", () => {
    const { roots, source } = resolveSyncCorpus({ sourceDir: explicitSource() });
    expect(source).toBe("source");
    // `agent-skills/` is no longer a corpus root: the fleet workflow skills moved to
    // the private per-station store and reach sync through the installed cache.
    expect(roots.map((root) => root.replace(/\\/g, "/").split("/").slice(-2).join("/"))).toEqual([
      "private-package/skills",
    ]);
  });

  test("$SKILLS_SOURCE is honoured as the ambient source", () => {
    const saved = process.env.SKILLS_SOURCE;
    process.env.SKILLS_SOURCE = explicitSource();
    try {
      const { roots, source } = resolveSyncCorpus();
      expect(source).toBe("source");
      expect(roots.length).toBeGreaterThan(0);
    } finally {
      if (saved === undefined) delete process.env.SKILLS_SOURCE;
      else process.env.SKILLS_SOURCE = saved;
    }
  });

  test("a source that contains no skills is an error, not an empty sync", () => {
    const empty = tempDir("sync-source-empty-");
    try {
      expect(() => resolveSyncCorpus({ sourceDir: empty })).toThrow(/contains no skills/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test("explicit sourceDir beats $SKILLS_SOURCE", () => {
    const saved = process.env.SKILLS_SOURCE;
    const other = tempDir("sync-source-other-");
    try {
      process.env.SKILLS_SOURCE = other;
      const { source } = resolveSyncCorpus({ sourceDir: explicitSource() });
      expect(source).toBe("source");
    } finally {
      if (saved === undefined) delete process.env.SKILLS_SOURCE;
      else process.env.SKILLS_SOURCE = saved;
      rmSync(other, { recursive: true, force: true });
    }
  });
});
