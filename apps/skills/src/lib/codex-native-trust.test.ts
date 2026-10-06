import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { chmodSync, constants, lstatSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { DATA_DIR_ENV } from "./config.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { useDefaultTestTimeout } from "../test-preload.js";
import { planAgentIntegration, applyAgentIntegration, assertManagedAgentBridge } from "./agent-integration.js";
import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { readManagedSkillPolicySnapshot } from "./managed-policy.js";
import { CLI_BRIDGE_DIGEST, CLI_BRIDGE_FILES } from "./agent-bridge.js";
import { verifyCodexNativeSkillPolicy, CODEX_NATIVE_POLICY_PEER_SCHEMA, type ProcessInspector, type NativePolicyHelperRunner } from "./codex-native-skill-policy.js";
import { planCodexNativeTrust, applyCodexNativeTrust, previewCodexNativeTrust, CODEX_NATIVE_TRUST_RECEIPT_SCHEMA } from "./codex-native-trust.js";
useDefaultTestTimeout();
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); });
const roots: string[] = []; afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const D1 = sha("artifact-one"), D2 = sha("artifact-two"), D3 = sha("artifact-three");

function station() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "skills-native-trust-"))); roots.push(home); admitCorpusFixture(join(home, ".codex"));
  const f = { home, dataDir: join(home, "data"), projectDir: home };
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["codex"] }));
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
  const policyPath = join(f.dataDir, "agent-policy.json");
  const text = () => readFileSync(policyPath, "utf8");
  return { ...f, policyPath, text, sha: () => sha(text()), bridgeDocument: realpathSync(join(home, ".codex", "skills", "skills-cli", "SKILL.md")) };
}
type Station = ReturnType<typeof station>;
const attempt = (fn: () => unknown): string => { try { fn(); return "OK"; } catch (error) { return (error as Error).message; } };
/** Every entry below a directory with its type, mode, size and content hash, so
 * "wrote nothing" means "unchanged since before the step", not "absent": the
 * fixture's own bridge installation already leaves migration backups behind. */
function snapshotTree(root: string): string {
  const rows: string[] = [];
  const visit = (path: string) => {
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name), stat = lstatSync(child);
      if (stat.isDirectory()) { rows.push(`d ${child.slice(root.length)} ${(stat.mode & 0o7777).toString(8)}`); visit(child); }
      else if (stat.isSymbolicLink()) rows.push(`l ${child.slice(root.length)}`);
      else rows.push(`f ${child.slice(root.length)} ${(stat.mode & 0o7777).toString(8)} ${stat.size} ${sha(readFileSync(child))}`);
    }
  };
  visit(root);
  return rows.join("\n");
}
/** Every policy key except the trust, serialized, so unrelated fields can be compared byte for byte. */
function otherKeys(text: string): string {
  const value = JSON.parse(text), { codexNativePolicy, ...bridge } = value.bridge;
  return JSON.stringify({ ...value, bridge }, null, 2);
}

