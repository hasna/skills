import { useDefaultTestTimeout } from "../test-preload.js";
import { afterEach, expect, test } from "bun:test";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { captureDiscoveryByteSources, verifyAgentDiscovery, type AgentDiscoveryBinding } from "./agent-discovery.js";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration, planReviewedArtifactMigration } from "./agent-integration.js";
import { planReviewArtifactRetention, verifyRetainedReviewArtifact, writeReviewArtifactExclusive } from "./retained-review-artifacts.js";
import { readSkillSessionSnapshot, sessionReceiptPath, writeSkillSession } from "./selection-cache.js";
useDefaultTestTimeout();

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function fixture() {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "skills-retained-review-")); homes.push(home);
  const dataDir = join(home, "data"), sourcePath = join(home, "scratch", "review.json");
  const text = JSON.stringify({ version: "codex-cli 0.160.0", cwd: home, skills: [], plugins: [] }, null, 2) + "\n";
  mkdirSync(dirname(sourcePath), { mode: 0o700 }); writeFileSync(sourcePath, text, { mode: 0o600 });
  const binding: AgentDiscoveryBinding = { agent: "codex", method: "reviewed", roots: [], sources: captureDiscoveryByteSources([sourcePath]) };
  const artifacts = [{ kind: "codex-native-catalog" as const, path: sourcePath, sha256: sha(text) }];
  return { home, dataDir, sourcePath, text, binding, artifacts };
}
function station() {
  const f = fixture(), configPath = join(f.home, ".codex", "config.toml");
  // Materialize only this sandbox's generated bridge fixture. No native
  // process, inspector, admission or live configuration is used by these tests.
  const bootstrap = planAgentIntegration({ ...f, agents: ["codex"] });
  for (const change of bootstrap.changes) {
    mkdirSync(dirname(change.path), { recursive: true, mode: 0o700 });
    writeFileSync(change.path, change.after, { mode: 0o600 });
  }
  const review = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [],
    sources: captureDiscoveryByteSources([configPath, f.sourcePath]), pluginHooks: "reviewed-no-skill-injection" as const }] };
  const install = planAgentIntegration({ ...f, agents: ["codex"], discoveryInputs: review });
  expect(install.changes.every(change => change.path.startsWith(f.dataDir + "/"))).toBe(true);
  applyAgentIntegration(install);
  const policyPath = join(f.dataDir, "agent-policy.json"), cacheDir = join(f.dataDir, "selection-cache");
  writeSkillSession({ schemaVersion: 1, sessionId: "synthetic-existing-session", verifiedAt: new Date(0).toISOString(),
    loaded: [], profile: { authority: "https://skills.example.com/api/v1", workspaceId: "org-test", profileId: "fleet", profileRevision: "original", selections: [] } }, { current: null }, { cacheDir });
  const pinPath = sessionReceiptPath("synthetic-existing-session", { cacheDir });
  expect(readSkillSessionSnapshot("synthetic-existing-session", { cacheDir }).generation).toBe(1);
  const policy = readFileSync(policyPath, "utf8"), config = readFileSync(configPath, "utf8"), pin = readFileSync(pinPath, "utf8");
  const migration = () => planReviewedArtifactMigration({ ...f, kind: "codex-native-catalog", expectedPolicySha256: sha(policy), expectedSourceSha256: sha(f.text) });
  return { ...f, configPath, policyPath, pinPath, policy, config, pin, migration, review };
}

