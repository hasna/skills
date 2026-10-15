import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { packSkillBundle } from "./skill-bundle.js";
import { resolveSelectedRun, executeSelectedLocal } from "./selected-run.js";
import type { SelectedSecretBindings, SelectedSecretsClient } from "./execution-secrets.js";
import type { ProfileClient } from "./profile-client.js";
import type { ResolvedSkillSelection } from "../types/skill-selection.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function directory() { const root = mkdtempSync(join(tmpdir(), "selected-run-test-")); roots.push(root); return root; }
async function fixture(code = 'console.log("exact-v1")', runtime: Record<string, unknown> = {}, pkg: Record<string, unknown> = {}, kind = "executable", manifest: Record<string, unknown> = {}, files: Record<string, string> = {}) {
  const source = directory(), cacheDir = directory();
  mkdirSync(join(source, "src")); mkdirSync(join(source, "assets"));
  writeFileSync(join(source, "SKILL.md"), `---\nname: selected-run\ndescription: selected runner\nkind: ${kind}\n---\nExact published body.`);
  writeFileSync(join(source, "skill.json"), JSON.stringify({ kind, runtime: { runtime: "bun", entrypoint: "src/main.ts", ...runtime }, ...manifest }));
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "selected-run", version: "1.0.0", ...pkg }));
  writeFileSync(join(source, "src/main.ts"), code); writeFileSync(join(source, "assets/value.txt"), "exact-asset-v1");
  for (const [path, content] of Object.entries(files)) { mkdirSync(dirname(join(source, path)), { recursive: true }); writeFileSync(join(source, path), content); }
  writeFileSync(join(source, "src/main.ts"), code); writeFileSync(join(source, "assets/value.txt"), "exact-asset-v1");
  const bundle = packSkillBundle(source);
  const selection: ResolvedSkillSelection = { authority: "https://skills.example.com/api/v1", workspaceId: "workspace", profileRevision: "revision", slug: "selected-run", version: "1.0.0", bundleDigest: `sha256:${bundle.sha256}` };
  const client: ProfileClient = { authority: selection.authority, resolveProfile: async () => ({ authority: selection.authority, workspaceId: selection.workspaceId, profileId: "engineering", profileRevision: selection.profileRevision, selections: [selection] }), getBundle: async () => new Response(bundle.bytes), recordStation: async () => { throw new Error("unused"); } };
  return { resolved: await resolveSelectedRun("selected-run@1.0.0", "engineering", { cacheDir, client }), source, cacheDir };
}
test("local execution uses exact verified source and assets, declared JSON input, and no ambient credential", async () => {
  const previous = process.env.SELECTED_TEST_AMBIENT; process.env.SELECTED_TEST_AMBIENT = "fixture-private-value";
  try {
    const f = await fixture('console.log(JSON.stringify({asset: await Bun.file("assets/value.txt").text(), input: JSON.parse(process.env.SKILLS_INPUT_JSON!), ambient: process.env.SELECTED_TEST_AMBIENT ?? null, arg: process.argv[2]}))');
    writeFileSync(join(f.source, "src/main.ts"), 'throw new Error("mutable draft must not execute")');
    f.resolved.entries.find(entry => entry.path === "src/main.ts")!.bytes.fill(0);
    const result = await executeSelectedLocal(f.resolved, { input: { requested: 1 }, args: ["expected-argument"] }); roots.push(result.runDirectory);
    expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout)).toEqual({ asset: "exact-asset-v1", input: { requested: 1 }, ambient: null, arg: "expected-argument" });
    expect(readFileSync(join(result.runDirectory, "assets/value.txt"), "utf8")).toBe("exact-asset-v1");
    expect(readFileSync(join(result.runDirectory, ".execution-receipt.json"), "utf8")).not.toContain("fixture-private-value");
    expect(result.selection.version).toBe("1.0.0"); expect(result.inputDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  } finally { if (previous === undefined) delete process.env.SELECTED_TEST_AMBIENT; else process.env.SELECTED_TEST_AMBIENT = previous; }
});
test("local execution fails closed for instruction skills, unenforced isolation, and dependency installation", async () => {
  await expect(executeSelectedLocal((await fixture("", {}, {}, "instruction")).resolved)).rejects.toMatchObject({ code: "INSTRUCTION_SKILL" });
  await expect(executeSelectedLocal((await fixture("", { sandbox: "read-only" })).resolved)).rejects.toMatchObject({ code: "LOCAL_SANDBOX_REQUIRED" });
  await expect(executeSelectedLocal((await fixture("", { needs_network: false })).resolved)).rejects.toMatchObject({ code: "LOCAL_SANDBOX_REQUIRED" });
  await expect(executeSelectedLocal((await fixture("", {}, { dependencies: { example: "1.0.0" }, scripts: { postinstall: "never-run" } })).resolved)).rejects.toMatchObject({ code: "LOCAL_DEPENDENCY_BUILD_REQUIRED" });
  await expect(executeSelectedLocal((await fixture("", { env: ["DECLARED_FIXTURE"] })).resolved, {env:{}})).rejects.toMatchObject({ code: "LOCAL_ENV_REQUIRED" });
});
test("local execution runs an instruction skill only through the operation its manifest declares", async () => {
  // Prose-only instruction skills keep the refusal: runtime metadata alone is not an operation.
  await expect(executeSelectedLocal((await fixture("", {}, {}, "instruction")).resolved)).rejects.toMatchObject({ code: "INSTRUCTION_SKILL" });
  // A declared operation runs the exact verified bundle bytes through the selected digest.
  const f = await fixture('console.log(`findings: 0 error(s) for ${process.argv[2]}`)', {}, {}, "instruction", { commands: [{ name: "check", description: "Check a draft.", entry: "src/main.ts" }] });
  writeFileSync(join(f.source, "src/main.ts"), 'throw new Error("mutable draft must not execute")');
  const result = await executeSelectedLocal(f.resolved, { args: ["draft.md"] }); roots.push(result.runDirectory);
  expect(result.exitCode).toBe(0); expect(result.stdout.trim()).toBe("findings: 0 error(s) for draft.md");
  expect(result.selection.bundleDigest).toMatch(/^sha256:[a-f0-9]{64}$/); expect(result.runtime).toBe("bun");
  expect(result.entrypoint).toBe("src/main.ts");
  // A declared operation without an explicit runtime contract is not runnable: no runtime is inferred.
  await expect(executeSelectedLocal((await fixture("", { runtime: undefined }, {}, "instruction", { commands: [{ name: "check", entry: "src/main.ts" }] })).resolved)).rejects.toMatchObject({ code: "INSTRUCTION_SKILL" });
  // A declared operation whose entry is not in the selected bundle refuses instead of guessing a path.
  await expect(executeSelectedLocal((await fixture("", { entrypoint: undefined }, {}, "instruction", { commands: [{ name: "check", entry: "scripts/missing.py" }] })).resolved)).rejects.toMatchObject({ code: "LOCAL_ENTRYPOINT_MISSING" });
});
test("an instruction skill's declared command entry is authoritative when runtime.entrypoint disagrees", async () => {
  // Disagreement refuses: the declared command entry runs, or nothing runs - never the other file.
  const disagreeing = await fixture('console.log("declared-command-entry")', { entrypoint: "src/other.ts" }, {}, "instruction",
    { commands: [{ name: "check", description: "Check a draft.", entry: "src/main.ts" }] }, { "src/other.ts": 'console.log("other-entrypoint-ran")' });
  await expect(executeSelectedLocal(disagreeing.resolved, { args: ["draft.md"] })).rejects.toMatchObject({ code: "LOCAL_ENTRYPOINT_MISMATCH" });
  // Agreement runs, and literal arguments reach the declared entry unchanged.
  const agreeing = await fixture('console.log(`declared-command-entry ${process.argv[2] ?? "-"}`)', { entrypoint: "src/main.ts" }, {}, "instruction",
    { commands: [{ name: "check", entry: "src/main.ts" }] }, { "src/other.ts": 'console.log("other-entrypoint-ran")' });
  const ran = await executeSelectedLocal(agreeing.resolved, { args: ["literal --argument=1", "--flag"] }); roots.push(ran.runDirectory);
  expect(ran.exitCode).toBe(0); expect(ran.entrypoint).toBe("src/main.ts");
  expect(ran.stdout.trim()).toBe("declared-command-entry literal --argument=1");
  // A declared command entry missing from the bundle refuses even when a different runtime entry exists.
  const missing = await fixture('console.log("other-entrypoint-ran")', { entrypoint: "src/main.ts" }, {}, "instruction",
    { commands: [{ name: "check", entry: "scripts/missing.py" }] });
  await expect(executeSelectedLocal(missing.resolved)).rejects.toMatchObject({ code: "LOCAL_ENTRYPOINT_MISSING" });
  // Executable-kind precedence is unchanged: runtime.entrypoint still leads there.
  const executable = await fixture('console.log("runtime-entrypoint")', { entrypoint: "src/main.ts" }, {}, "executable",
    { commands: [{ name: "other", entry: "assets/value.txt" }] });
  const executableRun = await executeSelectedLocal(executable.resolved); roots.push(executableRun.runDirectory);
  expect(executableRun.exitCode).toBe(0); expect(executableRun.entrypoint).toBe("src/main.ts"); expect(executableRun.stdout.trim()).toBe("runtime-entrypoint");
});
test("local execution enforces its deadline and bounded output", async () => {
  const timeout = await executeSelectedLocal((await fixture("setInterval(() => {}, 1000)")).resolved, { timeoutMs: 100 }); roots.push(timeout.runDirectory);
  expect(timeout.exitCode).toBe(124); expect(timeout.error).toBe("LOCAL_RUN_TIMEOUT");
  const overflow = await executeSelectedLocal((await fixture('process.stdout.write("x".repeat(2 * 1024 * 1024))')).resolved); roots.push(overflow.runDirectory);
  expect(overflow.exitCode).toBe(1); expect(overflow.error).toBe("LOCAL_RUN_OUTPUT_LIMIT"); expect(Buffer.byteLength(overflow.stdout)).toBeLessThanOrEqual(1024 * 1024);
});