describe("skills hook trust-native: plan and preview", () => {
  test("preview writes nothing and reports the before and after sets", () => {
    const s = station(), before = s.text(), tree = snapshotTree(s.dataDir), plan = planCodexNativeTrust({ dataDir: s.dataDir, platform: "darwin-arm64", digests: [D1, D2], expectedPolicySha256: s.sha() });
    const receipt = previewCodexNativeTrust(plan);
    expect(receipt).toEqual({ schema: CODEX_NATIVE_TRUST_RECEIPT_SCHEMA, applied: false, platform: "darwin-arm64", digestsBefore: [], digestsAfter: [D1, D2], policySha256Before: sha(before), policySha256After: plan.policySha256After, changes: [s.policyPath] });
    expect(s.text()).toBe(before);
    expect(snapshotTree(s.dataDir)).toBe(tree);
    expect(plan.plan.changes[0]!.before).toBe(before);
    expect(JSON.parse(plan.plan.changes[0]!.after).bridge.codexNativePolicy).toEqual({ executableDigests: { "darwin-arm64": [D1, D2] } });
  });
  const refusals: Array<[string, (s: Station) => Parameters<typeof planCodexNativeTrust>[0], RegExp]> = [
    ["invalid platform key", s => ({ dataDir: s.dataDir, platform: "windows-x64", digests: [D1], expectedPolicySha256: s.sha() }), /the platform must be darwin-arm64, darwin-x64, linux-arm64 or linux-x64/],
    ["non-hex digest", s => ({ dataDir: s.dataDir, platform: "darwin-arm64", digests: [D1.toUpperCase()], expectedPolicySha256: s.sha() }), /every digest must be lowercase SHA-256 hex/],
    ["short digest", s => ({ dataDir: s.dataDir, platform: "darwin-arm64", digests: [D1.slice(1)], expectedPolicySha256: s.sha() }), /every digest must be lowercase SHA-256 hex/],
    ["duplicate digest", s => ({ dataDir: s.dataDir, platform: "darwin-arm64", digests: [D1, D1], expectedPolicySha256: s.sha() }), /digests must be unique/],
    ["empty list", s => ({ dataDir: s.dataDir, platform: "darwin-arm64", digests: [], expectedPolicySha256: s.sha() }), /at least one reviewed executable digest is required/],
    ["more than 16 digests", s => ({ dataDir: s.dataDir, platform: "darwin-arm64", digests: Array.from({ length: 17 }, (_, index) => sha(`d${index}`)), expectedPolicySha256: s.sha() }), /at most 16 digests per platform/],
    ["wrong expected SHA", s => ({ dataDir: s.dataDir, platform: "darwin-arm64", digests: [D1], expectedPolicySha256: sha("other") }), /the managed policy bytes differ from --expected-policy-sha256/],
    ["malformed expected SHA", s => ({ dataDir: s.dataDir, platform: "darwin-arm64", digests: [D1], expectedPolicySha256: "abc" }), /--expected-policy-sha256 must be lowercase SHA-256 hex/],
  ];
  for (const [name, build, expected] of refusals) test(`${name} refuses with no write`, () => {
    const s = station(), before = s.text(), tree = snapshotTree(s.dataDir);
    expect(attempt(() => planCodexNativeTrust(build(s)))).toMatch(new RegExp(`^NATIVE_SKILL_POLICY_TRUST_REFUSED: ${expected.source}`));
    expect(s.text()).toBe(before);
    expect(snapshotTree(s.dataDir)).toBe(tree);
  });
  test("a group-writable or symlinked policy refuses before any plan", () => {
    const s = station(), before = s.text();
    chmodSync(s.policyPath, 0o664);
    expect(lstatSync(s.policyPath).mode & 0o022).toBe(0o020);
    expect(attempt(() => planCodexNativeTrust({ dataDir: s.dataDir, platform: "darwin-arm64", digests: [D1], expectedPolicySha256: sha(before) }))).toMatch(/^NATIVE_SKILL_POLICY_TRUST_INVALID: the managed policy is group- or world-writable/);
    chmodSync(s.policyPath, 0o600);
    renameSync(s.policyPath, `${s.policyPath}.real`); symlinkSync(`${s.policyPath}.real`, s.policyPath);
    expect(attempt(() => planCodexNativeTrust({ dataDir: s.dataDir, platform: "darwin-arm64", digests: [D1], expectedPolicySha256: sha(before) }))).toMatch(/^NATIVE_SKILL_POLICY_TRUST_INVALID: the managed policy is not a regular file/);
    rmSync(s.policyPath); renameSync(`${s.policyPath}.real`, s.policyPath);
    expect(s.text()).toBe(before);
  });
  test("a missing managed policy refuses", () => {
    const s = station();
    expect(attempt(() => planCodexNativeTrust({ dataDir: join(s.home, "no-data"), platform: "darwin-arm64", digests: [D1], expectedPolicySha256: sha("") }))).toMatch(/^NATIVE_SKILL_POLICY_TRUST_INVALID: the Skills data directory is missing/);
  });
});