test("explicit retention survives removal of the original scratch artifact with exact bytes and lineage", () => {
  const f = fixture(), plan = planReviewArtifactRetention(f.binding, f.artifacts, f.dataDir, f.home);
  expect(() => lstatSync(f.dataDir)).toThrow();
  writeReviewArtifactExclusive(plan.changes[0]!);
  expect(readFileSync(plan.binding.sources[0]!.path, "utf8")).toBe(f.text);
  expect(plan.binding.sources[0]!.reviewArtifact?.originalPath).toBe(f.sourcePath);
  rmSync(dirname(f.sourcePath), { recursive: true });
  expect(() => verifyAgentDiscovery(plan.binding)).not.toThrow();
});
test("legacy full-byte witnesses remain live unless explicitly typed for retention", () => {
  const f = fixture(), plan = planReviewArtifactRetention(f.binding, undefined, f.dataDir, f.home);
  expect(plan.binding).toBe(f.binding); expect(plan.changes).toEqual([]);
  rmSync(f.sourcePath);
  expect(() => verifyAgentDiscovery(plan.binding)).toThrow("Native discovery input changed");
});
test("retained file tampering and a foreign store root refuse", () => {
  const f = fixture(), plan = planReviewArtifactRetention(f.binding, f.artifacts, f.dataDir, f.home), source = plan.binding.sources[0]!;
  writeReviewArtifactExclusive(plan.changes[0]!);
  expect(() => verifyRetainedReviewArtifact(source, join(f.home, "foreign"))).toThrow("REVIEW_ARTIFACT_INVALID");
  writeFileSync(source.path, f.text + " ");
  expect(() => verifyAgentDiscovery(plan.binding)).toThrow("REVIEW_ARTIFACT_INVALID");
});
test("a writable Skills store and malformed retained lineage refuse", () => {
  const f = fixture(); mkdirSync(f.dataDir, { mode: 0o700 }); chmodSync(f.dataDir, 0o770);
  expect(() => planReviewArtifactRetention(f.binding, f.artifacts, f.dataDir, f.home)).toThrow("REVIEW_ARTIFACT_INVALID");
  chmodSync(f.dataDir, 0o700);
  const plan = planReviewArtifactRetention(f.binding, f.artifacts, f.dataDir, f.home); writeReviewArtifactExclusive(plan.changes[0]!);
  const source = plan.binding.sources[0]!;
  expect(() => verifyRetainedReviewArtifact({ ...source, reviewArtifact: { ...source.reviewArtifact!, extra: true } } as any)).toThrow("REVIEW_ARTIFACT_INVALID");
});
test("source or retained symlinks and writable artifact directories refuse", () => {
  const f = fixture(), original = join(f.home, "original.json");
  writeFileSync(original, f.text, { mode: 0o600 }); rmSync(f.sourcePath); symlinkSync(original, f.sourcePath);
  expect(() => planReviewArtifactRetention(f.binding, f.artifacts, f.dataDir, f.home)).toThrow("REVIEW_ARTIFACT_INVALID");
  rmSync(f.sourcePath); writeFileSync(f.sourcePath, f.text, { mode: 0o600 });
  const plan = planReviewArtifactRetention(f.binding, f.artifacts, f.dataDir, f.home), source = plan.binding.sources[0]!;
  writeReviewArtifactExclusive(plan.changes[0]!); chmodSync(dirname(source.path), 0o770);
  expect(() => verifyAgentDiscovery(plan.binding)).toThrow("REVIEW_ARTIFACT_INVALID");
  chmodSync(dirname(source.path), 0o700); rmSync(source.path); symlinkSync(original, source.path);
  expect(() => verifyAgentDiscovery(plan.binding)).toThrow("REVIEW_ARTIFACT_INVALID");
});
test("wrong digest, unknown type, duplicate declarations and native-root inputs refuse", () => {
  const f = fixture();
  for (const artifacts of [[{ ...f.artifacts[0]!, sha256: "0".repeat(64) }], [{ ...f.artifacts[0]!, kind: "config" }], [...f.artifacts, ...f.artifacts]])
    expect(() => planReviewArtifactRetention(f.binding, artifacts as any, f.dataDir, f.home)).toThrow("REVIEW_ARTIFACT_INVALID");
  mkdirSync(join(f.home, ".codex"), { mode: 0o700 });
  const native = join(f.home, ".codex", "input.json"); writeFileSync(native, f.text, { mode: 0o600 });
  expect(() => planReviewArtifactRetention({ ...f.binding, sources: captureDiscoveryByteSources([native]) },
    [{ ...f.artifacts[0]!, path: native }], f.dataDir, f.home)).toThrow("REVIEW_ARTIFACT_INVALID");
});
test("malformed native catalog and undeclared source cannot become retained evidence", () => {
  const f = fixture();
  expect(() => planReviewArtifactRetention({ ...f.binding, sources: [] }, f.artifacts, f.dataDir, f.home)).toThrow();
  const text = '{"version":"unknown","cwd":"/","skills":[]}\n'; writeFileSync(f.sourcePath, text);
  expect(() => planReviewArtifactRetention({ ...f.binding, sources: captureDiscoveryByteSources([f.sourcePath]) },
    [{ ...f.artifacts[0]!, sha256: sha(text) }], f.dataDir, f.home)).toThrow("REVIEW_ARTIFACT_INVALID");
});
test("an existing exact artifact is reused, while exclusive creation never overwrites", () => {
  const f = fixture(), first = planReviewArtifactRetention(f.binding, f.artifacts, f.dataDir, f.home);
  writeReviewArtifactExclusive(first.changes[0]!); const stat = lstatSync(first.changes[0]!.path);
  expect(planReviewArtifactRetention(f.binding, f.artifacts, f.dataDir, f.home).changes).toEqual([]);
  expect(() => writeReviewArtifactExclusive(first.changes[0]!)).toThrow();
  expect(lstatSync(first.changes[0]!.path).ino).toBe(stat.ino);
  expect(readFileSync(first.changes[0]!.path, "utf8")).toBe(f.text);
});
test("guarded legacy migration changes only the exact witness and retains policy backup and controls", () => {
  const f = station(), plan = f.migration();
  expect(readFileSync(f.policyPath, "utf8")).toBe(f.policy);
  expect(() => lstatSync(plan.retainedReviewArtifacts![0]!.path)).toThrow();
  const result = applyAgentIntegration(plan), after = JSON.parse(readFileSync(f.policyPath, "utf8")), before = JSON.parse(f.policy);
  const retained = after.bridge.discovery.codex.sources.find((source: any) => source.reviewArtifact);
  after.bridge.discovery.codex.sources = after.bridge.discovery.codex.sources.map((source: any) => source.reviewArtifact ? before.bridge.discovery.codex.sources.find((old: any) => old.path === f.sourcePath) : source);
  expect(after).toEqual(before);
  expect(result.backups.some(path => readFileSync(path, "utf8") === f.policy)).toBe(true);
  expect(readFileSync(f.sourcePath, "utf8")).toBe(f.text);
  expect(readFileSync(f.configPath, "utf8")).toBe(f.config); expect(readFileSync(f.pinPath, "utf8")).toBe(f.pin);
  rmSync(dirname(f.sourcePath), { recursive: true });
  expect(readFileSync(retained.path, "utf8")).toBe(f.text);
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
  writeFileSync(f.configPath, f.config + '\n[plugins."foreign@market"]\nenabled = true\n');
  expect(() => assertManagedAgentBridge("codex", f)).toThrow();
});
test("normal guarded hook installation retains an explicitly typed review artifact", () => {
  const f = station(), review = { ...f.review, agents: [{ ...f.review.agents[0]!, reviewArtifacts: f.artifacts }] };
  const plan = planAgentIntegration({ ...f, agents: ["codex"], discoveryInputs: review });
  expect(plan.changes.every(change => change.path.startsWith(f.dataDir + "/"))).toBe(true);
  applyAgentIntegration(plan); rmSync(f.sourcePath);
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
  expect(readFileSync(f.configPath, "utf8")).toBe(f.config); expect(readFileSync(f.pinPath, "utf8")).toBe(f.pin);
});
test("live plugin witnesses remain live after exact catalog migration", () => {
  const f = station(), pluginPath = join(f.home, "live-plugin.js");
  writeFileSync(pluginPath, 'export const synthetic = true;\n', { mode: 0o600 });
  const review = { ...f.review, agents: [{ ...f.review.agents[0]!, sources: captureDiscoveryByteSources([f.configPath, f.sourcePath, pluginPath]), reviewArtifacts: f.artifacts }] };
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["codex"], discoveryInputs: review }));
  rmSync(f.sourcePath); expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
  writeFileSync(pluginPath, 'export const synthetic = false;\n');
  expect(() => assertManagedAgentBridge("codex", f)).toThrow("Native discovery input changed");
});
test("a planned target collision cannot overwrite evidence or switch the policy", () => {
  const f = station(), plan = f.migration(), target = plan.retainedReviewArtifacts![0]!.path;
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 }); writeFileSync(target, f.text + " ", { mode: 0o600 });
  expect(() => applyAgentIntegration(plan)).toThrow("REVIEW_ARTIFACT_INVALID");
  expect(readFileSync(target, "utf8")).toBe(f.text + " ");
  expect(readFileSync(f.policyPath, "utf8")).toBe(f.policy); expect(readFileSync(f.configPath, "utf8")).toBe(f.config);
});
test("an altered migration plan refuses before changing policy or pins", () => {
  const f = station(), plan = f.migration();
  plan.changes[plan.changes.length - 1]!.after += "\n";
  expect(() => applyAgentIntegration(plan)).toThrow("REVIEW_ARTIFACT_PLAN_CHANGED");
  expect(readFileSync(f.policyPath, "utf8")).toBe(f.policy); expect(readFileSync(f.pinPath, "utf8")).toBe(f.pin);
});
test("post-write refusal compensates policy while retaining verified immutable evidence for exact retry", () => {
  const f = station(), review = { ...f.review, agents: [{ ...f.review.agents[0]!, reviewArtifacts: f.artifacts }] };
  const plan = planAgentIntegration({ ...f, agents: ["codex"], discoveryInputs: review }), target = plan.retainedReviewArtifacts![0]!.path;
  Object.defineProperty(plan, "discoveryAfter", { get() { throw new Error("synthetic-post-write-refusal"); } });
  expect(() => applyAgentIntegration(plan)).toThrow("synthetic-post-write-refusal");
  expect(readFileSync(f.policyPath, "utf8")).toBe(f.policy); expect(readFileSync(f.pinPath, "utf8")).toBe(f.pin);
  expect(readFileSync(target, "utf8")).toBe(f.text); expect(readFileSync(f.sourcePath, "utf8")).toBe(f.text);
  const retry = planAgentIntegration({ ...f, agents: ["codex"], discoveryInputs: review });
  expect(retry.retainedReviewArtifacts).toBeUndefined(); applyAgentIntegration(retry);
  rmSync(f.sourcePath); expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
});
test("original artifact and policy races refuse before switching or creating retained bytes", () => {
  const f = station(), plan = f.migration();
  writeFileSync(f.sourcePath, f.text + " ");
  expect(() => applyAgentIntegration(plan)).toThrow("REVIEW_ARTIFACT_INVALID");
  expect(readFileSync(f.policyPath, "utf8")).toBe(f.policy);
  expect(() => lstatSync(plan.retainedReviewArtifacts![0]!.path)).toThrow();
  writeFileSync(f.sourcePath, f.text); writeFileSync(f.policyPath, f.policy + "\n");
  expect(() => applyAgentIntegration(plan)).toThrow("REVIEW_ARTIFACT_POLICY_CHANGED");
  expect(readFileSync(f.policyPath, "utf8")).toBe(f.policy + "\n");
  expect(readFileSync(f.configPath, "utf8")).toBe(f.config); expect(readFileSync(f.pinPath, "utf8")).toBe(f.pin);
});
test("a missing legacy artifact, wrong policy digest or changed live config cannot be migrated", () => {
  const f = station();
  expect(() => planReviewedArtifactMigration({ ...f, kind: "codex-native-catalog", expectedPolicySha256: "0".repeat(64), expectedSourceSha256: sha(f.text) })).toThrow("REVIEW_ARTIFACT_POLICY_CHANGED");
  writeFileSync(f.configPath, f.config + '\n[plugins."foreign@market"]\nenabled = true\n');
  expect(() => f.migration()).toThrow(); writeFileSync(f.configPath, f.config); rmSync(f.sourcePath);
  expect(() => f.migration()).toThrow("Native discovery input changed");
  expect(readFileSync(f.policyPath, "utf8")).toBe(f.policy); expect(readFileSync(f.pinPath, "utf8")).toBe(f.pin);
});