function bindingsFor(f: Awaited<ReturnType<typeof fixture>>): SelectedSecretBindings {
  return {
    schema: "hasna.skills-secret-bindings.v1",
    selection: { ...f.resolved.selection, profileId: "engineering" },
    consumer: { stationId: process.env.HASNA_STATION || hostname(), workspaceDirectory: realpathSync(process.cwd()) },
    secretsAuthority: "https://vault.example.com/v1",
    bindings: { DECLARED_FIXTURE: "demo/provider/key" },
  };
}
test("selected execution resolves explicit vault bindings instead of inheriting ambient credentials", async () => {
  const f = await fixture('console.log(process.env.DECLARED_FIXTURE ? "bound" : "missing")', { env: ["DECLARED_FIXTURE"] });
  let reads = 0;
  const result = await executeSelectedLocal(f.resolved, {
    secretBindings: bindingsFor(f),
    createSecretsClient: () => ({
      baseUrl: "https://vault.example.com/v1",
      async getSecret({ key }: { key: string }) { reads++; return { key, value: crypto.randomUUID() }; },
    }),
  });
  roots.push(result.runDirectory);
  expect(result.exitCode).toBe(0); expect(result.stdout).toBe("bound\n"); expect(reads).toBe(1);
});

test("all binding scopes and declared names are checked before any vault access", async () => {
  const f = await fixture('throw new Error("must not run")', { env: ["DECLARED_FIXTURE"] });
  const changes: Array<(b: SelectedSecretBindings) => void> = [
    ...["authority", "workspaceId", "profileId", "profileRevision", "slug", "version", "bundleDigest"].map(key => (b: SelectedSecretBindings) => { (b.selection as unknown as Record<string, string>)[key] = "wrong"; }),
    b => { b.consumer.stationId = "wrong-station"; }, b => { b.consumer.workspaceDirectory += "/elsewhere"; },
    b => { b.bindings = {}; }, b => { b.bindings.EXTRA = "demo/other"; }, b => { b.bindings.DECLARED_FIXTURE = "../outside"; },
    b => { b.secretsAuthority = "http://vault.example.com/v1"; }, b => { (b as any).value = "not-a-binding"; },
  ];
  let factories = 0;
  for (const change of changes) {
    const binding = bindingsFor(f); change(binding);
    await expect(executeSelectedLocal(f.resolved, { secretBindings: binding, createSecretsClient: () => { factories++; throw new Error("unexpected client"); } })).rejects.toBeInstanceOf(Error);
  }
  expect(factories).toBe(0);
});