describe("skills hook trust-native: apply", () => {
  test("apply with the correct SHA writes exactly the set, preserves every other field, and the backup and result read back", () => {
    const s = station(), before = s.text(), expected = sha(before);
    const plan = planCodexNativeTrust({ dataDir: s.dataDir, platform: "darwin-arm64", digests: [D1, D2], expectedPolicySha256: expected });
    const receipt = applyCodexNativeTrust(plan, expected);
    expect(receipt).toMatchObject({ schema: CODEX_NATIVE_TRUST_RECEIPT_SCHEMA, applied: true, platform: "darwin-arm64", digestsBefore: [], digestsAfter: [D1, D2], policySha256Before: expected, policySha256After: plan.policySha256After, changes: [s.policyPath], backup: { sha256: expected, verified: true }, readback: { policySha256: plan.policySha256After, digests: [D1, D2], verified: true } });
    expect(receipt.backup!.path.startsWith(join(s.dataDir, "migration") + "/")).toBe(true);
    expect(sha(readFileSync(receipt.backup!.path))).toBe(expected);
    expect(readFileSync(receipt.backup!.path, "utf8")).toBe(before);
    const after = s.text();
    expect(sha(after)).toBe(plan.policySha256After);
    expect(lstatSync(s.policyPath).mode & 0o777).toBe(0o600);
    // Parsed: only the trust changed. Raw: every other key is byte for byte as it was.
    const parsedBefore = JSON.parse(before), parsedAfter = JSON.parse(after);
    expect(parsedAfter.bridge.codexNativePolicy).toEqual({ executableDigests: { "darwin-arm64": [D1, D2] } });
    delete parsedAfter.bridge.codexNativePolicy;
    expect(parsedAfter).toEqual(parsedBefore);
    expect(otherKeys(after)).toBe(otherKeys(before));
    expect(readManagedSkillPolicySnapshot(s.dataDir)!.value.bridge.codexNativePolicy).toEqual({ executableDigests: { "darwin-arm64": [D1, D2] } });
    // The guard still accepts the station after the write.
    expect(() => assertManagedAgentBridge("codex", { home: s.home, dataDir: s.dataDir, projectDir: s.projectDir })).not.toThrow();
    // A second platform leaves the first exactly as written; replacing a platform sets exactly the new set.
    const second = applyCodexNativeTrust(planCodexNativeTrust({ dataDir: s.dataDir, platform: "linux-x64", digests: [D3], expectedPolicySha256: s.sha() }), s.sha());
    expect(second.readback!.digests).toEqual([D3]);
    expect(readManagedSkillPolicySnapshot(s.dataDir)!.value.bridge.codexNativePolicy).toEqual({ executableDigests: { "darwin-arm64": [D1, D2], "linux-x64": [D3] } });
    const replaced = applyCodexNativeTrust(planCodexNativeTrust({ dataDir: s.dataDir, platform: "darwin-arm64", digests: [D3], expectedPolicySha256: s.sha() }), s.sha());
    expect(replaced.digestsBefore).toEqual([D1, D2]);
    expect(readManagedSkillPolicySnapshot(s.dataDir)!.value.bridge.codexNativePolicy).toEqual({ executableDigests: { "darwin-arm64": [D3], "linux-x64": [D3] } });
    // Idempotent: the same set again plans no change and writes no backup.
    const same = applyCodexNativeTrust(planCodexNativeTrust({ dataDir: s.dataDir, platform: "darwin-arm64", digests: [D3], expectedPolicySha256: s.sha() }), s.sha());
    expect(same.changes).toEqual([]); expect(same.backup).toBeUndefined(); expect(same.readback!.digests).toEqual([D3]);
  });
  test("a policy changed between plan and apply refuses with no write", () => {
    const s = station(), original = s.text(), expected = sha(original);
    const plan = planCodexNativeTrust({ dataDir: s.dataDir, platform: "darwin-arm64", digests: [D1], expectedPolicySha256: expected });
    const changed = `${original.trimEnd().slice(0, -1)},\n  "note": "changed"\n}\n`; writeFileSync(s.policyPath, changed);
    const tree = snapshotTree(s.dataDir);
    expect(attempt(() => applyCodexNativeTrust(plan, expected))).toMatch(/^NATIVE_SKILL_POLICY_TRUST_REFUSED: the managed policy changed since planning; nothing was written/);
    expect(s.text()).toBe(changed);
    expect(snapshotTree(s.dataDir)).toBe(tree);
    // A plan made for other bytes refuses as well, and a wrong SHA at apply time refuses.
    expect(attempt(() => applyCodexNativeTrust(plan, sha(changed)))).toMatch(/^NATIVE_SKILL_POLICY_TRUST_REFUSED: the plan was made for different managed policy bytes/);
    expect(snapshotTree(s.dataDir)).toBe(tree);
    writeFileSync(s.policyPath, original);
    const restored = snapshotTree(s.dataDir);
    expect(attempt(() => applyCodexNativeTrust(plan, sha("other")))).toMatch(/^NATIVE_SKILL_POLICY_TRUST_REFUSED: the plan was made for different managed policy bytes/);
    expect(s.text()).toBe(original);
    expect(snapshotTree(s.dataDir)).toBe(restored);
  });
  test("a policy that turned group-writable or linked before apply refuses with no write", () => {
    const s = station(), expected = s.sha(), before = s.text(), tree = snapshotTree(s.dataDir);
    const plan = planCodexNativeTrust({ dataDir: s.dataDir, platform: "darwin-arm64", digests: [D1], expectedPolicySha256: expected });
    chmodSync(s.policyPath, 0o666);
    const loose = snapshotTree(s.dataDir);
    expect(attempt(() => applyCodexNativeTrust(plan, expected))).toMatch(/^NATIVE_SKILL_POLICY_TRUST_INVALID: the managed policy is group- or world-writable/);
    expect(snapshotTree(s.dataDir)).toBe(loose);
    chmodSync(s.policyPath, 0o600);
    renameSync(s.policyPath, `${s.policyPath}.real`); symlinkSync(`${s.policyPath}.real`, s.policyPath);
    const linked = snapshotTree(s.dataDir);
    expect(attempt(() => applyCodexNativeTrust(plan, expected))).toMatch(/^NATIVE_SKILL_POLICY_TRUST_INVALID: the managed policy is not a regular file/);
    expect(snapshotTree(s.dataDir)).toBe(linked);
    rmSync(s.policyPath); renameSync(`${s.policyPath}.real`, s.policyPath);
    expect(s.text()).toBe(before);
    expect(snapshotTree(s.dataDir)).toBe(tree);
  });
});

