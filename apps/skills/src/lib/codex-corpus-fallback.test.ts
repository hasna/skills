import { describe, expect, test } from "bun:test";
import { appendFileSync, chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { admitCorpusFixture, corpusFixture } from "./codex-corpus.fixture.js";
import { acquireCodexCorpusWrite, withCodexCorpusWrite, withCodexCorpusWriteAsync, type CodexAdmissionProbe, type CodexCorpusAdmission } from "./codex-corpus-write.js";
import { removeManagedAgentSkill, writeManagedAgentSkill, writeManagedSkillDir } from "./agent-sync.js";
import { removeSkillForAgent } from "./installer.js";
import { applyAgentIntegration, archiveNativeSkills, inventoryNativeSkills, planAgentIntegration } from "./agent-integration.js";
import { adoptUnmarkedHomes, pruneStrayHomes } from "./home-adoption.js";
import { connectCodexHookRpc } from "./codex-hook-rpc.js";
import { getDataDir } from "./config.js";

useDefaultTestTimeout();
const REFUSAL = "CODEX_CORPUS_ADMISSION_REQUIRED: verified native admission and its existing shared lock are required";
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const expectedProbe = (command: string, version = "codex-cli 0.160.0"): CodexAdmissionProbe => ({
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
/** Skills state lives beside the Codex home's physical location, never under a data-root override. */
const stateDir = (root: string, leaf: string) => join(dirname(realpathSync(root)), ".hasna", "skills", leaf);
/** The Skills-owned lock is keyed by the corpus root's physical identity. */
function skillsLockPath(root: string): string {
  const physical = realpathSync(root), stat = lstatSync(physical, { bigint: true });
  return join(stateDir(root, "codex-corpus-locks"), `codex-corpus-${sha(`${physical}\0${stat.dev}\0${stat.ino}`)}.flock-v1`);
}
function upstream() {
  const f = corpusFixture(false, "upstream");
  mkdirSync(join(f.root, "skills", "unrelated"), { recursive: true, mode: 0o700 });
  writeFileSync(join(f.root, "skills", "unrelated", "SKILL.md"), "---\nname: unrelated\ndescription: Synthetic preserved skill\n---\nPreserved\n", { mode: 0o600 });
  writeFileSync(join(f.root, "config.toml"), 'model = "synthetic-preserved-model"\n', { mode: 0o600 });
  return f;
}
function ownedSkill(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "SKILL.md"), "original\n");
  writeFileSync(join(dir, ".hasna-skills.json"), JSON.stringify({ managedBy: "@hasna/skills", skill: "sample" }));
}

describe("interim fallback for Codex builds without native admission", () => {
  test("an upstream build writes under the Skills lock beside the home, records the probe and adds nothing to the corpus", () => {
    const f = upstream(), dir = join(f.root, "skills", "sample");
    const before = tree(f.root);
    const result = writeManagedSkillDir(dir, "hello\n", { skill: "sample", ...f.options });
    expect(result.action).toBe("create");
    expect(result.nativeAdmission).toBe("unavailable");
    expect(result.nativeAdmissionProbe).toEqual(expectedProbe(f.command));
    expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toBe("hello\n");
    // Upstream's per-launch helper aliases land in the private probe home, never the corpus.
    expect(tree(f.root, ["skills/sample"])).toEqual(before);
    expect(readdirSync(join(stateDir(f.root, "codex-probe-home"), "tmp", "arg0")).length).toBeGreaterThan(0);
    expect(existsSync(join(f.root, ".native-corpus-admission.flock-v1"))).toBe(false);
    const lock = lstatSync(skillsLockPath(f.root));
    expect(lock.isFile() && (lock.mode & 0o077) === 0).toBe(true);
    expect(readdirSync(stateDir(f.root, "codex-corpus-locks"))).toEqual([relative(stateDir(f.root, "codex-corpus-locks"), skillsLockPath(f.root))]);
    for (const leaf of ["codex-corpus-locks", "codex-probe-home"]) expect(lstatSync(stateDir(f.root, leaf)).mode & 0o777).toBe(0o700);
    expect(existsSync(join(getDataDir(), "codex-corpus-locks"))).toBe(false);
    expect(existsSync(join(f.home, "inspect-invoked"))).toBe(false);
    // The receipt carries the fixed probe record only, never native output.
    expect(JSON.stringify(result)).not.toMatch(/unrecognized subcommand '|Usage:|PROMPT/);
  });

  for (const entry of ["file", "directory", "dangling-link", "legacy-file", "legacy-directory"] as const) test(`an upstream build refuses natively when a ${entry} admission lock entry exists`, () => {
    const f = corpusFixture(entry === "file", "upstream");
    const lock = join(f.root, entry.startsWith("legacy") ? ".native-corpus-admission.lock" : ".native-corpus-admission.flock-v1");
    if (entry === "directory" || entry === "legacy-directory") mkdirSync(lock, { mode: 0o700 });
    if (entry === "dangling-link") symlinkSync(join(f.home, "missing"), lock);
    if (entry === "legacy-file") writeFileSync(lock, "", { mode: 0o600 });
    let called = false;
    expect(() => withCodexCorpusWrite([f.root], () => { called = true; }, f.options)).toThrow(new Error(REFUSAL));
    expect(called).toBe(false);
    expect(existsSync(join(f.home, ".hasna"))).toBe(false);
  });

  test("an admission build without a native lock refuses as before, without bootstrapping either lock", () => {
    const f = corpusFixture(false), before = tree(f.root); let called = false;
    expect(() => withCodexCorpusWrite([f.root], () => { called = true; }, f.options)).toThrow(new Error(`${REFUSAL} (command-present)`));
    expect(called).toBe(false); expect(tree(f.root)).toEqual(before);
    expect(existsSync(stateDir(f.root, "codex-corpus-locks"))).toBe(false);
  });

  test("an admission build with an enrolled lock keeps the native route and unchanged receipts", () => {
    const f = corpusFixture(); let admission: unknown;
    withCodexCorpusWrite([f.root], (_assertCurrent, value) => { admission = value; }, f.options);
    expect(admission).toEqual({ nativeAdmission: "verified" });
    const result = writeManagedSkillDir(join(f.root, "skills", "sample"), "hello\n", { skill: "sample", ...f.options });
    expect(result).toEqual({ action: "create", path: join(f.root, "skills", "sample", "SKILL.md") });
    expect(existsSync(join(f.home, ".hasna"))).toBe(false);
  });

  for (const [mode, reason] of [["exit-1", "probe-inconclusive"], ["wrong-text", "probe-inconclusive"], ["stdout-noise", "probe-inconclusive"],
    ["control-fail", "probe-inconclusive"], ["timeout", "probe-inconclusive"], ["signal", "probe-inconclusive"], ["control-signal", "probe-inconclusive"],
    ["bad-version", "probe-inconclusive"], ["help-0", "command-present"], ["swap", "executable-unverified"]] as const) test(`probe anomaly ${mode} refuses (${reason})`, () => {
    const f = upstream(); writeFileSync(join(f.home, "probe-mode"), mode);
    const before = tree(f.root); let called = false;
    expect(() => withCodexCorpusWrite([f.root], () => { called = true; }, f.options)).toThrow(new Error(`${REFUSAL} (${reason})`));
    expect(called).toBe(false); expect(tree(f.root)).toEqual(before);
    expect(existsSync(stateDir(f.root, "codex-corpus-locks"))).toBe(false);
  });

  test("a strict semver prerelease version is recorded", () => {
    const f = upstream(); writeFileSync(join(f.home, "probe-mode"), "prerelease-version");
    const result = writeManagedSkillDir(join(f.root, "skills", "sample"), "hello\n", { skill: "sample", ...f.options });
    expect(result.nativeAdmissionProbe).toEqual(expectedProbe(f.command, "codex-cli 0.163.0-alpha.2"));
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

  test("a second Skills writer on the same root is refused while the first holds, here and in a process with other data roots", async () => {
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
    // Data-root overrides cannot split exclusion: the lock follows the Codex home.
    const other = join(f.home, "other-data-roots"); mkdirSync(other, { mode: 0o700 });
    const script = `const { withCodexCorpusWrite } = await import(${JSON.stringify(new URL("./codex-corpus-write.ts", import.meta.url).pathname)});
try { withCodexCorpusWrite([${JSON.stringify(f.root)}], () => console.log("ENTERED"), { codexCommand: ${JSON.stringify(f.command)} }); } catch (error) { console.log(error.message); }`;
    const env = { ...process.env, HASNA_SKILLS_DIR: join(other, "a"), HASNA_SKILLS_HOME: join(other, "b"), SKILLS_HOME: join(other, "c"), HASNA_DATA_HOME: join(other, "d") };
    const child = Bun.spawn([process.execPath, "--no-env-file", "-e", script], { cwd: f.home, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect([stdout.trim(), stderr, status]).toEqual([`${REFUSAL} (writer-busy)`, "", 0]);
    expect(readdirSync(other)).toEqual([]);
    expect(entered).toBe(0);
    release(); await first;
    withCodexCorpusWrite([f.root], () => { entered++; }, f.options);
    expect(entered).toBe(1);
  });

  test("a data-root override inside the Codex home does not relocate the lock or create anything there", () => {
    const f = upstream(), before = tree(f.root), previous = process.env.HASNA_SKILLS_DIR;
    process.env.HASNA_SKILLS_DIR = join(f.root, "skills-data");
    try { withCodexCorpusWrite([f.root], () => {}, f.options); }
    finally { if (previous === undefined) delete process.env.HASNA_SKILLS_DIR; else process.env.HASNA_SKILLS_DIR = previous; }
    expect(tree(f.root)).toEqual(before);
    expect(lstatSync(skillsLockPath(f.root)).isFile()).toBe(true);
  });

  for (const variant of ["own-home-alias", "own-home-alias-existing", "other-home-alias", "nested-in-other-home", "group-writable"] as const) test(`an unsafe Skills state location refuses before anything is created (${variant})`, () => {
    const f = upstream(), other = corpusFixture(true);
    let root = f.root;
    if (variant === "own-home-alias") symlinkSync(join(f.root, "state"), join(f.home, ".hasna"));
    if (variant === "own-home-alias-existing") { mkdirSync(join(f.root, "state"), { mode: 0o700 }); symlinkSync(join(f.root, "state"), join(f.home, ".hasna")); }
    if (variant === "other-home-alias") symlinkSync(join(other.root, "state"), join(f.home, ".hasna"));
    if (variant === "nested-in-other-home") { root = join(other.root, "nested", ".codex"); mkdirSync(root, { recursive: true, mode: 0o700 }); }
    if (variant === "group-writable") { mkdirSync(join(f.home, ".hasna"), { mode: 0o700 }); chmodSync(join(f.home, ".hasna"), 0o770); }
    const own = tree(f.root), foreign = tree(other.root); let called = false;
    expect(() => withCodexCorpusWrite([root], () => { called = true; }, f.options)).toThrow(new Error(`${REFUSAL} (skills-lock-unavailable)`));
    expect(called).toBe(false);
    expect(tree(f.root)).toEqual(own); expect(tree(other.root)).toEqual(foreign);
    if (variant === "group-writable") expect(readdirSync(join(f.home, ".hasna"))).toEqual([]);
  });

  test("an alias and its physical home share one lock and both stay rechecked", () => {
    const f = upstream(), alias = join(f.home, "codex-alias"), elsewhere = join(f.home, "elsewhere");
    symlinkSync(f.root, alias); mkdirSync(elsewhere, { mode: 0o700 });
    let admission: CodexCorpusAdmission | undefined;
    withCodexCorpusWrite([alias, f.root], (_assertCurrent, value) => { admission = value; }, f.options);
    expect(admission?.nativeAdmission).toBe("unavailable");
    expect(readdirSync(stateDir(f.root, "codex-corpus-locks"))).toHaveLength(1);
    expect(() => withCodexCorpusWrite([alias, f.root], (assertCurrent) => {
      symlinkSync(elsewhere, `${alias}.next`); renameSync(`${alias}.next`, alias); assertCurrent();
    }, f.options)).toThrow(`${REFUSAL} (lease-changed)`);
  });

  for (const change of ["modified", "replaced"] as const) test(`an executable ${change} mid-write refuses through assertCurrent and preserves the preimage`, () => {
    const f = upstream(), dir = join(f.root, "skills", "sample");
    ownedSkill(dir);
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

  test("root replacement, a native or legacy lock appearing and mixed leases refuse", () => {
    const f = upstream();
    expect(() => withCodexCorpusWrite([f.root], () => { renameSync(f.root, `${f.root}-old`); mkdirSync(f.root, { mode: 0o700 }); }, f.options)).toThrow(`${REFUSAL} (lease-changed)`);
    const g = upstream();
    expect(() => withCodexCorpusWrite([g.root], (assertCurrent) => { admitCorpusFixture(g.root); assertCurrent(); }, g.options)).toThrow(`${REFUSAL} (lease-changed)`);
    const h = upstream();
    expect(() => withCodexCorpusWrite([h.root], (assertCurrent) => { writeFileSync(join(h.root, ".native-corpus-admission.lock"), ""); assertCurrent(); }, h.options)).toThrow(`${REFUSAL} (lease-changed)`);
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

  test("boolean removals use the fallback only when the caller takes the admission record first", () => {
    const f = upstream(), managed = join(f.root, "skills", "sample"), installed = join(f.root, "skills", "installed");
    ownedSkill(managed); ownedSkill(installed);
    const installOptions = { agent: "codex" as const, scope: "project" as const, projectDir: f.home, ...f.options };
    expect(() => removeManagedAgentSkill("sample", "codex", f.home, f.options)).toThrow(new Error(REFUSAL));
    expect(() => removeSkillForAgent("installed", installOptions)).toThrow(new Error(REFUSAL));
    expect(() => removeManagedAgentSkill("sample", "codex", f.home, { ...f.options, onCodexAdmission: () => { throw new Error("record refused"); } })).toThrow("record refused");
    expect(readFileSync(join(managed, "SKILL.md"), "utf8")).toBe("original\n");
    expect(readFileSync(join(installed, "SKILL.md"), "utf8")).toBe("original\n");
    const records: Array<{ admission: CodexCorpusAdmission; present: boolean }> = [];
    expect(removeManagedAgentSkill("sample", "codex", f.home, { ...f.options, onCodexAdmission: admission => records.push({ admission, present: existsSync(managed) }) })).toBe(true);
    expect(removeSkillForAgent("installed", { ...installOptions, onCodexAdmission: admission => records.push({ admission, present: existsSync(installed) }) })).toBe(true);
    expect(records).toEqual([1, 2].map(() => ({ admission: { nativeAdmission: "unavailable", probe: expectedProbe(f.command) }, present: true })));
    expect(existsSync(managed) || existsSync(installed)).toBe(false);
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

  test("a nested native client whose close is unconfirmed keeps the writer lock until its child exits", async () => {
    const f = upstream(); writeFileSync(join(f.home, "app-server-linger"), "");
    let failure: unknown;
    try {
      await withCodexCorpusWriteAsync([f.root], async () => {
        const rpc = await connectCodexHookRpc({ command: f.command, home: f.home, codexHome: f.root });
        await rpc.close();
      }, f.options);
    } catch (error) { failure = error; }
    expect((failure as Error).message).toBe("CODEX_HOOK_TRUST_NATIVE_CLOSE_UNCONFIRMED");
    // The transaction settled, but its child still runs: no other Skills writer may enter.
    expect(() => withCodexCorpusWrite([f.root], () => {}, f.options)).toThrow(`${REFUSAL} (writer-busy)`);
    writeFileSync(join(f.home, "app-server-release"), "");
    let admitted = false;
    for (let attempt = 0; attempt < 50 && !admitted; attempt++) {
      await Bun.sleep(100);
      try { withCodexCorpusWrite([f.root], () => {}, f.options); admitted = true; }
      catch (error) { if (!(error as Error).message.endsWith("(writer-busy)")) throw error; }
    }
    expect(admitted).toBe(true);
  });
});
