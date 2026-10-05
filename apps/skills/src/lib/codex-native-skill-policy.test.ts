import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { useDefaultTestTimeout } from "../test-preload.js";
import { planAgentIntegration, applyAgentIntegration, assertManagedAgentBridge, inventoryNativeSkills, isInertCodexPluginCacheCopy, type CodexNativePolicyGuardInput } from "./agent-integration.js";
import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { readManagedSkillPolicySnapshot, serializeManagedSkillPolicy } from "./managed-policy.js";
import { CLI_BRIDGE_DIGEST, CLI_BRIDGE_FILES } from "./agent-bridge.js";
import { verifyCodexNativeSkillPolicy, verifyCodexNativeAncestry, verifyCodexNativeBridgeDocument, parseCodexNativePolicyTrust, recordCodexNativePolicyAcceptance, codexNativePolicyReceiptPath, darwinProcessInspector, defaultProcessInspector, CODEX_NATIVE_POLICY_ANCESTRY_SAFETY_HOPS, CODEX_NATIVE_POLICY_RECEIPT_SCHEMA, type ProcessInspector, type CodexNativeHookEnvelope, type CodexNativePolicyVerification } from "./codex-native-skill-policy.js";
useDefaultTestTimeout();
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); });
const roots: string[] = []; afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const put = (p: string, s: string) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const payload = (name: string) => `---\nname: ${name}\ndescription: Synthetic plugin cache fixture\n---\nSynthetic native instructions\n`;
const SITES_SKILLS = ["sites-building", "sites-hosting", "sites-mcp", "sites-preview-troubleshooting"];
const DIGEST = "84fc7be4c841159225cc6f060169368e080d863e6948272e3d8f6b9d6298daf7";
const SESSION = "01a10e2d-8d78-72f3-9210-78cc6082fb4c", TURN = "01a10e2d-8df1-7632-9704-cb575ee2b98d";
/** The hook is pid 5000; its real parent chain is 4000 -> 3000 -> 2000 -> 1. */
const PARENTS: Record<number, number> = { 5000: 4000, 4000: 3000, 3000: 2000, 2000: 1 };
const HOOK_PID = 5000, CONSUMER_PID = 4000;

interface Station { home: string; dataDir: string; projectDir: string; plugin: string; bridgeDocument: string; executable: string; executableSha256: string; receipt: string }
function station(options: { materialize?: boolean; pin?: boolean | string } = {}): Station {
  const home = mkdtempSync(join(tmpdir(), "skills-native-policy-")); roots.push(home); admitCorpusFixture(join(home, ".codex"));
  const f = { home, dataDir: join(home, "data"), projectDir: home };
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["codex"] }));
  const plugin = join(home, ".codex", "plugins", "cache", "openai-curated-remote", "sites");
  if (options.materialize !== false) {
    // Materialize the plugin the way the Codex app does on station04 (sites 0.1.75).
    put(join(plugin, "0.1.75", ".codex-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "0.1.75", description: "Synthetic plugin" }));
    put(join(plugin, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: `plugins~Plugin_${"sites".padEnd(32, "0")}` }));
    for (const name of SITES_SKILLS) put(join(plugin, "0.1.75", "skills", name, "SKILL.md"), payload(name));
  }
  const executable = join(home, "codex-fixture-binary"); writeFileSync(executable, randomBytes(4096), { mode: 0o700 });
  const executableSha256 = sha(readFileSync(executable));
  if (options.pin !== false) {
    // Reviewed operator trust lives in the managed policy, never in package source.
    const snapshot = readManagedSkillPolicySnapshot(f.dataDir)!;
    snapshot.value.bridge.codexNativePolicy = { executableDigests: { "darwin-arm64": [typeof options.pin === "string" ? options.pin : executableSha256] } };
    writeFileSync(join(f.dataDir, "agent-policy.json"), serializeManagedSkillPolicy(snapshot.value));
  }
  return { ...f, plugin, bridgeDocument: realpathSync(join(home, ".codex", "skills", "skills-cli", "SKILL.md")), executable, executableSha256, receipt: codexNativePolicyReceiptPath(f.dataDir) };
}
function fakeInspector(s: Station, overrides: Partial<ProcessInspector> & { parents?: Record<number, number>; starts?: (pid: number) => string | null } = {}): ProcessInspector {
  const parents = overrides.parents ?? PARENTS;
  return { platform: "darwin", arch: "arm64", pid: HOOK_PID, parentOf: pid => parents[pid] ?? null, startTime: overrides.starts ?? (() => "1700000000.123456"), executablePath: () => s.executable, ...overrides };
}
function policy(s: Station, overrides: Record<string, unknown> = {}, remove: string[] = []): Record<string, unknown> {
  const value: Record<string, unknown> = { capability: "host-path-allowlist-v1", mode: "restricted", allowedHostPaths: [s.bridgeDocument], nonHostSources: "disabled", processId: CONSUMER_PID, effectiveConfigDigest: DIGEST, ...overrides };
  for (const key of remove) delete value[key];
  return value;
}
function envelope(s: Station, overrides: Partial<CodexNativeHookEnvelope> = {}, policyOverrides: Record<string, unknown> = {}, remove: string[] = []): CodexNativeHookEnvelope {
  return { event: "UserPromptSubmit", policy: policy(s, policyOverrides, remove), sessionId: SESSION, turnId: TURN, hookInputSha256: sha("{}"), ...overrides };
}
function verify(s: Station, input: CodexNativeHookEnvelope, inspector = fakeInspector(s), trust: unknown = readManagedSkillPolicySnapshot(s.dataDir)!.value.bridge.codexNativePolicy): string {
  try { verifyCodexNativeSkillPolicy({ envelope: input, bridgeDocument: s.bridgeDocument, expectedBridgeContent: CLI_BRIDGE_FILES["SKILL.md"]!, expectedBridgeSha256: CLI_BRIDGE_DIGEST, trust, inspector }); return "ACCEPTED"; }
  catch (error) { return (error as Error).message; }
}
function guard(s: Station, input?: CodexNativePolicyGuardInput): string {
  try { assertManagedAgentBridge("codex", { home: s.home, dataDir: s.dataDir, projectDir: s.projectDir, ...(input ? { codexNativePolicy: input } : {}) }); return "ACCEPTED"; }
  catch (error) { return (error as Error).message; }
}
const DRIFT = /^NATIVE_SKILL_DRIFT: 4 unexpected native skill copies were found/;