describe("skills hook trust-native: end to end with the adapter", () => {
  const PARENTS: Record<number, number> = { 5000: 4000, 4000: 1 };
  function inspector(executable: string): ProcessInspector {
    return { platform: "darwin", arch: "arm64", pid: 5000, parentOf: pid => PARENTS[pid] ?? null, startTime: () => "1700000000.123456", executablePath: () => executable };
  }
  function channel(s: Station): number {
    const path = join(s.home, `chan-${randomBytes(4).toString("hex")}`);
    if (Bun.spawnSync(["/usr/bin/mkfifo", path]).exitCode !== 0) throw new Error("mkfifo failed");
    return openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  }
  test("after trust-native --apply the adapter accepts the pinned ancestor digest and still refuses another", () => {
    const s = station();
    const pinned = join(s.home, "pinned-binary"); writeFileSync(pinned, randomBytes(4096), { mode: 0o700 });
    const other = join(s.home, "other-binary"); writeFileSync(other, randomBytes(4096), { mode: 0o700 });
    const policy = { capability: "host-path-allowlist-v1", mode: "restricted", allowedHostPaths: [s.bridgeDocument], nonHostSources: "disabled", processId: 4000, effectiveConfigDigest: sha("rules") };
    const raw = Buffer.from(JSON.stringify({ native_skill_policy: policy, session_id: "s", turn_id: "t" }), "utf8"), rawSha = sha(raw);
    const runner: NativePolicyHelperRunner = () => ({ exitCode: 0, stdout: Buffer.from(`${JSON.stringify({ schema: CODEX_NATIVE_POLICY_PEER_SCHEMA, peerProcessId: 4000, stdinSha256: rawSha, policy })}\n`, "utf8"), timedOut: false, oversized: false });
    const verify = (executable: string) => attempt(() => verifyCodexNativeSkillPolicy({ envelope: { event: "UserPromptSubmit", policy, sessionId: "s", turnId: "t", hookInputSha256: rawSha, inheritedFd: channel(s) }, bridgeDocument: s.bridgeDocument, expectedBridgeContent: CLI_BRIDGE_FILES["SKILL.md"]!, expectedBridgeSha256: CLI_BRIDGE_DIGEST, trust: readManagedSkillPolicySnapshot(s.dataDir)!.value.bridge.codexNativePolicy, inspector: inspector(executable), dataDir: s.dataDir, helperRunner: runner }));
    // Before any trust: unpinned.
    expect(verify(pinned)).toMatch(/^NATIVE_SKILL_POLICY_EXECUTABLE_UNPINNED: no reviewed Codex executable digest is configured for darwin-arm64/);
    applyCodexNativeTrust(planCodexNativeTrust({ dataDir: s.dataDir, platform: "darwin-arm64", digests: [sha(readFileSync(pinned))], expectedPolicySha256: s.sha() }), s.sha());
    expect(verify(pinned)).toBe("OK");
    expect(verify(other)).toMatch(/^NATIVE_SKILL_POLICY_EXECUTABLE_UNPINNED: the consumer executable digest is not a reviewed Codex artifact/);
    // The trust-native write left the station's bridge and migration backups intact.
    expect(readdirSync(join(s.dataDir, "migration")).length).toBeGreaterThanOrEqual(1);
    expect(() => assertManagedAgentBridge("codex", { home: s.home, dataDir: s.dataDir, projectDir: s.projectDir })).not.toThrow();
  });
});

