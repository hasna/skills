/**
 * Operator trust for the Codex native skill policy adapter.
 *
 * `skills hook trust-native` binds the reviewed digests of the native Codex
 * executable for one platform in the managed policy
 * (`bridge.codexNativePolicy.executableDigests`). Digests come only from the
 * command's arguments, never from a fetch. Preview is the default; `--apply`
 * writes through the ordinary managed-policy parser, the existing plan apply
 * path (exact-bytes compare-and-swap, 0600 atomic replace, pre-change backup
 * with readback, compensation on failure) and a post-write readback that must
 * show exactly the intended digest set. Every other field of the policy is
 * preserved: values identical, the file re-serialized with the package
 * formatter.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDataDirReadOnly } from "./config.js";
import { readManagedSkillPolicySnapshot, serializeManagedSkillPolicy } from "./managed-policy.js";
import { assertAgentPolicyCollections } from "./agent-policy-limits.js";
import { parseCodexNativePolicyTrust, assertOperatorTrustRoot } from "./codex-native-skill-policy.js";
import { applyAgentIntegration, type AgentIntegrationPlan } from "./agent-integration.js";

export const CODEX_NATIVE_TRUST_PLAN_SCHEMA = "skills.codex-native-trust-plan/v1";
export const CODEX_NATIVE_TRUST_RECEIPT_SCHEMA = "skills.codex-native-trust-receipt/v1";
const PLATFORM_KEY = /^(darwin|linux)-(arm64|x64)$/;
const HEX_DIGEST = /^[0-9a-f]{64}$/;
const MAX_DIGESTS = 16;
const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
function refuse(detail: string): never { throw new Error(`NATIVE_SKILL_POLICY_TRUST_REFUSED: ${detail}`); }

export interface CodexNativeTrustPlan {
  schema: typeof CODEX_NATIVE_TRUST_PLAN_SCHEMA;
  dataDir: string; policyPath: string; platform: string;
  digestsBefore: string[]; digestsAfter: string[];
  policySha256Before: string; policySha256After: string;
  /** The ordinary plan the existing apply path writes: at most one change, the managed policy. */
  plan: AgentIntegrationPlan;
}
export interface CodexNativeTrustReceipt {
  schema: typeof CODEX_NATIVE_TRUST_RECEIPT_SCHEMA;
  applied: boolean; platform: string;
  digestsBefore: string[]; digestsAfter: string[];
  policySha256Before: string; policySha256After: string;
  changes: string[];
  backup?: { path: string; sha256: string; verified: true };
  readback?: { policySha256: string; digests: string[]; verified: true };
}

/** Validate the request, the current policy and its SHA, and build the plan. Read-only. */
export function planCodexNativeTrust(options: { dataDir?: string; platform: string; digests: readonly string[]; expectedPolicySha256: string }): CodexNativeTrustPlan {
  const { platform, digests, expectedPolicySha256 } = options;
  if (typeof platform !== "string" || !PLATFORM_KEY.test(platform)) refuse("the platform must be darwin-arm64, darwin-x64, linux-arm64 or linux-x64");
  if (!Array.isArray(digests) || digests.length === 0) refuse("at least one reviewed executable digest is required; the trust is never cleared implicitly");
  if (digests.length > MAX_DIGESTS) refuse(`at most ${MAX_DIGESTS} digests per platform`);
  for (const digest of digests) if (typeof digest !== "string" || !HEX_DIGEST.test(digest)) refuse("every digest must be lowercase SHA-256 hex");
  if (new Set(digests).size !== digests.length) refuse("digests must be unique");
  if (typeof expectedPolicySha256 !== "string" || !HEX_DIGEST.test(expectedPolicySha256)) refuse("--expected-policy-sha256 must be lowercase SHA-256 hex");
  const dataDir = resolve(options.dataDir ?? getDataDirReadOnly()), policyPath = join(dataDir, "agent-policy.json");
  assertOperatorTrustRoot(dataDir);
  const snapshot = readManagedSkillPolicySnapshot(dataDir);
  if (!snapshot) refuse("no managed policy; run skills hook install first");
  const policySha256Before = sha(snapshot.text);
  if (policySha256Before !== expectedPolicySha256) refuse("the managed policy bytes differ from --expected-policy-sha256; read the current file and pass its SHA-256");
  const policy = snapshot.value;
  if (!policy.bridge || typeof policy.bridge !== "object" || Array.isArray(policy.bridge)) refuse("the managed policy has no bridge binding; run skills hook install first");
  const current = parseCodexNativePolicyTrust(policy.bridge.codexNativePolicy);
  // Exactly the given set for this platform; every other platform preserved.
  const trust = parseCodexNativePolicyTrust({ executableDigests: { ...current.executableDigests, [platform]: [...digests] } });
  const executableDigests = Object.fromEntries(Object.entries(trust.executableDigests).map(([key, value]) => [key, [...value]]));
  const next = { ...policy, bridge: { ...policy.bridge, codexNativePolicy: { executableDigests } } };
  assertAgentPolicyCollections(next);
  const after = serializeManagedSkillPolicy(next);
  const plan: AgentIntegrationPlan = { dataDir, profileId: typeof policy.profileId === "string" ? policy.profileId : "default", changes: after === snapshot.text ? [] : [{ path: policyPath, before: snapshot.text, after }], nativeSkills: [], observedPolicy: { path: policyPath, before: snapshot.text } };
  return { schema: CODEX_NATIVE_TRUST_PLAN_SCHEMA, dataDir, policyPath, platform, digestsBefore: [...(current.executableDigests[platform] ?? [])], digestsAfter: [...digests], policySha256Before, policySha256After: sha(after), plan };
}

