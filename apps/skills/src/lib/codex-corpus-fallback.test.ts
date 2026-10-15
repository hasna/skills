import { describe, expect, test } from "bun:test";
import { appendFileSync, chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { admitCorpusFixture, corpusFixture } from "./codex-corpus.fixture.js";
import { acquireCodexCorpusWrite, withCodexCorpusWrite, withCodexCorpusWriteAsync, type CodexAdmissionProbe } from "./codex-corpus-write.js";
import { writeManagedAgentSkill, writeManagedSkillDir } from "./agent-sync.js";
import { applyAgentIntegration, archiveNativeSkills, inventoryNativeSkills, planAgentIntegration } from "./agent-integration.js";
import { adoptUnmarkedHomes, pruneStrayHomes } from "./home-adoption.js";
import { connectCodexHookRpc } from "./codex-hook-rpc.js";
import { getDataDir } from "./config.js";

useDefaultTestTimeout();
const REFUSAL = "CODEX_CORPUS_ADMISSION_REQUIRED: verified native admission and its existing shared lock are required";
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const expectedProbe = (command: string, version: string | null = "codex-cli 0.160.0"): CodexAdmissionProbe => ({
  kind: "help-unrecognized-subcommand", executable: realpathSync(command), sha256: sha(readFileSync(command)),
  size: statSync(command).size, version, probeExitCode: 2, controlExitCode: 0,
});
/** Every entry, its type, mode and bytes; directory timestamps are excluded. */
function tree(root: string, skip: string[] = []): Record<string, string> {
  const entries: Record<string, string> = {};
  const walk = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name), rel = relative(root, path);
      if (skip.some(prefix => rel === prefix || rel.startsWith(`${prefix}/`))) continue;
      const stat = lstatSync(path), mode = (stat.mode & 0o7777).toString(8);
      if (stat.isSymbolicLink()) entries[rel] = `link:${readlinkSync(path)}`;
      else if (stat.isDirectory()) { entries[rel] = `dir:${mode}`; walk(path); }
      else entries[rel] = `file:${mode}:${sha(readFileSync(path))}`;
    }
  };
  walk(root);
  return entries;
}
/** The Skills-owned lock is keyed by the corpus root's physical identity. */
function skillsLockPath(root: string): string {
  const physical = realpathSync(root), stat = lstatSync(physical, { bigint: true });
  return join(getDataDir(), "codex-corpus-locks", `codex-corpus-${sha(`${physical}\0${stat.dev}\0${stat.ino}`)}.flock-v1`);
}
function upstream() {
  const f = corpusFixture(false, "upstream");
  mkdirSync(join(f.root, "skills", "unrelated"), { recursive: true, mode: 0o700 });
  writeFileSync(join(f.root, "skills", "unrelated", "SKILL.md"), "---\nname: unrelated\ndescription: Synthetic preserved skill\n---\nPreserved\n", { mode: 0o600 });
  writeFileSync(join(f.root, "config.toml"), 'model = "synthetic-preserved-model"\n', { mode: 0o600 });
  return f;
}

