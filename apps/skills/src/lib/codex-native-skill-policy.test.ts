import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { chmodSync, closeSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { useDefaultTestTimeout } from "../test-preload.js";
import { planAgentIntegration, applyAgentIntegration, assertManagedAgentBridge, inventoryNativeSkills, isInertCodexPluginCacheCopy, type CodexNativePolicyGuardInput } from "./agent-integration.js";
import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { readManagedSkillPolicySnapshot, serializeManagedSkillPolicy } from "./managed-policy.js";
import { CLI_BRIDGE_DIGEST, CLI_BRIDGE_FILES } from "./agent-bridge.js";
import { verifyCodexNativeSkillPolicy, verifyCodexNativeAncestry, verifyCodexNativeBridgeDocument, verifyCodexNativeChannelBinding, verifyCodexNativeExecutable, qualifiedExecutableSha256, executableWitness, executableCachePath, assertExecutableWitnessStat, runCodexNativePolicyHelper, parseCodexNativePolicyTrust, recordCodexNativePolicyAcceptance, codexNativePolicyReceiptPath, codexNativeHookEnvelopeFromInput, darwinProcessInspector, defaultProcessInspector, CODEX_NATIVE_POLICY_PEER_SCHEMA, CODEX_NATIVE_POLICY_EXECUTABLE_CACHE_SCHEMA, type NativePolicyHelperRunner, type NativePolicyHelperRequest, CODEX_NATIVE_POLICY_ANCESTRY_SAFETY_HOPS, CODEX_NATIVE_POLICY_RECEIPT_SCHEMA, type ProcessInspector, type CodexNativeHookEnvelope, type CodexNativePolicyVerification } from "./codex-native-skill-policy.js";
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
    ["inherited descriptor malformed", s => envelope(s, { inheritedFd: -1 }), /^NATIVE_SKILL_POLICY_INVALID: the inherited channel descriptor must be a non-negative integer/],
  ];
  for (const [name, build, expected] of cases) test(`${name} refuses and writes no receipt`, () => {
    const s = station();
    expect(verify(s, build(s))).toMatch(expected);
    const message = guard(s, { ...build(s), inspector: fakeInspector(s) });
    expect(message).toMatch(DRIFT); expect(message).toMatch(expected.source.replace(/^\^/, "").replace(/\\\./g, "."));
    expect(existsSync(s.receipt)).toBe(false);
  });
});

/** The six native hook rows of the reviewed proof (internal-apps #1475 run
 * 37379158142, native-skill-policy-proof/hook-inputs.jsonl; Files f_vtmq3HBqZa,
 * sha256 61e55917…). Same keys, order, spacing and values; only the proof's
 * runner paths and pid are substituted. The proof's allowlist names the bridge
 * under its synthetic home's .agents/skills, not the .codex/skills bridge this
 * package installs for Codex, which the adapter refuses by design. */
