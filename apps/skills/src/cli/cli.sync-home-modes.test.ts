import { admitCorpusFixture, corpusInspectorPathFixture } from "../lib/codex-corpus.fixture.js";
import { corpusProcessGuardFixture } from "../lib/codex-corpus-guard.fixture.js";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { buildCliFixture } from "./cli-build.fixture.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-sync-home-modes-"));
const binary = process.env.SKILLS_SYNC_HOME_MODES_TEST_BIN || join(scratch, "skills.js");
beforeAll(async () => { if (!process.env.SKILLS_SYNC_HOME_MODES_TEST_BIN) await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary); });
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const document = (name: string, body = "Owned canonical body") => `---\nname: ${name}\ndescription: Owned adoption fixture\n---\n\n${body}\n`;
function put(path: string, value: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value, { mode: 0o640 }); }
function snapshot(root: string): unknown {
  const stat = lstatSync(root);
  if (stat.isFile()) return [stat.mode, stat.ino, stat.mtimeMs, sha(readFileSync(root, "utf8"))];
  if (!stat.isDirectory()) throw new Error("Unexpected fixture file");
  return [stat.mode, stat.ino, stat.mtimeMs, readdirSync(root).sort().map(name => [name, snapshot(join(root, name))])];
}
function fixture() {
  const root = mkdtempSync(join(scratch, "owned-")), home = join(root, "home"), data = join(root, "data"), source = join(root, "source", "skills"), project = join(root, "project");
  const guard = join(root, "guard.js"), denied = join(root, "denied.log");
  for (const path of [home, data, source, project, join(root, "tmp")]) mkdirSync(path, { recursive: true });
  admitCorpusFixture(join(home, ".codex"));
  const inspectorDirectory = corpusInspectorPathFixture();
  const guardSource = corpusProcessGuardFixture(join(inspectorDirectory, "codex"), [join(home, ".codex")]);
  const canary = `owned-${randomUUID()}`;
  put(join(project, "keep.txt"), canary); put(join(home, "keep.txt"), canary);
  put(guard, `import {appendFileSync} from "node:fs";import child from "node:child_process";import {syncBuiltinESMExports} from "node:module";
const deny=()=>{appendFileSync(process.env.QA_DENIED,"blocked\\n");throw new Error("SYNC_HOME_IO_DENIED")};
const original=globalThis.fetch;globalThis.fetch=(input,options)=>{if(/^https?:/.test(String(input instanceof Request?input.url:input)))return Promise.reject(deny());return original(input,options)};
${guardSource}
syncBuiltinESMExports();Bun.spawn=deny;Bun.spawnSync=deny;
`);
  const env = { HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: data, SKILLS_DATA_DIR: data,
    TMPDIR: join(root, "tmp"), PATH: inspectorDirectory, NO_COLOR: "1", TERM: "dumb", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", QA_DENIED: denied,
    HASNA_SKILLS_API_KEY_OVERRIDE: canary, HASNA_SKILLS_API_URL: "http://127.0.0.1:1" };
  const target = (name: string, agent = "codex") => join(home, `.${agent}`, "skills", name);
  const corpus = (name: string, body?: string) => put(join(source, name, "SKILL.md"), document(name, body));
  const cached = (name: string, body?: string) => put(join(data, "installed", name, "SKILL.md"), document(name, body));
  const skill = (name: string, agent = "codex", body?: string) => put(join(target(name, agent), "SKILL.md"), document(name, body));
  const mark = (name: string, agent = "codex", managedBy = "@hasna/skills") => put(join(target(name, agent), ".hasna-skills.json"), JSON.stringify({ managedBy, skill: name, source: "adopted", syncedAt: "2026-09-01T00:00:00.000Z" }) + "\n");
  corpus("alpha"); corpus("beta"); cached("alpha", "Wrong cached body"); skill("alpha"); skill("beta"); skill("alpha", "claude");
  async function cli(args: string[], readOnly = true, extra: Record<string, string> = {}) {
    const before = readOnly ? snapshot(root) : undefined, sourceBefore = snapshot(source), projectBefore = snapshot(project);
    const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, binary, ...args], { cwd: project, env: { ...env, ...extra }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    let timedOut = false; const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 10_000);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(timedOut).toBe(false); expect(stdout.length + stderr.length).toBeLessThan(32_000); expect(stdout + stderr).not.toContain(canary);
      expect(existsSync(denied)).toBe(false); expect(snapshot(source)).toEqual(sourceBefore); expect(snapshot(project)).toEqual(projectBefore);
      if (readOnly) expect(snapshot(root)).toEqual(before);
      return { stdout, stderr, exitCode };
    } finally { clearTimeout(timer); }
  }
  return { root, home, data, source, project, guard, denied, env, target, corpus, cached, skill, mark, cli };
}