export function previewCodexNativeTrust(plan: CodexNativeTrustPlan): CodexNativeTrustReceipt {
  return { schema: CODEX_NATIVE_TRUST_RECEIPT_SCHEMA, applied: false, platform: plan.platform, digestsBefore: plan.digestsBefore, digestsAfter: plan.digestsAfter, policySha256Before: plan.policySha256Before, policySha256After: plan.policySha256After, changes: plan.plan.changes.map(change => change.path) };
}

/** Write the planned trust. The current bytes are re-checked against the
 * expected SHA immediately before the existing apply path replaces them; that
 * path compares the exact bytes again, backs the original up, replaces the
 * file atomically at 0600 and restores the original on failure. The backup
 * and the result are read back and verified before a receipt is returned. */
export function applyCodexNativeTrust(plan: CodexNativeTrustPlan, expectedPolicySha256: string): CodexNativeTrustReceipt {
  if (plan.schema !== CODEX_NATIVE_TRUST_PLAN_SCHEMA || !plan.plan.observedPolicy || plan.plan.changes.length > 1 || plan.plan.changes.some(change => change.path !== plan.policyPath)) refuse("invalid trust plan");
  if (plan.policySha256Before !== expectedPolicySha256) refuse("the plan was made for different managed policy bytes");
  assertOperatorTrustRoot(plan.dataDir);
  const current = readManagedSkillPolicySnapshot(plan.dataDir);
  if (!current || current.text !== plan.plan.observedPolicy.before || sha(current.text) !== expectedPolicySha256) refuse("the managed policy changed since planning; nothing was written");
  const result = applyAgentIntegration(plan.plan);
  const receipt: CodexNativeTrustReceipt = { ...previewCodexNativeTrust(plan), applied: true, changes: result.changed };
  if (plan.plan.changes.length) {
    const backupPath = result.backups[0];
    if (result.backups.length !== 1 || typeof backupPath !== "string") throw new Error("NATIVE_SKILL_POLICY_TRUST_WRITE_UNVERIFIED: the pre-change backup was not recorded");
    const backupSha256 = sha(readFileSync(backupPath));
    if (backupSha256 !== plan.policySha256Before) throw new Error(`NATIVE_SKILL_POLICY_TRUST_WRITE_UNVERIFIED: the backup at ${backupPath} does not read back as the pre-change policy`);
    receipt.backup = { path: backupPath, sha256: backupSha256, verified: true };
  }
  const readback = readManagedSkillPolicySnapshot(plan.dataDir);
  if (!readback || sha(readback.text) !== plan.policySha256After) throw new Error(`NATIVE_SKILL_POLICY_TRUST_WRITE_UNVERIFIED: the written policy does not read back as planned${receipt.backup ? `; the original is preserved at ${receipt.backup.path}` : ""}`);
  const digests = [...(parseCodexNativePolicyTrust(readback.value.bridge?.codexNativePolicy).executableDigests[plan.platform] ?? [])];
  if (JSON.stringify(digests) !== JSON.stringify(plan.digestsAfter)) throw new Error(`NATIVE_SKILL_POLICY_TRUST_WRITE_UNVERIFIED: the written digests differ from the plan${receipt.backup ? `; the original is preserved at ${receipt.backup.path}` : ""}`);
  receipt.readback = { policySha256: sha(readback.text), digests, verified: true };
  return receipt;
}