function nativeProofRows(allowedHostPath: string, cwd: string, processId: number): string[] {
  const unrestricted = `{"capability": "host-path-allowlist-v1", "mode": "unrestricted", "allowedHostPaths": null, "nonHostSources": "unchanged", "processId": ${processId}, "effectiveConfigDigest": "81e681238f1466311f87480d5a7f8eeaeeb9dca1d490b4d53f3a0344fc70d6aa"}`;
  const restricted = `{"capability": "host-path-allowlist-v1", "mode": "restricted", "allowedHostPaths": [${JSON.stringify(allowedHostPath)}], "nonHostSources": "disabled", "processId": ${processId}, "effectiveConfigDigest": "84fc7be4c841159225cc6f060169368e080d863e6948272e3d8f6b9d6298daf7"}`;
  const start = (policy: string, session: string) => `{"native_skill_policy": ${policy}, "session_id": "${session}", "transcript_path": null, "cwd": ${JSON.stringify(cwd)}, "hook_event_name": "SessionStart", "model": "gpt-5.4", "permission_mode": "bypassPermissions", "source": "startup"}`;
  const prompt = (policy: string, session: string, turn: string, text: string) => `{"native_skill_policy": ${policy}, "session_id": "${session}", "turn_id": "${turn}", "transcript_path": null, "cwd": ${JSON.stringify(cwd)}, "hook_event_name": "UserPromptSubmit", "model": "gpt-5.4", "permission_mode": "bypassPermissions", "prompt": ${JSON.stringify(text)}}`;
  return [
    start(unrestricted, "01a10e2d-8d38-7b42-aac9-cae4992ddac6"),
    prompt(unrestricted, "01a10e2d-8d38-7b42-aac9-cae4992ddac6", "01a10e2d-8d7d-7730-a602-32cad50ec95d", "Use $native-policy-ordinary and $sample:build."),
    start(restricted, "01a10e2d-8d78-72f3-9210-78cc6082fb4c"),
    prompt(restricted, "01a10e2d-8d78-72f3-9210-78cc6082fb4c", "01a10e2d-8df1-7632-9704-cb575ee2b98d", "Use $native-policy-ordinary and $sample:build and $skills-cli and $sample:skills-cli."),
    start(restricted, "01a10e2d-8e29-79b0-91fd-08c22aea18ac"),
    prompt(restricted, "01a10e2d-8e29-79b0-91fd-08c22aea18ac", "01a10e2d-8e2c-7c11-9fcf-808fc9dde676", "Use $sample:build and $sample:novel and $sample:skills-cli and $skills-cli."),
  ];
}