describe("adversarial: the acceptance path cannot pass yet", () => {
  test("a forged descendant hook naming a trusted, pinned ancestor with a restricted claim refuses without an authenticated channel binding", () => {
    // The fake inspector reports a valid ancestor, a stable start time and a
    // pinned executable digest; the envelope is well formed and names the exact
    // bridge. Nothing here proves the ancestor actually runs restricted, so the
    // adapter must still refuse and the guard must still stop the session.
    const s = station();
    expect(verify(s, envelope(s))).toMatch(/^NATIVE_SKILL_POLICY_UNAUTHENTICATED: /);
    const message = guard(s, { ...envelope(s), inspector: fakeInspector(s) });
    expect(message).toMatch(DRIFT);
    expect(message).toMatch(/Native policy adapter refused: NATIVE_SKILL_POLICY_UNAUTHENTICATED/);
    expect(existsSync(s.receipt)).toBe(false);
  });
  test("a SessionStart envelope (session_id, no turn_id) reaches the same gate", () => {
    const s = station();
    expect(verify(s, envelope(s, { event: "SessionStart", turnId: undefined }))).toMatch(/^NATIVE_SKILL_POLICY_UNAUTHENTICATED: /);
    expect(existsSync(s.receipt)).toBe(false);
  });
  test("the walk to root follows a deep real chain with no fixed depth limit", () => {
    const s = station(), parents: Record<number, number> = {};
    for (let pid = HOOK_PID; pid > 5000 - 20; pid--) parents[pid] = pid - 1;
    parents[5000 - 20] = 1;
    expect(verifyCodexNativeAncestry(fakeInspector(s, { parents }), 5000 - 15).hops).toBe(15);
    expect(verify(s, envelope(s, {}, { processId: 5000 - 15 }), fakeInspector(s, { parents }))).toMatch(/^NATIVE_SKILL_POLICY_UNAUTHENTICATED: /);
  });
});

