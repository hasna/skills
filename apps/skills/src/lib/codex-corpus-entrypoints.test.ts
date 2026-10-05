import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KernelLock } from "@hasna/contracts/kernel-lock";
import { adoptUnmarkedHomes, pruneStrayHomes } from "./home-adoption.js";
import { corpusFixture, assertPublication } from "./codex-corpus.fixture.js";

function selection(enrolled = true, marked = true, agent = "codex") {
  const f = corpusFixture(enrolled), dir = join(f.home, `.${agent}/skills/stray`), corpus = join(f.home, "corpus");
  mkdirSync(dir, { recursive: true }); mkdirSync(join(corpus, marked ? "retained" : "stray"), { recursive: true });
  const content = "---\nname: stray\ndescription: synthetic test\n---\nSynthetic instruction.\n";
  writeFileSync(join(dir, "SKILL.md"), content);
  writeFileSync(join(corpus, marked ? "retained" : "stray", "SKILL.md"), content);
  if (marked) writeFileSync(join(dir, ".hasna-skills.json"), JSON.stringify({ managedBy: "@hasna/skills", skill: "stray", source: "synthetic", syncedAt: "2026-10-05T00:00:00Z" }));
  return { ...f, dir, corpus, options: { ...f.options, homeDir: f.home, rootDir: corpus, agents: [agent as "codex" | "claude"], apply: true } };
}

for (const mode of ["prune", "adopt"] as const) {
  for (const state of ["exclusive", "unenrolled", "pending"] as const) test(`${mode} refuses ${state} before any rollback or corpus write`, () => {
    const f = selection(state !== "unenrolled", mode === "prune");
    const blocker = state === "exclusive" ? new KernelLock(f.root, ".native-corpus-admission", { existingOnly: true }) : undefined;
    if (blocker) expect(blocker.trySync(1000)).toBe(true);
    if (state === "pending") writeFileSync(join(f.root, "fixture-mode"), "pending");
    try {
      expect(() => mode === "prune" ? pruneStrayHomes(f.options) : adoptUnmarkedHomes(f.options)).toThrow("CODEX_CORPUS");
      expect(existsSync(f.dir)).toBe(true);
      expect(existsSync(join(f.dir, ".hasna-skills.json"))).toBe(mode === "prune");
      expect(existsSync(join(f.home, ".hasna/skills/rollback"))).toBe(false);
    } finally { blocker?.close(); }
  });
  test(`actual sync --${mode} CLI refuses an exclusive publisher`, () => {
    const f = selection(true, mode === "prune"), blocker = new KernelLock(f.root, ".native-corpus-admission", { existingOnly: true });
    try {
      expect(blocker.trySync(1000)).toBe(true);
      const result = spawnSync(process.execPath, ["--no-env-file", "--no-install", new URL("../cli/index.tsx", import.meta.url).pathname,
        "sync", `--${mode}`, "--apply", "--for", "codex", "--source", f.corpus, "--json"],
      { cwd: f.home, env: { ...process.env, HOME: f.home, CODEX_HOME: "" }, encoding: "utf8", timeout: 10000 });
      expect(result.status).toBe(1); expect(result.stdout).toContain("CODEX_CORPUS");
      expect(existsSync(f.dir)).toBe(true);
      expect(existsSync(join(f.dir, ".hasna-skills.json"))).toBe(mode === "prune");
      expect(existsSync(join(f.home, ".hasna/skills/rollback"))).toBe(false);
    } finally { blocker.close(); }
  });
  test(`${mode} completes under admission and leaves non-Codex homes usable`, () => {
    const f = selection(true, mode === "prune");
    const result = mode === "prune" ? pruneStrayHomes(f.options) : adoptUnmarkedHomes(f.options);
    expect(result.rollbackFile).toBeDefined(); expect(readFileSync(result.rollbackFile!, "utf8")).toContain(`"mode": "${mode}"`);
    expect(existsSync(f.dir)).toBe(mode === "adopt"); assertPublication(f.root, true);
    const ordinary = selection(false, mode === "prune", "claude");
    expect(() => mode === "prune" ? pruneStrayHomes(ordinary.options) : adoptUnmarkedHomes(ordinary.options)).not.toThrow();
  });
}