test("vault errors, wrong authorities and expired or mismatched values fail without ambient fallback", async () => {
  const f = await fixture('throw new Error("must not run")', { env: ["DECLARED_FIXTURE"] });
  let reads = 0;
  await expect(executeSelectedLocal(f.resolved, { secretBindings: bindingsFor(f), createSecretsClient: () => ({ baseUrl: "https://other.example.com/v1", async getSecret() { reads++; throw new Error(); } }) })).rejects.toMatchObject({ code: "SECRET_BINDING_AUTHORITY_MISMATCH" });
  expect(reads).toBe(0);
  const privateError = crypto.randomUUID();
  const providers: Array<SelectedSecretsClient["getSecret"]> = [
    async () => { throw new Error(privateError); },
    async () => ({ key: "wrong-key", value: privateError }),
    async ({ key }) => ({ key, value: privateError, expires_at: "2000-01-01T00:00:00Z" }),
    async ({ key }) => ({ key, value: privateError, expires_at: "invalid" }),
    async ({ key }) => ({ key, value: "" }), async ({ key }) => ({ key, value: "a\0b" }),
  ];
  const old = process.env.DECLARED_FIXTURE; process.env.DECLARED_FIXTURE = privateError;
  try {
    for (const getSecret of providers) {
      let caught: any;
      try { await executeSelectedLocal(f.resolved, { secretBindings: bindingsFor(f), createSecretsClient: () => ({ baseUrl: "https://vault.example.com/v1", getSecret }) }); } catch (error) { caught = error; }
      expect(caught?.code).toBe("LOCAL_SECRET_UNAVAILABLE"); expect(caught?.message).not.toContain(privateError);
    }
  } finally { if (old === undefined) delete process.env.DECLARED_FIXTURE; else process.env.DECLARED_FIXTURE = old; }
});