describe("envelope validation", () => {
  const cases: Array<[string, (s: Station) => CodexNativeHookEnvelope, RegExp]> = [
    ["field missing", s => envelope(s, {}, {}, ["processId"]), /^NATIVE_SKILL_POLICY_INVALID: native_skill_policy.processId is missing/],
    ["extra key", s => envelope(s, {}, { originator: "codex" }), /^NATIVE_SKILL_POLICY_INVALID: native_skill_policy carries unknown fields/],
    ["unknown capability", s => envelope(s, {}, { capability: "host-path-allowlist-v2" }), /^NATIVE_SKILL_POLICY_UNSUPPORTED: unknown native skill policy capability/],
    ["mode unrestricted", s => envelope(s, {}, { mode: "unrestricted" }), /^NATIVE_SKILL_POLICY_UNSUPPORTED: native skill policy is not restricted/],
    ["nonHostSources unchanged", s => envelope(s, {}, { nonHostSources: "unchanged" }), /^NATIVE_SKILL_POLICY_UNSUPPORTED: native non-host skill sources are not disabled/],
    ["allowedHostPaths null", s => envelope(s, {}, { allowedHostPaths: null }), /^NATIVE_SKILL_POLICY_INVALID: allowedHostPaths must list exactly one document/],
    ["allowedHostPaths empty", s => envelope(s, {}, { allowedHostPaths: [] }), /^NATIVE_SKILL_POLICY_INVALID: allowedHostPaths must list exactly one document/],
    ["allowedHostPaths two entries", s => envelope(s, {}, { allowedHostPaths: [s.bridgeDocument, join(s.plugin, "0.1.75", "skills", "sites-mcp", "SKILL.md")] }), /^NATIVE_SKILL_POLICY_INVALID: allowedHostPaths must list exactly one document/],
    ["allowedHostPaths wrong path", s => envelope(s, {}, { allowedHostPaths: [join(s.home, ".agents", "skills", "skills-cli", "SKILL.md")] }), /^NATIVE_SKILL_POLICY_BRIDGE_UNVERIFIED: the allowed host path is not the Skills bridge document/],
    ["malformed digest", s => envelope(s, {}, { effectiveConfigDigest: DIGEST.toUpperCase() }), /^NATIVE_SKILL_POLICY_INVALID: effectiveConfigDigest must be lowercase SHA-256 hex/],
    ["processId not an integer", s => envelope(s, {}, { processId: "4000" }), /^NATIVE_SKILL_POLICY_INVALID: processId must be a positive process id/],
    ["session_id missing", s => envelope(s, { sessionId: undefined }), /^NATIVE_SKILL_POLICY_INVALID: session_id must be a bounded non-empty string/],
    ["session_id empty", s => envelope(s, { sessionId: "" }), /^NATIVE_SKILL_POLICY_INVALID: session_id must be a bounded non-empty string/],
    ["turn_id missing on UserPromptSubmit", s => envelope(s, { turnId: undefined }), /^NATIVE_SKILL_POLICY_INVALID: turn_id must be a bounded non-empty string/],
    ["turn_id present on SessionStart", s => envelope(s, { event: "SessionStart" }), /^NATIVE_SKILL_POLICY_INVALID: SessionStart input carries no turn_id/],
    ["unsupported event", s => envelope(s, { event: "SubagentStart" as never }), /^NATIVE_SKILL_POLICY_INVALID: native policy is only carried by SessionStart and UserPromptSubmit/],
    ["hook input digest malformed", s => envelope(s, { hookInputSha256: "abc" }), /^NATIVE_SKILL_POLICY_INVALID: hook input digest must be lowercase SHA-256 hex/],
  ];
  for (const [name, build, expected] of cases) test(`${name} refuses and writes no receipt`, () => {
    const s = station();
    expect(verify(s, build(s))).toMatch(expected);
    const message = guard(s, { ...build(s), inspector: fakeInspector(s) });
    expect(message).toMatch(DRIFT); expect(message).toMatch(expected.source.replace(/^\^/, "").replace(/\\\./g, "."));
    expect(existsSync(s.receipt)).toBe(false);
  });
});