test("home-mode fixture blocks HTTP and native subprocesses before CLI startup", async () => {
  const f = fixture();
  try {
    const script = `import {execFileSync} from "node:child_process";
for(const call of [()=>fetch("https://owned-sync.invalid"),()=>Bun.spawn(["/usr/bin/true"]),()=>execFileSync("/usr/bin/true")]){
 let refused=false;try{await call()}catch(error){refused=error.message==="SYNC_HOME_IO_DENIED"}if(!refused)process.exit(1);
}console.log("guard-controls-passed");`;
    const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", f.guard, "-e", script], { cwd: f.project, env: f.env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    let timedOut = false; const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 10_000);
    try {
      const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(timedOut).toBe(false); expect(exit).toBe(0); expect(stdout.trim()).toBe("guard-controls-passed"); expect(stderr).toBe("");
      expect(readFileSync(f.denied, "utf8")).toBe("blocked\nblocked\nblocked\n");
    } finally { clearTimeout(timer); }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

for (const json of [false, true]) {
  test(`ordinary sync requires Skills ownership or explicit force (${json ? "JSON" : "human"})`, async () => {
    for (const kind of ["foreign", "malformed", "unmarked", "owned"]) for (const mode of ["normal", "preview", "force"]) {
      const f = fixture();
      try {
        f.skill("alpha", "codex", "Existing content belongs to this fixture");
        put(join(f.target("alpha"), "old-resource.txt"), "Existing local resource\n");
        if (kind === "malformed") put(join(f.target("alpha"), ".hasna-skills.json"), "{ invalid JSON\n");
        else if (kind !== "unmarked") f.mark("alpha", "codex", kind === "owned" ? "@hasna/skills" : "another-tool");
        const kept = [f.target("alpha", "claude"), f.target("beta"), join(f.home, "keep.txt")].map(path => [path, snapshot(path)] as const);
        const authorized = kind === "owned" || mode === "force", writes = authorized && mode !== "preview";
        const result = await f.cli(["sync", "alpha", "--for", "codex", "--source", f.source,
          ...(mode === "preview" ? ["--dry-run"] : []), ...(mode === "force" ? ["--force"] : []), ...(json ? ["--json"] : [])], !writes);
        expect(result.exitCode).toBe(0);
        const action = authorized ? "update" : "skip";
        if (json) {
          const value = JSON.parse(result.stdout); expect(value.actions).toHaveLength(1);
          expect(value).toMatchObject({ dryRun: mode === "preview", actions: [{ agent: "codex", skill: "alpha", action }] });
          if (!authorized) expect(value.actions[0].reason).toContain("--force");
        } else {
          expect(result.stdout).toContain(`${action} alpha → codex`);
          if (!authorized) expect(result.stdout).toContain("--force");
        }
        if (writes) {
          expect(readFileSync(join(f.target("alpha"), "SKILL.md"), "utf8")).toBe(document("alpha"));
          expect(existsSync(join(f.target("alpha"), "old-resource.txt"))).toBe(false);
          expect(JSON.parse(readFileSync(join(f.target("alpha"), ".hasna-skills.json"), "utf8"))).toMatchObject({ managedBy: "@hasna/skills", skill: "alpha" });
        }
        for (const [path, before] of kept) expect(snapshot(path)).toEqual(before);
      } finally { rmSync(f.root, { recursive: true, force: true }); }
    }
  });

  const flags = json ? ["--json"] : [];
  test(`adoption selects explicit/ambient corpus, names and agent without touching other ownership (${json ? "JSON" : "human"})`, async () => {
    const f = fixture();
    try {
      f.corpus("foreign"); f.skill("foreign"); f.mark("foreign", "codex", "other-tool");
      f.corpus("conflict"); f.skill("conflict", "codex", "Hand authored conflict"); f.skill("unknown");
      const kept = [f.target("alpha", "claude"), f.target("beta"), f.target("foreign"), f.target("conflict"), f.target("unknown")].map(path => [path, snapshot(path)] as const);
      const sourceArgs = ["--source", f.source], selection = ["sync", " ALPHA ", "alpha", "--adopt", "--for", "codex"];
      for (const source of [f.source, dirname(f.source)]) {
        const dry = await f.cli([...selection, "--source", source, ...flags], true, { SKILLS_SOURCE: join(f.root, "wrong-source") });
        expect(dry.exitCode).toBe(0);
        if (json) {
          expect(JSON.parse(dry.stdout).adoptable).toHaveLength(1);
          expect(JSON.parse(dry.stdout)).toMatchObject({ dryRun: true, applied: false, adoptable: [{ agent: "codex", skill: "alpha", hash: sha(document("alpha")) }], conflicts: [], unknown: [], managed: 0 });
        }
        else { expect(dry.stdout).toContain("Would adopt 1, 0 conflict(s), 0 unknown, 0 already managed"); expect(dry.stdout).not.toContain("claude"); expect(dry.stdout).not.toContain("beta"); }
      }
      const ambient = await f.cli(["render", "alpha", "--adopt", "--for", "codex", ...flags], true, { SKILLS_SOURCE: f.source });
      expect(ambient.exitCode).toBe(0);
      const oldFile = snapshot(join(f.target("alpha"), "SKILL.md"));
      const apply = await f.cli([...selection, ...sourceArgs, "--apply", ...flags], false); expect(apply.exitCode).toBe(0);
      expect(snapshot(join(f.target("alpha"), "SKILL.md"))).toEqual(oldFile);
      expect(JSON.parse(readFileSync(join(f.target("alpha"), ".hasna-skills.json"), "utf8"))).toMatchObject({ managedBy: "@hasna/skills", skill: "alpha", source: "adopted" });
      const rollbackFiles = readdirSync(join(f.data, "rollback")); expect(rollbackFiles).toHaveLength(1);
      const rollback = JSON.parse(readFileSync(join(f.data, "rollback", rollbackFiles[0]!), "utf8"));
      expect(rollback).toMatchObject({ version: 1, mode: "adopt", entries: [{ agent: "codex", skill: "alpha", path: f.target("alpha"), hash: sha(document("alpha")) }] });
      for (const [path, before] of kept) expect(snapshot(path)).toEqual(before);
      // Explicit foreign selection is recognized, but cannot grant ownership.
      const foreign = await f.cli(["sync", "foreign", "--adopt", "--for", "codex", ...sourceArgs, "--apply", ...flags]);
      expect(foreign.exitCode).toBe(0);
      if (json) expect(JSON.parse(foreign.stdout)).toMatchObject({ applied: true, adoptable: [], conflicts: [], unknown: [], managed: 1 });
      expect(snapshot(f.target("foreign"))).toEqual(kept[2]![1]);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
  test(`prune applies only selected owned stale homes and preserves foreign/canonical/unmarked names (${json ? "JSON" : "human"})`, async () => {
    const f = fixture();
    try {
      f.skill("stale"); f.mark("stale"); f.skill("stale", "claude"); f.mark("stale", "claude");
      f.skill("other-stale"); f.mark("other-stale"); f.skill("foreign"); f.mark("foreign", "codex", "other-tool");
      f.corpus("source-only"); f.skill("source-only"); f.mark("source-only");
      f.mark("alpha"); f.skill("unknown");
      const kept = [f.target("stale", "claude"), f.target("other-stale"), f.target("foreign"), f.target("alpha"), f.target("unknown"), f.target("source-only")].map(path => [path, snapshot(path)] as const);
      const selection = ["sync", " STALE ", "stale", "foreign", "source-only", "--prune", "--for", "codex", "--source", f.source];
      const dry = await f.cli([...selection, ...flags]); expect(dry.exitCode).toBe(0);
      if (json) {
        expect(JSON.parse(dry.stdout).candidates).toHaveLength(1);
        expect(JSON.parse(dry.stdout)).toMatchObject({ dryRun: true, pruned: 0, candidates: [{ agent: "codex", skill: "stale", hash: sha(document("stale")) }] });
      }
      else { expect(dry.stdout).toContain("Would prune 0 of 1 marked-and-stray dirs"); expect(dry.stdout).not.toContain("→ claude"); expect(dry.stdout).not.toContain("foreign →"); }
      const ambient = await f.cli(["render", "stale", "foreign", "source-only", "--prune", "--for", "codex", ...flags], true, { SKILLS_SOURCE: f.source });
      expect(ambient.exitCode).toBe(0); expect(ambient.stdout).toBe(dry.stdout);
      const apply = await f.cli([...selection, "--apply", ...flags], false); expect(apply.exitCode).toBe(0);
      expect(existsSync(f.target("stale"))).toBe(false);
      const rollbackFiles = readdirSync(join(f.data, "rollback")); expect(rollbackFiles).toHaveLength(1);
      expect(JSON.parse(readFileSync(join(f.data, "rollback", rollbackFiles[0]!), "utf8"))).toMatchObject({ version: 1, mode: "prune", entries: [{ agent: "codex", skill: "stale", path: f.target("stale"), hash: sha(document("stale")), marker: { managedBy: "@hasna/skills" } }] });
      for (const [path, before] of kept) expect(snapshot(path)).toEqual(before);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
  test(`all adoption/prune selectors validate before any apply write (${json ? "JSON" : "human"})`, async () => {
    const f = fixture();
    try {
      f.skill("stale"); f.mark("stale");
      for (const mode of ["--adopt", "--prune"]) for (const args of [
        ["--for", "wrong-agent"], ["--source", join(f.root, "missing")], ["--source", join(f.project, "keep.txt")],
        ["alpha", "missing-skill", "--source", f.source], ["../escape", "--source", f.source],
        ["   ", "--source", f.source],
      ]) {
        const result = await f.cli(["sync", mode, "--apply", ...args, ...flags]); expect(result.exitCode).toBe(1);
        if (json) expect(typeof JSON.parse(result.stdout).error).toBe("string"); else expect(result.stderr.trim().length).toBeGreaterThan(0);
      }
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
}

test("default adoption/prune retains all-agent cached-corpus behavior and conflict records", async () => {
  const f = fixture();
  try {
    f.cached("alpha"); f.cached("beta"); f.corpus("conflict"); f.cached("conflict"); f.skill("conflict", "codex", "Local edit"); f.skill("unknown");
    const conflictBefore = snapshot(f.target("conflict")), unknownBefore = snapshot(f.target("unknown"));
    const adopted = await f.cli(["sync", "--adopt", "--apply", "--json"], false); expect(adopted.exitCode).toBe(0);
    const result = JSON.parse(adopted.stdout); expect(result.adoptable).toHaveLength(3); expect(result.conflicts).toHaveLength(1); expect(result.unknown).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(f.data, "conflicts.json"), "utf8"))).toMatchObject({ version: 1, entries: [{ agent: "codex", skill: "conflict", hash: sha(document("conflict", "Local edit")), canonicalHash: sha(document("conflict")) }] });
    expect(snapshot(f.target("conflict"))).toEqual(conflictBefore); expect(snapshot(f.target("unknown"))).toEqual(unknownBefore);
    for (const agent of ["codex", "claude"]) { f.skill("stale", agent); f.mark("stale", agent); }
    const pruned = await f.cli(["sync", "--prune", "--apply", "--json"], false); expect(pruned.exitCode).toBe(0); expect(JSON.parse(pruned.stdout).pruned).toBe(2);
    expect(existsSync(f.target("stale"))).toBe(false); expect(existsSync(f.target("stale", "claude"))).toBe(false);
    expect(existsSync(f.target("alpha"))).toBe(true); expect(existsSync(f.target("alpha", "claude"))).toBe(true);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