describe("skills hook trust-native: command line", () => {
  test("without --apply the command writes nothing and its receipt says applied:false", async () => {
    const s = station(), before = s.text(), tree = snapshotTree(s.dataDir), homeTree = snapshotTree(join(s.home, ".codex"));
    const args = [process.execPath, "--no-env-file", "run", join(process.cwd(), "src/cli/index.tsx"), "hook", "trust-native", "--platform", "darwin-arm64", "--digest", D1, "--digest", D2, "--expected-policy-sha256", sha(before), "--json"];
    const child = Bun.spawn(args, { cwd: s.home, env: { ...process.env, HOME: s.home, USERPROFILE: s.home, [DATA_DIR_ENV]: s.dataDir, NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stderr).toBe(""); expect(exitCode).toBe(0);
    const receipt = JSON.parse(stdout);
    expect(receipt).toMatchObject({ schema: CODEX_NATIVE_TRUST_RECEIPT_SCHEMA, applied: false, platform: "darwin-arm64", digestsBefore: [], digestsAfter: [D1, D2], policySha256Before: sha(before), changes: [s.policyPath] });
    expect(receipt.backup).toBeUndefined(); expect(receipt.readback).toBeUndefined();
    expect(s.text()).toBe(before);
    expect(snapshotTree(s.dataDir)).toBe(tree);
    expect(snapshotTree(join(s.home, ".codex"))).toBe(homeTree);
    // A wrong expected SHA refuses through the command as well, still writing nothing.
    const refused = Bun.spawn([...args.slice(0, -3), sha("other"), "--json"], { cwd: s.home, env: { ...process.env, HOME: s.home, USERPROFILE: s.home, [DATA_DIR_ENV]: s.dataDir, NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe" });
    const [refusedOut, refusedErr, refusedCode] = await Promise.all([new Response(refused.stdout).text(), new Response(refused.stderr).text(), refused.exited]);
    expect(refusedCode).toBe(1); expect(refusedOut).toBe("");
    expect(refusedErr).toContain("NATIVE_SKILL_POLICY_TRUST_REFUSED: the managed policy bytes differ from --expected-policy-sha256");
    expect(snapshotTree(s.dataDir)).toBe(tree);
  });
});