describe("bridge verification", () => {
  test("changed bridge bytes refuse", () => {
    const s = station(), copy = join(s.home, "bridge-copy", "SKILL.md");
    put(copy, `${CLI_BRIDGE_FILES["SKILL.md"]}\n`);
    expect(() => verifyCodexNativeBridgeDocument(realpathSync(copy), CLI_BRIDGE_FILES["SKILL.md"]!, CLI_BRIDGE_DIGEST)).toThrow(/^NATIVE_SKILL_POLICY_BRIDGE_UNVERIFIED: the bridge document bytes differ/);
    writeFileSync(s.bridgeDocument, `${CLI_BRIDGE_FILES["SKILL.md"]}\n`);
    expect(verify(s, envelope(s))).toMatch(/^NATIVE_SKILL_POLICY_BRIDGE_UNVERIFIED: /);
    expect(guard(s, { ...envelope(s), inspector: fakeInspector(s) })).toMatch(/^NATIVE_SKILL_DRIFT: /);
    expect(existsSync(s.receipt)).toBe(false);
  });
  test("a symlinked bridge document or component refuses", () => {
    const s = station(), original = join(s.home, "bridge-original", "SKILL.md");
    put(original, CLI_BRIDGE_FILES["SKILL.md"]!);
    rmSync(s.bridgeDocument); symlinkSync(original, s.bridgeDocument);
    expect(() => verifyCodexNativeBridgeDocument(s.bridgeDocument, CLI_BRIDGE_FILES["SKILL.md"]!, CLI_BRIDGE_DIGEST)).toThrow(/^NATIVE_SKILL_POLICY_BRIDGE_UNVERIFIED: the bridge path has a missing, linked or unexpected component/);
    expect(guard(s, { ...envelope(s), inspector: fakeInspector(s) })).toMatch(/^NATIVE_SKILL_DRIFT: /);
    expect(existsSync(s.receipt)).toBe(false);
    const linkedHome = join(s.home, "linked-home"); symlinkSync(join(s.home, ".codex"), linkedHome);
    expect(() => verifyCodexNativeBridgeDocument(join(linkedHome, "skills", "skills-cli", "SKILL.md"), CLI_BRIDGE_FILES["SKILL.md"]!, CLI_BRIDGE_DIGEST)).toThrow(/^NATIVE_SKILL_POLICY_BRIDGE_UNVERIFIED: /);
  });
});

describe("process binding", () => {
  test("a processId that is not an ancestor refuses", () => {
    const s = station();
    expect(verify(s, envelope(s, {}, { processId: 9999 }))).toMatch(/^NATIVE_SKILL_POLICY_PROCESS_UNBOUND: the claimed consumer is not an ancestor/);
    expect(verify(s, envelope(s, {}, { processId: HOOK_PID }))).toMatch(/^NATIVE_SKILL_POLICY_PROCESS_UNBOUND: the claimed consumer is the hook process itself/);
    const message = guard(s, { ...envelope(s, {}, { processId: 9999 }), inspector: fakeInspector(s) });
    expect(message).toMatch(DRIFT); expect(message).toMatch(/NATIVE_SKILL_POLICY_PROCESS_UNBOUND/);
    expect(existsSync(s.receipt)).toBe(false);
  });
  test("a looping parent chain and a chain beyond the safety bound refuse without hanging", () => {
    const s = station();
    expect(() => verifyCodexNativeAncestry(fakeInspector(s, { parents: { 5000: 4000, 4000: 5000 } }), 9999)).toThrow(/the parent chain loops/);
    const parents: Record<number, number> = {}; for (let pid = HOOK_PID; pid > HOOK_PID - CODEX_NATIVE_POLICY_ANCESTRY_SAFETY_HOPS - 5; pid--) parents[pid] = pid - 1;
    expect(() => verifyCodexNativeAncestry(fakeInspector(s, { parents }), HOOK_PID - CODEX_NATIVE_POLICY_ANCESTRY_SAFETY_HOPS - 2)).toThrow(/exceeded the walk safety bound/);
  });
  test("a start time that changes between reads refuses as pid reuse", () => {
    const s = station(); let reads = 0;
    expect(verify(s, envelope(s), fakeInspector(s, { starts: () => `1700000000.${++reads}` }))).toMatch(/^NATIVE_SKILL_POLICY_PROCESS_UNBOUND: the consumer process changed while its executable was hashed/);
    expect(existsSync(s.receipt)).toBe(false);
  });
  test("an executable digest that is not pinned refuses", () => {
    const s = station({ pin: "0".repeat(64) });
    expect(verify(s, envelope(s))).toMatch(/^NATIVE_SKILL_POLICY_EXECUTABLE_UNPINNED: the consumer executable digest is not a reviewed Codex artifact/);
    expect(existsSync(s.receipt)).toBe(false);
  });
  test("absent trust configuration is an empty set and refuses", () => {
    const s = station({ pin: false });
    expect(readManagedSkillPolicySnapshot(s.dataDir)!.value.bridge.codexNativePolicy).toBeUndefined();
    expect(parseCodexNativePolicyTrust(undefined)).toEqual({ executableDigests: {} });
    expect(verify(s, envelope(s))).toMatch(/^NATIVE_SKILL_POLICY_EXECUTABLE_UNPINNED: no reviewed Codex executable digest is configured for darwin-arm64/);
    const message = guard(s, { ...envelope(s), inspector: fakeInspector(s) });
    expect(message).toMatch(DRIFT); expect(message).toMatch(/NATIVE_SKILL_POLICY_EXECUTABLE_UNPINNED/);
    expect(existsSync(s.receipt)).toBe(false);
  });
  test("Linux stays unqualified", () => {
    const s = station();
    expect(verify(s, envelope(s), fakeInspector(s, { platform: "linux", arch: "x64" }))).toMatch(/^NATIVE_SKILL_POLICY_EXECUTABLE_UNPINNED: no reviewed Codex executable digest is configured for linux-x64/);
    expect(existsSync(s.receipt)).toBe(false);
  });
  test("invalid trust configuration refuses rather than reading as empty", () => {
    const s = station();
    for (const trust of [{ executableDigests: { "darwin-arm64": [s.executableSha256.toUpperCase()] } }, { executableDigests: { "windows-x64": [s.executableSha256] } }, { executableDigests: {}, extra: true }, { executableDigests: { "darwin-arm64": [s.executableSha256, s.executableSha256] } }, []]) {
      expect(() => parseCodexNativePolicyTrust(trust)).toThrow(/^NATIVE_SKILL_POLICY_TRUST_INVALID: /);
      expect(verify(s, envelope(s), fakeInspector(s), trust)).toMatch(/^NATIVE_SKILL_POLICY_TRUST_INVALID: /);
    }
  });
});