describe("interim fallback for Codex builds without native admission", () => {
  test("an upstream build writes under the Skills lock, records the probe and adds nothing else to the corpus", () => {
    const f = upstream(), dir = join(f.root, "skills", "sample");
    const before = tree(f.root);
    const result = writeManagedSkillDir(dir, "hello\n", { skill: "sample", ...f.options });
    expect(result.action).toBe("create");
    expect(result.nativeAdmission).toBe("unavailable");
    expect(result.nativeAdmissionProbe).toEqual(expectedProbe(f.command));
    expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toBe("hello\n");
    expect(tree(f.root, ["skills/sample"])).toEqual(before);
    expect(existsSync(join(f.root, ".native-corpus-admission.flock-v1"))).toBe(false);
    const lock = lstatSync(skillsLockPath(f.root));
    expect(lock.isFile() && (lock.mode & 0o077) === 0).toBe(true);
    expect(readdirSync(join(getDataDir(), "codex-corpus-locks"))).toEqual([relative(join(getDataDir(), "codex-corpus-locks"), skillsLockPath(f.root))]);
    expect(existsSync(join(f.home, "inspect-invoked"))).toBe(false);
    // The receipt carries the fixed probe record only, never native output.
    expect(JSON.stringify(result)).not.toMatch(/unrecognized subcommand '|Usage:|PROMPT/);
  });

  for (const entry of ["file", "directory", "dangling-link"] as const) test(`an upstream build refuses when a native lock ${entry} exists`, () => {
    const f = corpusFixture(entry === "file", "upstream"), lock = join(f.root, ".native-corpus-admission.flock-v1");
    if (entry === "directory") mkdirSync(lock, { mode: 0o700 });
    if (entry === "dangling-link") symlinkSync(join(f.home, "missing"), lock);
    let called = false;
    expect(() => withCodexCorpusWrite([f.root], () => { called = true; }, f.options)).toThrow(new Error(REFUSAL));
    expect(called).toBe(false);
    expect(existsSync(join(getDataDir(), "codex-corpus-locks"))).toBe(false);
  });

  test("an admission build without a native lock refuses as before, without bootstrapping either lock", () => {
    const f = corpusFixture(false); let called = false;
    expect(() => withCodexCorpusWrite([f.root], () => { called = true; }, f.options)).toThrow(new Error(`${REFUSAL} (command-present)`));
    expect(called).toBe(false);
    expect(existsSync(join(f.root, ".native-corpus-admission.flock-v1"))).toBe(false);
    expect(existsSync(join(getDataDir(), "codex-corpus-locks"))).toBe(false);
  });

  test("an admission build with an enrolled lock keeps the native route and unchanged receipts", () => {
    const f = corpusFixture(); let admission: unknown;
    withCodexCorpusWrite([f.root], (_assertCurrent, value) => { admission = value; }, f.options);
    expect(admission).toEqual({ nativeAdmission: "verified" });
    const result = writeManagedSkillDir(join(f.root, "skills", "sample"), "hello\n", { skill: "sample", ...f.options });
    expect(result).toEqual({ action: "create", path: join(f.root, "skills", "sample", "SKILL.md") });
    expect(existsSync(join(getDataDir(), "codex-corpus-locks"))).toBe(false);
  });

  for (const [mode, reason] of [["exit-1", "probe-inconclusive"], ["wrong-text", "probe-inconclusive"], ["stdout-noise", "probe-inconclusive"],
    ["control-fail", "probe-inconclusive"], ["timeout", "probe-inconclusive"], ["help-0", "command-present"]] as const) test(`probe anomaly ${mode} refuses (${reason})`, () => {
    const f = upstream(); writeFileSync(join(f.home, "probe-mode"), mode);
    const before = tree(f.root); let called = false;
    expect(() => withCodexCorpusWrite([f.root], () => { called = true; }, f.options)).toThrow(new Error(`${REFUSAL} (${reason})`));
    expect(called).toBe(false); expect(tree(f.root)).toEqual(before);
    expect(existsSync(join(getDataDir(), "codex-corpus-locks"))).toBe(false);
  });

  test("an unreviewed version string is recorded as null rather than echoed", () => {
    const f = upstream(); writeFileSync(join(f.home, "probe-mode"), "bad-version");
    const result = writeManagedSkillDir(join(f.root, "skills", "sample"), "hello\n", { skill: "sample", ...f.options });
    expect(result.nativeAdmissionProbe).toEqual(expectedProbe(f.command, null));
  });

  test("the executable binding still applies: a digest mismatch or a group-writable executable refuses", () => {
    const f = upstream();
    expect(() => withCodexCorpusWrite([f.root], () => {}, { ...f.options, codexSha256: "0".repeat(64) })).toThrow(new Error(`${REFUSAL} (executable-unverified)`));
    let admission: any;
    withCodexCorpusWrite([f.root], (_assertCurrent, value) => { admission = value; }, { ...f.options, codexSha256: sha(readFileSync(f.command)) });
    expect(admission).toEqual({ nativeAdmission: "unavailable", probe: expectedProbe(f.command) });
    chmodSync(f.command, 0o770);
    expect(() => withCodexCorpusWrite([f.root], () => {}, f.options)).toThrow(new Error(`${REFUSAL} (executable-unverified)`));
  });

  test("a second Skills writer on the same root is refused while the first holds, in this process and another", async () => {
    const f = upstream(); let release!: () => void, entered = 0;
    const first = withCodexCorpusWriteAsync([f.root], async (assertCurrent) => {
      // The enclosing transaction's own nested client reuses its descriptor.
      expect(withCodexCorpusWrite([f.root], () => 42, f.options)).toBe(42);
      const nested = acquireCodexCorpusWrite([f.root], f.options);
      expect(nested.admission.nativeAdmission).toBe("unavailable");
      nested.close(); assertCurrent();
      await new Promise<void>(resolve => { release = resolve; });
    }, f.options);
    expect(() => withCodexCorpusWrite([f.root], () => { entered++; }, f.options)).toThrow(new Error(`${REFUSAL} (writer-busy)`));
    await expect(withCodexCorpusWriteAsync([f.root], async () => { entered++; }, f.options)).rejects.toThrow(`${REFUSAL} (writer-busy)`);
    const script = `const { withCodexCorpusWrite } = await import(${JSON.stringify(new URL("./codex-corpus-write.ts", import.meta.url).pathname)});
try { withCodexCorpusWrite([${JSON.stringify(f.root)}], () => console.log("ENTERED"), { codexCommand: ${JSON.stringify(f.command)} }); } catch (error) { console.log(error.message); }`;
    const child = Bun.spawn([process.execPath, "--no-env-file", "-e", script], { cwd: f.home, env: { ...process.env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect([stdout.trim(), stderr, status]).toEqual([`${REFUSAL} (writer-busy)`, "", 0]);
    expect(entered).toBe(0);
    release(); await first;
    withCodexCorpusWrite([f.root], () => { entered++; }, f.options);
    expect(entered).toBe(1);
  });

  for (const change of ["modified", "replaced"] as const) test(`an executable ${change} mid-write refuses through assertCurrent and preserves the preimage`, () => {
    const f = upstream(), dir = join(f.root, "skills", "sample");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, "SKILL.md"), "original\n");
    writeFileSync(join(dir, ".hasna-skills.json"), JSON.stringify({ managedBy: "@hasna/skills", skill: "sample" }));
    const moves: string[][] = []; let failure: unknown;
    try {
      writeManagedSkillDir(dir, "replacement\n", { skill: "sample", ...f.options, renameDirectory: (from, to) => {
        moves.push([String(from), String(to)]);
        if (change === "modified") appendFileSync(f.command, "\n// changed after admission\n");
        else { copyFileSync(f.command, `${f.command}.copy`); chmodSync(`${f.command}.copy`, 0o700); renameSync(`${f.command}.copy`, f.command); }
        renameSync(from, to);
      } });
    } catch (error) { failure = error; }
    // The writer stops at the next check; the rollback refuses to write without a current lease.
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors.map(error => (error as Error).message)).toEqual([`${REFUSAL} (lease-changed)`, `${REFUSAL} (lease-changed)`]);
    expect(moves).toHaveLength(1);
    expect((failure as Error).message).toContain(moves[0]![1]!);
    expect(readFileSync(join(moves[0]![1]!, "SKILL.md"), "utf8")).toBe("original\n");
    expect(existsSync(join(dir, "SKILL.md"))).toBe(false);
  });

  test("root replacement, a native lock appearing and mixed leases refuse", () => {
    const f = upstream();
    expect(() => withCodexCorpusWrite([f.root], () => { renameSync(f.root, `${f.root}-old`); mkdirSync(f.root, { mode: 0o700 }); }, f.options)).toThrow(`${REFUSAL} (lease-changed)`);
    const g = upstream();
    expect(() => withCodexCorpusWrite([g.root], (assertCurrent) => { admitCorpusFixture(g.root); assertCurrent(); }, g.options)).toThrow(`${REFUSAL} (lease-changed)`);
    const enrolled = corpusFixture(true, "upstream"), unenrolled = upstream(); let called = false;
    expect(() => withCodexCorpusWrite([enrolled.root, unenrolled.root], () => { called = true; }, unenrolled.options)).toThrow(new Error(`${REFUSAL} (native-lock-present)`));
    expect(called).toBe(false);
  });
});

describe("fallback receipts", () => {
  test("hook application and its persisted migration receipt record the fallback", () => {
    const f = upstream(), dataDir = join(f.home, "data");
    writeFileSync(join(f.root, "config.toml"), "[skills.bundled]\nenabled = false\n", { mode: 0o600 });
    const plan = planAgentIntegration({ home: f.home, dataDir, agents: ["codex"], command: "skills", profileId: "fleet", projectDir: f.home });
    const result = applyAgentIntegration(plan, f.options);
    expect(result.changed.length).toBeGreaterThan(0);
    expect([result.nativeAdmission, result.nativeAdmissionProbe]).toEqual(["unavailable", expectedProbe(f.command)]);
    const [operation] = readdirSync(join(dataDir, "migration"));
    const receipt = JSON.parse(readFileSync(join(dataDir, "migration", operation!, "receipt.json"), "utf8"));
    expect([receipt.nativeAdmission, receipt.nativeAdmissionProbe]).toEqual(["unavailable", expectedProbe(f.command)]);
    expect(existsSync(join(f.root, ".native-corpus-admission.flock-v1"))).toBe(false);
  });

  test("native archive results and the archive journal record the fallback", () => {
    const f = upstream(), dir = join(f.root, "skills", "archival-fixture"), dataDir = join(f.home, "data");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: archival-fixture\ndescription: synthetic archival test\n---\nFixture\n", { mode: 0o600 });
    const inventory = inventoryNativeSkills(f.home, { agents: ["codex"], projectDir: f.home }).filter(row => row.path === dir);
    const result = archiveNativeSkills(inventory, { dataDir, includeUnmanaged: true, ...f.options });
    expect(result.entries).toHaveLength(1);
    expect([result.nativeAdmission, result.nativeAdmissionProbe]).toEqual(["unavailable", expectedProbe(f.command)]);
    const journal = JSON.parse(readFileSync(result.receiptPath!, "utf8"));
    expect([journal.status, journal.nativeAdmission, journal.nativeAdmissionProbe]).toEqual(["completed", "unavailable", expectedProbe(f.command)]);
  });

  for (const mode of ["prune", "adopt"] as const) test(`home ${mode} results and rollback records record the fallback`, () => {
    const f = upstream(), dir = join(f.home, ".codex/skills/stray"), corpus = join(f.home, "corpus"), marked = mode === "prune";
    const content = "---\nname: stray\ndescription: synthetic test\n---\nSynthetic instruction.\n";
    mkdirSync(dir, { recursive: true }); mkdirSync(join(corpus, marked ? "retained" : "stray"), { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), content); writeFileSync(join(corpus, marked ? "retained" : "stray", "SKILL.md"), content);
    if (marked) writeFileSync(join(dir, ".hasna-skills.json"), JSON.stringify({ managedBy: "@hasna/skills", skill: "stray", source: "synthetic", syncedAt: "2026-10-05T00:00:00Z" }));
    const options = { ...f.options, homeDir: f.home, rootDir: corpus, agents: ["codex" as const], apply: true };
    const result = mode === "prune" ? pruneStrayHomes(options) : adoptUnmarkedHomes(options);
    expect([result.nativeAdmission, result.nativeAdmissionProbe]).toEqual(["unavailable", expectedProbe(f.command)]);
    const record = JSON.parse(readFileSync(result.rollbackFile!, "utf8"));
    expect([record.mode, record.nativeAdmission, record.nativeAdmissionProbe]).toEqual([mode, "unavailable", expectedProbe(f.command)]);
    expect(existsSync(dir)).toBe(mode === "adopt");
  });

  test("sync actions record the fallback", () => {
    const f = upstream();
    const action = writeManagedAgentSkill({ agent: "codex", skill: "sample", skillMd: "hello\n", homeDir: f.home, codexCommand: f.command });
    expect([action.action, action.nativeAdmission, action.nativeAdmissionProbe]).toEqual(["create", "unavailable", expectedProbe(f.command)]);
  });

  test("the owned native client admits through the fallback and reuses its enclosing writer's lock", async () => {
    const f = upstream();
    const rpc = await connectCodexHookRpc({ command: f.command, home: f.home, codexHome: f.root });
    try {
      expect(rpc.admission).toEqual({ nativeAdmission: "unavailable", probe: expectedProbe(f.command) });
      expect(() => withCodexCorpusWrite([f.root], () => {}, f.options)).toThrow(`${REFUSAL} (writer-busy)`);
    } finally { await rpc.close(); }
    // Trust enrolment connects inside its own write transaction.
    await withCodexCorpusWriteAsync([f.root], async (assertCurrent) => {
      const nested = await connectCodexHookRpc({ command: f.command, home: f.home, codexHome: f.root });
      try { expect(nested.admission?.nativeAdmission).toBe("unavailable"); } finally { await nested.close(); }
      assertCurrent();
    }, f.options);
    expect(existsSync(join(f.root, ".native-corpus-admission.flock-v1"))).toBe(false);
  });
});