test("secret rotation is fresh, returned output is redacted, and execution files contain no values", async () => {
  const f = await fixture('console.log(JSON.stringify({ value: process.env.DECLARED_FIXTURE })); console.error(Buffer.from(process.env.DECLARED_FIXTURE!).toString("base64"))', { env: ["DECLARED_FIXTURE"] });
  const values = [crypto.randomUUID(), crypto.randomUUID()]; let reads = 0;
  for (let index = 0; index < values.length; index++) {
    const result = await executeSelectedLocal(f.resolved, { secretBindings: bindingsFor(f), createSecretsClient: () => ({ baseUrl: "https://vault.example.com/v1", async getSecret({ key }) { return { key, value: values[reads++]! }; } }) });
    roots.push(result.runDirectory);
    expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout)).toEqual({ value: "[REDACTED]" }); expect(result.stderr).toBe("[REDACTED]\n");
    for (const value of values) {
      expect(JSON.stringify(result)).not.toContain(value);
      expect(readFileSync(join(result.runDirectory, ".execution-receipt.json"), "utf8")).not.toContain(value);
    }
  }
  expect(reads).toBe(2);
});

test("runtime control injection and mixed credential mechanisms are refused", async () => {
  for (const name of ["PATH", "HOME", "NODE_OPTIONS", "BUN_OPTIONS", "PYTHONPATH", "LD_PRELOAD", "SKILLS_INPUT_JSON"]) {
    await expect(executeSelectedLocal((await fixture("", { env: [name] })).resolved, { env: { [name]: "synthetic" } })).rejects.toMatchObject({ code: "INVALID_SKILL_MANIFEST" });
  }
  const f = await fixture("", { env: ["DECLARED_FIXTURE"] });
  await expect(executeSelectedLocal(f.resolved, { secretBindings: bindingsFor(f), env: { DECLARED_FIXTURE: "synthetic" } })).rejects.toMatchObject({ code: "INVALID_SECRET_BINDINGS" });
  await expect(executeSelectedLocal((await fixture("", { env: ["DUPLICATE", "DUPLICATE"] })).resolved)).rejects.toMatchObject({ code: "INVALID_SKILL_MANIFEST" });
});