describe("guard scope", () => {
  test("no native_skill_policy at all keeps today's refusal, with no adapter text", () => {
    const s = station();
    const message = guard(s);
    expect(message).toMatch(DRIFT); expect(message).not.toMatch(/Native policy adapter/);
    expect(existsSync(s.receipt)).toBe(false);
  });
  test("a non-cache native copy beside the plugin cache refuses even with a well-formed policy", () => {
    const s = station();
    put(join(s.home, ".codex", "skills", "x", "SKILL.md"), payload("x"));
    const message = guard(s, { ...envelope(s), inspector: fakeInspector(s) });
    expect(message).toMatch(/^NATIVE_SKILL_DRIFT: 5 unexpected native skill copies were found/);
    expect(existsSync(s.receipt)).toBe(false);
  });
  test("the adapter is not consulted when nothing is unexpected", () => {
    const s = station({ materialize: false });
    expect(guard(s, { ...envelope(s, {}, { capability: "forged" }), inspector: fakeInspector(s) })).toBe("ACCEPTED");
    expect(existsSync(s.receipt)).toBe(false);
  });
  test("only package-classified plugin-cache documents the policy cannot load are inert candidates", () => {
    const s = station(), cache = realpathSync(join(s.home, ".codex", "plugins", "cache"));
    put(join(s.home, ".codex", "skills", "x", "SKILL.md"), payload("x"));
    put(join(s.home, ".agents", "skills", "y", "SKILL.md"), payload("y"));
    put(join(cache, "openai-curated-remote", "loose", "SKILL.md"), payload("loose"));
    const inventory = inventoryNativeSkills(realpathSync(s.home), { includeVendor: true, agents: ["codex"], projectDir: realpathSync(s.home) });
    const read = (path: string) => readFileSync(path, "utf8");
    const byName = (name: string) => inventory.find(entry => entry.path.endsWith(`${name}`))!;
    for (const name of SITES_SKILLS) expect(isInertCodexPluginCacheCopy(byName(join("skills", name)), cache, [s.bridgeDocument], read)).toBe(true);
    // A path prefix alone is never enough: an unclassified cache file refuses.
    expect(isInertCodexPluginCacheCopy(byName(join("openai-curated-remote", "loose")), cache, [s.bridgeDocument], read)).toBe(false);
    expect(isInertCodexPluginCacheCopy(byName(join(".codex", "skills", "x")), cache, [s.bridgeDocument], read)).toBe(false);
    expect(isInertCodexPluginCacheCopy(byName(join(".agents", "skills", "y")), cache, [s.bridgeDocument], read)).toBe(false);
    // A document the policy would load is not inert, whatever its classification.
    const mcp = byName(join("skills", "sites-mcp"));
    expect(isInertCodexPluginCacheCopy(mcp, cache, [join(mcp.path, "SKILL.md")], read)).toBe(false);
    // A symlinked component refuses.
    const linked = join(cache, "openai-curated-remote", "linked"); symlinkSync(join(cache, "openai-curated-remote", "sites"), linked);
    expect(isInertCodexPluginCacheCopy({ ...mcp, path: join(linked, "0.1.75", "skills", "sites-mcp") }, cache, [s.bridgeDocument], read)).toBe(false);
  });
});