describe("native proof rows through the hook input path", () => {
  test("each row maps exactly as the Codex hook does and refuses as expected", () => {
    const s = station(), cwd = join(s.home, "project");
    for (const line of nativeProofRows(join(s.home, ".agents", "skills", "skills-cli", "SKILL.md"), cwd, CONSUMER_PID)) {
      const input = JSON.parse(line), mapped = codexNativeHookEnvelopeFromInput(input, input.hook_event_name, Buffer.from(line, "utf8"))!;
      expect(mapped.event).toBe(input.hook_event_name);
      expect(mapped.hookInputSha256).toBe(sha(line));
      expect(mapped.sessionId).toBe(input.session_id);
      expect("turnId" in mapped).toBe(input.hook_event_name === "UserPromptSubmit");
      expect(verify(s, mapped)).toMatch(input.native_skill_policy.mode === "unrestricted" ? /^NATIVE_SKILL_POLICY_UNSUPPORTED: native skill policy is not restricted/ : /^NATIVE_SKILL_POLICY_BRIDGE_UNVERIFIED: the allowed host path is not the Skills bridge document/);
      const message = guard(s, { ...mapped, inspector: fakeInspector(s) });
      expect(message).toMatch(DRIFT); expect(message).toMatch(/Native policy adapter refused: NATIVE_SKILL_POLICY_/);
    }
    // With the allowlist naming the Codex bridge this package installs, the
    // restricted rows pass every check up to the channel-binding gate.
    for (const line of nativeProofRows(s.bridgeDocument, cwd, CONSUMER_PID).slice(2)) {
      const input = JSON.parse(line), mapped = codexNativeHookEnvelopeFromInput(input, input.hook_event_name, Buffer.from(line, "utf8"))!;
      expect(verify(s, mapped)).toMatch(/^NATIVE_SKILL_POLICY_UNAUTHENTICATED: /);
    }
    expect(existsSync(s.receipt)).toBe(false);
  });
  test("inputs without native policy, or on other events, map to no envelope", () => {
    const raw = Buffer.from("{}", "utf8");
    expect(codexNativeHookEnvelopeFromInput({ session_id: SESSION, hook_event_name: "SessionStart" }, "SessionStart", raw)).toBeUndefined();
    expect(codexNativeHookEnvelopeFromInput({ native_skill_policy: {}, session_id: SESSION }, "SubagentStart", raw)).toBeUndefined();
    expect(codexNativeHookEnvelopeFromInput({ native_skill_policy: {}, session_id: SESSION }, "SessionStart", raw, "7")).toMatchObject({ event: "SessionStart", inheritedFd: 7, hookInputSha256: sha(raw) });
    expect(codexNativeHookEnvelopeFromInput({ native_skill_policy: {}, session_id: SESSION }, "SessionStart", raw, "x")).toMatchObject({ inheritedFd: "x" });
    // The digest covers the raw bytes, not a decoded or re-serialized form.
    const invalid = Buffer.concat([Buffer.from('{"native_skill_policy": {}, "session_id": "'), Buffer.from([0xff]), Buffer.from('"}')]);
    expect(codexNativeHookEnvelopeFromInput({ native_skill_policy: {}, session_id: "x" }, "SessionStart", invalid)!.hookInputSha256).toBe(sha(invalid));
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

/** A readable channel descriptor: a FIFO opened non-blocking for reading, with
 * an optional payload written through a writer end. Stands in for the native
 * socketpair's read end; tests have no socketpair API. */
function channelFixture(s: Station, payload?: string): number {
  const path = join(s.home, `chan-${randomBytes(4).toString("hex")}`);
  const made = Bun.spawnSync(["/usr/bin/mkfifo", path]);
  if (made.exitCode !== 0) throw new Error("mkfifo failed");
  const reader = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  if (payload !== undefined) { const writer = openSync(path, constants.O_WRONLY | constants.O_NONBLOCK); writeSync(writer, payload); closeSync(writer); }
  roots.push(path);
  return reader;
}
const RAW_INPUT = Buffer.from('{"native_skill_policy": {}}', "utf8"), RAW_SHA = sha(RAW_INPUT);
function attestation(s: Station, overrides: Record<string, unknown> = {}, remove: string[] = []): string {
  const value: Record<string, unknown> = { schema: CODEX_NATIVE_POLICY_PEER_SCHEMA, peerProcessId: CONSUMER_PID, stdinSha256: RAW_SHA, policy: policy(s), ...overrides };
  for (const key of remove) delete value[key];
  return JSON.stringify(value);
}
function fakeRunner(output: string | Buffer, result: Partial<NativePolicyHelperResult> = {}, seen: NativePolicyHelperRequest[] = []): NativePolicyHelperRunner {
  return request => { seen.push(request); return { exitCode: 0, stdout: Buffer.isBuffer(output) ? output : Buffer.from(output, "utf8"), timedOut: false, oversized: false, ...result }; };
}
function bind(s: Station, fd: number | null, runner: NativePolicyHelperRunner, overrides: Partial<Parameters<typeof verifyCodexNativeChannelBinding>[0]> = {}): string {
  try {
    const result = verifyCodexNativeChannelBinding({ executablePath: s.executable, inheritedFd: fd, expectedProcessId: CONSUMER_PID, expectedStartTime: "1700000000.123456", inputSha256: RAW_SHA, emittedPolicy: policy(s), inspector: fakeInspector(s), runner, ...overrides });
    return `ACCEPTED ${JSON.stringify(result)}`;
  } catch (error) { return (error as Error).message; }
}
type NativePolicyHelperResult = ReturnType<NativePolicyHelperRunner>;

describe("draft authenticated channel binding (not wired into acceptance)", () => {
  test("a matching attestation from the fake helper passes and the helper receives the verified binary, fd 3 and the raw digest", () => {
    const s = station(), seen: NativePolicyHelperRequest[] = [];
    expect(bind(s, channelFixture(s), fakeRunner(attestation(s), {}, seen))).toBe(`ACCEPTED ${JSON.stringify({ schema: CODEX_NATIVE_POLICY_PEER_SCHEMA, peerProcessId: CONSUMER_PID })}`);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ executablePath: s.executable, expectedProcessId: CONSUMER_PID, inputSha256: RAW_SHA, timeoutMs: 5000, maxOutputBytes: 65536 });
    expect(seen[0]!.fd).toBeGreaterThan(2);
  });
  test("forged descendant: the real parent attests unrestricted, so the restricted claim refuses", () => {
    const s = station();
    const realParent = policy(s, { mode: "unrestricted", allowedHostPaths: null, nonHostSources: "unchanged", effectiveConfigDigest: "81e681238f1466311f87480d5a7f8eeaeeb9dca1d490b4d53f3a0344fc70d6aa" });
    expect(bind(s, channelFixture(s), fakeRunner(attestation(s, { policy: realParent })))).toMatch(/^NATIVE_SKILL_POLICY_UNAUTHENTICATED: the attested policy differs from the emitted native_skill_policy/);
    // Or the real writer is another process than the one the forged envelope names.
    expect(bind(s, channelFixture(s), fakeRunner(attestation(s, { peerProcessId: 3000 })))).toMatch(/^NATIVE_SKILL_POLICY_UNAUTHENTICATED: the attested peer process is not the qualified consumer/);
  });
  test("the proof is never cached: every call runs the helper again, SessionStart included", () => {
    const s = station(), seen: NativePolicyHelperRequest[] = [], runner = fakeRunner(attestation(s), {}, seen);
    for (let index = 0; index < 3; index++) expect(bind(s, channelFixture(s), runner)).toMatch(/^ACCEPTED /);
    expect(seen).toHaveLength(3);
  });
  const refusals: Array<[string, (s: Station) => [number | null, NativePolicyHelperRunner, Partial<Parameters<typeof verifyCodexNativeChannelBinding>[0]>?], RegExp]> = [
    ["env/FD missing", s => [null, fakeRunner(attestation(s))], /CODEX_NATIVE_SKILL_POLICY_FD is not set/],
    ["FD closed", s => { const fd = channelFixture(s); closeSync(fd); return [fd, fakeRunner(attestation(s))]; }, /the inherited channel descriptor is closed or not inheritable/],
    ["FD is a regular file, not a channel", s => [openSync(s.executable, constants.O_RDONLY), fakeRunner(attestation(s))], /the inherited channel descriptor is not a socket or pipe/],
    ["raw input digest missing", s => [channelFixture(s), fakeRunner(attestation(s)), { inputSha256: null }], /the raw hook input digest is missing/],
    ["helper non-zero exit", s => [channelFixture(s), fakeRunner(attestation(s), { exitCode: 2 })], /the native policy helper exited with status 2/],
    ["helper killed by signal", s => [channelFixture(s), fakeRunner(attestation(s), { exitCode: null })], /the native policy helper exited with a signal/],
    ["helper timeout", s => [channelFixture(s), fakeRunner(attestation(s), { timedOut: true })], /the native policy helper timed out/],
    ["oversized output flag", s => [channelFixture(s), fakeRunner(attestation(s), { oversized: true })], /the native policy helper output exceeded its bound/],
    ["oversized output bytes", s => [channelFixture(s), fakeRunner(Buffer.alloc(65537, 0x20))], /the native policy helper output exceeded its bound/],
    ["malformed JSON", s => [channelFixture(s), fakeRunner("{not json")], /the native policy helper output is not JSON/],
    ["invalid UTF-8", s => [channelFixture(s), fakeRunner(Buffer.from([0xff, 0xfe]))], /the native policy helper output is not JSON/],
    ["not an object", s => [channelFixture(s), fakeRunner("[]")], /the native policy helper output is not an object/],
    ["unknown key", s => [channelFixture(s), fakeRunner(attestation(s, { challenge: "x" }))], /the native policy attestation has missing or unknown fields/],
    ["missing key", s => [channelFixture(s), fakeRunner(attestation(s, {}, ["stdinSha256"]))], /the native policy attestation has missing or unknown fields/],
    ["schema mismatch", s => [channelFixture(s), fakeRunner(attestation(s, { schema: "native-hook-policy-peer-v2" }))], /unknown native policy attestation schema/],
    ["wrong peerProcessId", s => [channelFixture(s), fakeRunner(attestation(s, { peerProcessId: HOOK_PID }))], /the attested peer process is not the qualified consumer/],
    ["peerProcessId as string", s => [channelFixture(s), fakeRunner(attestation(s, { peerProcessId: String(CONSUMER_PID) }))], /the attested peer process is not the qualified consumer/],
    ["wrong stdinSha256", s => [channelFixture(s), fakeRunner(attestation(s, { stdinSha256: sha("other") }))], /the attested hook input digest differs from the raw stdin digest/],
    ["policy digest mismatch", s => [channelFixture(s), fakeRunner(attestation(s, { policy: policy(s, { effectiveConfigDigest: sha("other") }) }))], /the attested policy differs from the emitted native_skill_policy/],
    ["policy extra field", s => [channelFixture(s), fakeRunner(attestation(s, { policy: policy(s, { originator: "codex" }) }))], /the attested policy differs from the emitted native_skill_policy/],
    ["policy field missing", s => [channelFixture(s), fakeRunner(attestation(s, { policy: policy(s, {}, ["processId"]) }))], /the attested policy differs from the emitted native_skill_policy/],
    ["consumer restarted while the helper ran", s => [channelFixture(s), fakeRunner(attestation(s)), { expectedStartTime: "1600000000.0" }], /the consumer process changed while the helper ran/],
  ];
  for (const [name, build, expected] of refusals) test(`${name} refuses`, () => {
    const s = station(), [fd, runner, overrides] = build(s);
    expect(bind(s, fd, runner, overrides)).toMatch(new RegExp(`^NATIVE_SKILL_POLICY_UNAUTHENTICATED: ${expected.source}`));
  });
});

describe("production helper runner", () => {
  // A stand-in binary that behaves like `debug verify-hook-policy`: it reads the
  // forwarded descriptor 3, echoes the argv it received and prints an
  // attestation. It proves the FD forwarding and the bounds, not the native helper.
  function helperFixture(s: Station, body: string): string {
    const script = join(s.home, "helper.ts"), launcher = join(s.home, "helper");
    writeFileSync(script, body);
    writeFileSync(launcher, `#!${process.execPath}\nimport "${script}";\n`, { mode: 0o700 });
    return launcher;
  }
  test("forwards the inherited descriptor as fd 3, passes the exact argv, clears the env and bounds the run", () => {
    const s = station(), fd = channelFixture(s, "challenge-bytes");
    const helper = helperFixture(s, `import { readFileSync, fstatSync } from "node:fs";
const channel = readFileSync(3).toString("utf8"), fifo = fstatSync(3).isFIFO();
console.log(JSON.stringify({ argv: process.argv.slice(2), channel, fifo, env: Object.keys(process.env), cwd: process.cwd() }));`);
    const result = runCodexNativePolicyHelper({ executablePath: helper, fd, expectedProcessId: CONSUMER_PID, inputSha256: RAW_SHA, timeoutMs: 10_000, maxOutputBytes: 65536 });
    expect(result).toMatchObject({ exitCode: 0, timedOut: false, oversized: false });
    expect(JSON.parse(result.stdout.toString("utf8"))).toEqual({ argv: ["debug", "verify-hook-policy", "--fd", "3", "--expected-process-id", String(CONSUMER_PID), "--input-sha256", RAW_SHA], channel: "challenge-bytes", fifo: true, env: [], cwd: "/" });
  });
  test("a helper that prints a matching attestation passes end to end through the real runner", () => {
    const s = station(), fd = channelFixture(s, "challenge");
    const helper = helperFixture(s, `import { readFileSync } from "node:fs"; readFileSync(3);
const pid = Number(process.argv[process.argv.indexOf("--expected-process-id") + 1]), digest = process.argv[process.argv.indexOf("--input-sha256") + 1];
console.log(JSON.stringify({ schema: "native-hook-policy-peer-v1", peerProcessId: pid, stdinSha256: digest, policy: ${JSON.stringify(policy(s))} }));`);
    expect(bind(s, fd, runCodexNativePolicyHelper, { executablePath: helper, timeoutMs: 10_000 })).toBe(`ACCEPTED ${JSON.stringify({ schema: CODEX_NATIVE_POLICY_PEER_SCHEMA, peerProcessId: CONSUMER_PID })}`);
  });
  test("a hanging helper is killed at the timeout and an oversized one at the output bound", () => {
    const s = station();
    const hanging = helperFixture(s, `await new Promise(resolve => setTimeout(resolve, 60_000));`);
    const timedOut = runCodexNativePolicyHelper({ executablePath: hanging, fd: channelFixture(s), expectedProcessId: CONSUMER_PID, inputSha256: RAW_SHA, timeoutMs: 1_500, maxOutputBytes: 65536 });
    expect(timedOut.timedOut).toBe(true);
    expect(bind(s, channelFixture(s), runCodexNativePolicyHelper, { executablePath: hanging, timeoutMs: 1_500 })).toMatch(/^NATIVE_SKILL_POLICY_UNAUTHENTICATED: the native policy helper timed out/);
    const noisy = helperFixture(s, `process.stdout.write("x".repeat(300_000)); await new Promise(resolve => setTimeout(resolve, 60_000));`);
    const oversized = runCodexNativePolicyHelper({ executablePath: noisy, fd: channelFixture(s), expectedProcessId: CONSUMER_PID, inputSha256: RAW_SHA, timeoutMs: 10_000, maxOutputBytes: 4096 });
    expect(oversized.oversized || oversized.timedOut).toBe(true);
    expect(bind(s, channelFixture(s), runCodexNativePolicyHelper, { executablePath: noisy, timeoutMs: 10_000, maxOutputBytes: 4096 })).toMatch(/^NATIVE_SKILL_POLICY_UNAUTHENTICATED: the native policy helper (output exceeded its bound|timed out)/);
  });
});

describe("artifact-identity cache for the qualified executable", () => {
  const counting = () => { const calls: string[] = []; return { calls, hasher: (path: string) => { calls.push(path); return sha(readFileSync(path)); } }; };
  test("an unchanged witness hits the in-process and file caches; the file holds only identity to digest mappings", () => {
    const s = station(), { calls, hasher } = counting();
    const first = qualifiedExecutableSha256(s.executable, { dataDir: s.dataDir, hasher });
    expect(first).toMatchObject({ sha256: s.executableSha256, cached: false });
    expect(qualifiedExecutableSha256(s.executable, { dataDir: s.dataDir, hasher })).toMatchObject({ sha256: s.executableSha256, cached: true });
    expect(calls).toHaveLength(1);
    const file = executableCachePath(s.dataDir);
    expect(lstatSync(file).mode & 0o777).toBe(0o600);
    const value = JSON.parse(readFileSync(file, "utf8"));
    expect(value.schema).toBe(CODEX_NATIVE_POLICY_EXECUTABLE_CACHE_SCHEMA);
    expect(value.entries).toEqual([{ path: s.executable, ...first.witness, sha256: s.executableSha256 }]);
    expect(Object.keys(value.entries[0]).sort()).toEqual(["ctimeNs", "dev", "ino", "mtimeNs", "path", "sha256", "size", "uid"]);
    // A second verification through the guard path re-uses the file entry rather than re-hashing.
    const trust = readManagedSkillPolicySnapshot(s.dataDir)!.value.bridge.codexNativePolicy;
    expect(verifyCodexNativeExecutable(fakeInspector(s), CONSUMER_PID, parseCodexNativePolicyTrust(trust), { dataDir: s.dataDir, hasher }).executableSha256).toBe(s.executableSha256);
    expect(calls).toHaveLength(1);
  });
  test("each changed witness field misses and re-hashes", () => {
    const s = station(), { calls, hasher } = counting(), options = { dataDir: s.dataDir, hasher };
    qualifiedExecutableSha256(s.executable, options); expect(calls).toHaveLength(1);
    // mtime
    utimesSync(s.executable, new Date(1_600_000_000_000), new Date(1_600_000_000_000));
    expect(qualifiedExecutableSha256(s.executable, options).cached).toBe(false); expect(calls).toHaveLength(2);
    expect(qualifiedExecutableSha256(s.executable, options).cached).toBe(true); expect(calls).toHaveLength(2);
    // ctime (a mode change leaves size and mtime alone)
    chmodSync(s.executable, 0o500);
    expect(qualifiedExecutableSha256(s.executable, options).cached).toBe(false); expect(calls).toHaveLength(3);
    chmodSync(s.executable, 0o700);
    expect(qualifiedExecutableSha256(s.executable, options).cached).toBe(false); expect(calls).toHaveLength(4);
    // size and content
    writeFileSync(s.executable, randomBytes(8192), { mode: 0o700 });
    const rehashed = qualifiedExecutableSha256(s.executable, options); expect(rehashed.cached).toBe(false); expect(calls).toHaveLength(5);
    expect(rehashed.sha256).toBe(sha(readFileSync(s.executable)));
    // inode: a replacement file at the same path with the same bytes
    const replacement = join(s.home, "replacement"); writeFileSync(replacement, readFileSync(s.executable), { mode: 0o700 }); renameSync(replacement, s.executable);
    expect(qualifiedExecutableSha256(s.executable, options).cached).toBe(false); expect(calls).toHaveLength(6);
    // A cache row for another path never serves this one.
    const other = join(s.home, "other-binary"); writeFileSync(other, readFileSync(s.executable), { mode: 0o700 });
    expect(qualifiedExecutableSha256(other, options).cached).toBe(false); expect(calls).toHaveLength(7);
  });
  test("a witness that changes during hashing refuses", () => {
    const s = station();
    expect(() => qualifiedExecutableSha256(s.executable, { dataDir: s.dataDir, hasher: path => { writeFileSync(path, randomBytes(100), { mode: 0o700 }); return sha("x"); } })).toThrow(/the consumer executable changed while hashing/);
  });
  test("a symlinked path, a linked component, a group-writable file and a wrong owner each refuse", () => {
    const s = station();
    const link = join(s.home, "linked-binary"); symlinkSync(s.executable, link);
    expect(() => executableWitness(link)).toThrow(/the consumer executable is not a regular file/);
    const linkedDir = join(s.home, "linked-dir"); symlinkSync(s.home, linkedDir);
    expect(() => executableWitness(join(linkedDir, "codex-fixture-binary"))).toThrow(/missing, linked or unexpected component/);
    expect(() => executableWitness(join(s.home, "missing-binary"))).toThrow(/the consumer executable is missing/);
    chmodSync(s.executable, 0o720);
    expect(() => executableWitness(s.executable)).toThrow(/group- or world-writable/);
    chmodSync(s.executable, 0o702);
    expect(() => executableWitness(s.executable)).toThrow(/group- or world-writable/);
    chmodSync(s.executable, 0o700);
    const stat = lstatSync(s.executable, { bigint: true });
    expect(() => assertExecutableWitnessStat(stat, Number(stat.uid) + 1)).toThrow(/owned by another user/);
    expect(assertExecutableWitnessStat({ ...stat, uid: 0n, isFile: () => true, isSymbolicLink: () => false }, Number(stat.uid) + 1).uid).toBe("0");
    expect(() => verifyCodexNativeExecutable(fakeInspector(s, { executablePath: () => link }), CONSUMER_PID, parseCodexNativePolicyTrust(readManagedSkillPolicySnapshot(s.dataDir)!.value.bridge.codexNativePolicy))).toThrow(/NATIVE_SKILL_POLICY_PROCESS_UNBOUND: the consumer executable is not a regular file/);
  });
  test("an unreadable or malformed cache file is a miss, never a refusal", () => {
    const s = station(), { calls, hasher } = counting();
    mkdirSync(join(s.dataDir, "agent-hooks"), { recursive: true });
    writeFileSync(executableCachePath(s.dataDir), "{not json");
    expect(qualifiedExecutableSha256(s.executable, { dataDir: s.dataDir, hasher }).cached).toBe(false);
    writeFileSync(executableCachePath(s.dataDir), JSON.stringify({ schema: CODEX_NATIVE_POLICY_EXECUTABLE_CACHE_SCHEMA, entries: [{ path: s.executable, sha256: "0".repeat(64), dev: "1", ino: "1", size: "1", mtimeNs: "1", ctimeNs: "1", uid: "1", extra: true }] }));
    expect(calls).toHaveLength(1);
  });
});
