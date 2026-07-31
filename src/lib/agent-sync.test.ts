import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  adaptSkillMdForAgent,
  agentGlobalSkillsDir,
  pointerSkillMd,
  resolveSyncAgents,
  SYNC_AGENTS,
  SYNC_MARKER_FILE,
  syncSkillsToAgents,
  writeManagedAgentSkill,
} from "./agent-sync.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

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

  test("Codex / OpenCode / Cursor strip user_invocable", () => {
    for (const agent of ["codex", "opencode", "cursor"] as const) {
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
    expect(resolveSyncAgents("codex")).toEqual(["codex"]);
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
      const { actions } = syncSkillsToAgents({ rootDir: corpus, homeDir: home });
      expect(actions).toHaveLength(SYNC_AGENTS.length);
      expect(actions.every((a) => a.action === "create")).toBe(true);

      const claudeMd = readFileSync(join(home, ".claude", "skills", "deploy-runbook", "SKILL.md"), "utf-8");
      expect(claudeMd).toContain("user_invocable: true");
      expect(existsSync(join(home, ".claude", "skills", "deploy-runbook", SYNC_MARKER_FILE))).toBe(true);

      const codexMd = readFileSync(join(home, ".codex", "skills", "deploy-runbook", "SKILL.md"), "utf-8");
      expect(codexMd).not.toContain("user_invocable");

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

  test("--force overwrites even an unmanaged skill", () => {
    const corpus = tempDir("sync-corpus-");
    const home = tempDir("sync-home-");
    try {
      seedCorpusSkill(corpus, "deploy-runbook", INSTRUCTION_MD, {
        "skill.json": JSON.stringify({ standard: "hasna.skill.v1", name: "deploy-runbook", kind: "instruction" }),
      });
      const userDir = join(home, ".claude", "skills", "deploy-runbook");
      mkdirSync(userDir, { recursive: true });
      writeFileSync(join(userDir, "SKILL.md"), "---\nname: deploy-runbook\ndescription: mine\n---\n");

      const { actions } = syncSkillsToAgents({ rootDir: corpus, homeDir: home, agents: ["claude"], force: true });
      expect(actions[0].action).toBe("update");
      expect(readFileSync(join(userDir, "SKILL.md"), "utf-8")).toContain("Deploy Runbook");
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