describe("receipt", () => {
  const verification = (s: Station): CodexNativePolicyVerification => ({ event: "UserPromptSubmit", sessionId: SESSION, turnId: TURN, policy: { capability: "host-path-allowlist-v1", mode: "restricted", allowedHostPaths: [s.bridgeDocument], nonHostSources: "disabled", processId: CONSUMER_PID, effectiveConfigDigest: DIGEST }, platform: "darwin-arm64", ancestryHops: 1, processStartTime: "1700000000.123456", executablePath: s.executable, executableSha256: s.executableSha256, bridge: { path: s.bridgeDocument, sha256: CLI_BRIDGE_DIGEST } });
  test("records the accepted hook with mode 0600 and sorted cache entries", () => {
    const s = station(), entries = SITES_SKILLS.map(name => ({ path: join(s.plugin, "0.1.75", "skills", name), treeSha256: sha(name) })).reverse();
    expect(recordCodexNativePolicyAcceptance(s.dataDir, verification(s), entries)).toBe(s.receipt);
    expect(lstatSync(s.receipt).mode & 0o777).toBe(0o600);
    const value = JSON.parse(readFileSync(s.receipt, "utf8"));
    expect(value).toMatchObject({ schema: CODEX_NATIVE_POLICY_RECEIPT_SCHEMA, event: "UserPromptSubmit", sessionId: SESSION, turnId: TURN, process: { id: CONSUMER_PID, startTime: "1700000000.123456", executablePath: s.executable, executableSha256: s.executableSha256, platform: "darwin-arm64" }, effectiveConfigDigest: DIGEST, bridge: { path: s.bridgeDocument, sha256: CLI_BRIDGE_DIGEST } });
    expect(value.acceptedCache.map((entry: { path: string }) => entry.path)).toEqual([...entries].map(entry => entry.path).sort());
    expect(existsSync(`${s.receipt}.skills-`)).toBe(false);
  });
  test("refuses to write through a link or into a non-directory", () => {
    const s = station();
    put(join(s.dataDir, "elsewhere", "file.json"), "{}");
    mkdirSync(s.dataDir, { recursive: true }); symlinkSync(join(s.dataDir, "elsewhere"), join(s.dataDir, "agent-hooks"));
    expect(() => recordCodexNativePolicyAcceptance(s.dataDir, verification(s), [])).toThrow(/^NATIVE_SKILL_POLICY_RECEIPT_FAILED: /);
    rmSync(join(s.dataDir, "agent-hooks")); writeFileSync(join(s.dataDir, "agent-hooks"), "");
    expect(() => recordCodexNativePolicyAcceptance(s.dataDir, verification(s), [])).toThrow(/^NATIVE_SKILL_POLICY_RECEIPT_FAILED: /);
    expect(() => recordCodexNativePolicyAcceptance(join(s.dataDir, "fresh"), verification(s), [{ path: "relative", treeSha256: sha("x") }])).toThrow(/^NATIVE_SKILL_POLICY_RECEIPT_FAILED: /);
  });
});

describe("real process inspector", () => {
  test.skipIf(process.platform !== "darwin")("Darwin libproc reports this test's own parent chain and start times consistently", () => {
    const inspector = darwinProcessInspector();
    expect(inspector.pid).toBe(process.pid);
    expect(inspector.parentOf(process.pid)).toBe(process.ppid);
    const start = inspector.startTime(process.pid);
    expect(start).toMatch(/^\d+\.\d+$/);
    expect(inspector.startTime(process.pid)).toBe(start);
    expect(inspector.executablePath(process.pid)).toBe(realpathSync(process.execPath));
    const chain: number[] = [];
    for (let pid = process.pid, hops = 0; hops < 8; hops++) { const parent = inspector.parentOf(pid); if (parent === null || parent <= 1) break; chain.push(parent); expect(inspector.startTime(parent)).toBe(inspector.startTime(parent)); pid = parent; }
    expect(chain[0]).toBe(process.ppid);
    expect(verifyCodexNativeAncestry(inspector, process.ppid).hops).toBe(1);
    expect(() => verifyCodexNativeAncestry(inspector, process.pid)).toThrow(/the hook process itself/);
    expect(inspector.parentOf(0x7ffffff0)).toBeNull();
    expect(inspector.executablePath(0x7ffffff0)).toBeNull();
    expect(defaultProcessInspector().parentOf(process.pid)).toBe(process.ppid);
  });
});
