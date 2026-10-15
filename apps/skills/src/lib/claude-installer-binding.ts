/** Read-only verdict on the stored Claude discovery binding for installers.
 * It runs the same discovery verification the managed prompt hook runs and
 * reports every stored source and directory witness, so an installer need not
 * re-capture each witness file by file. It writes no file, cache or pin.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { captureDiscoveryDirectories, classifyClaudeDiscoverySources, verifyAgentDiscovery, verifyAutomaticDiscoveryClosure, type AgentDiscoveryBinding, type RetainedAbsentWitness } from "./agent-discovery.js";
import { canonicalAgentPath, recheckRootAliases, type AgentRootAlias } from "./agent-integration.js";
import { hashClaudeDiscoveryBinding } from "./claude-prospective-review.js";
import { getDataDirReadOnly } from "./config.js";
import { readManagedSkillPolicySnapshot } from "./managed-policy.js";

export const CLAUDE_DISCOVERY_BINDING_VERIFICATION_SCHEMA = "skills.claude-discovery-binding-verification/v1" as const;
/** The rule that lets a stored witness stay unverified because Claude removed
 * its whole retired plugin-cache version while unchanged settings and
 * registrations select a current sibling version. */
export const ABSENT_RETIRED_CLAUDE_VERSION_RULE = "absent-retired-claude-version" as const;

export type ClaudeDiscoveryBindingRefusalCode = "POLICY_PATH_MISMATCH" | "POLICY_UNAVAILABLE" | "POLICY_UNREADABLE" | "BINDING_UNAVAILABLE" | "BINDING_INVALID" | "POLICY_CHANGED";
/** A request, policy or stored-binding read/parse failure: no verdict. */
export class ClaudeDiscoveryBindingRefusal extends Error {
  readonly code: ClaudeDiscoveryBindingRefusalCode;
  constructor(code: ClaudeDiscoveryBindingRefusalCode) { super(code); this.code = code; }
}

export type ClaudeBindingSourceFailure = "MISSING" | "APPEARED" | "CHANGED" | "MARKER_INVALID" | "REFUSED";
export type ClaudeBindingDirectoryFailure = "MEMBERSHIP_CHANGED" | "REFUSED";
export interface ClaudeBindingSourceReport {
  index: number;
  path: string;
  hashMode: string | null;
  format: string | null;
  sha256: string | null;
  status: "current" | "retained-absent" | "drift";
  retention?: { rule: typeof ABSENT_RETIRED_CLAUDE_VERSION_RULE; root: string; witness: RetainedAbsentWitness };
  reason?: ClaudeBindingSourceFailure;
}
export interface ClaudeBindingDirectoryReport { index: number; path: string; status: "current" | "drift"; reason?: ClaudeBindingDirectoryFailure }
export type ClaudeBindingFailure =
  | { kind: "source"; index: number; path: string; reason: ClaudeBindingSourceFailure }
  | { kind: "directory"; index: number; path: string; reason: ClaudeBindingDirectoryFailure }
  | { kind: "binding"; reason: "DISCOVERY_REFUSED" };
export interface ClaudeDiscoveryBindingVerification {
  schema: typeof CLAUDE_DISCOVERY_BINDING_VERIFICATION_SCHEMA;
  ok: boolean;
  policySha256: string;
  discoverySha256: string;
  agent: "claude";
  method: "reviewed" | "automatic";
  rootCount: number;
  sources: ClaudeBindingSourceReport[];
  directories: ClaudeBindingDirectoryReport[];
  failures: ClaudeBindingFailure[];
}

const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const refuse = (code: ClaudeDiscoveryBindingRefusalCode): never => { throw new ClaudeDiscoveryBindingRefusal(code); };
function readPolicy(dataDir: string): { text: string; value: Record<string, any> } {
  let snapshot: ReturnType<typeof readManagedSkillPolicySnapshot>;
  try { snapshot = readManagedSkillPolicySnapshot(dataDir); } catch { return refuse("POLICY_UNREADABLE"); }
  return snapshot ?? refuse("POLICY_UNAVAILABLE");
}

/** Verify the stored `bridge.discovery.claude` binding of the package-owned
 * Skills policy. `ok` is true only when the hook's own discovery verification
 * accepts the binding and every source is current or retained under the
 * absent retired version rule, and every directory witness is current. */
export function verifyClaudeInstallerDiscoveryBinding(policyPath: string): ClaudeDiscoveryBindingVerification {
  const dataDir = getDataDirReadOnly();
  if (policyPath !== join(dataDir, "agent-policy.json")) refuse("POLICY_PATH_MISMATCH");
  const snapshot = readPolicy(dataDir);
  const bridge = snapshot.value.bridge;
  const binding: AgentDiscoveryBinding | undefined = object(bridge) && object(bridge.discovery) ? bridge.discovery.claude : undefined;
  if (!object(binding)) return refuse("BINDING_UNAVAILABLE");
  const aliases: AgentRootAlias[] = bridge.rootAliases ?? [];
  if (binding.agent !== "claude" || (binding.method !== "reviewed" && binding.method !== "automatic")
    || !Array.isArray(binding.roots) || !Array.isArray(binding.sources) || (binding.directories !== undefined && !Array.isArray(binding.directories))
    || !Array.isArray(aliases)
    // The prompt hook refuses Codex review artifacts on any other agent.
    || binding.sources.some(source => !object(source) || typeof source.path !== "string" || (source.sha256 !== null && typeof source.sha256 !== "string") || source.reviewArtifact !== undefined)
    || (binding.directories ?? []).some(directory => !object(directory) || typeof directory.path !== "string")) refuse("BINDING_INVALID");

  // The prompt hook's own check of a stored Claude binding, unchanged.
  let accepted = true;
  try {
    recheckRootAliases(aliases);
    verifyAgentDiscovery(binding, undefined, aliases);
    if (binding.method === "automatic") verifyAutomaticDiscoveryClosure(binding, { home: bridge.home, canonical: path => canonicalAgentPath(path, aliases), change: "Configured native discovery roots changed", executable: bridge.discoveryExecutables?.claude });
  } catch { accepted = false; }

  const verdicts = classifyClaudeDiscoverySources(binding);
  const sources = binding.sources.map((source, index): ClaudeBindingSourceReport => {
    const verdict = verdicts[index]!;
    const row = { index, path: source.path, hashMode: source.hashMode ?? null, format: source.format ?? null, sha256: source.sha256, status: verdict.status };
    if (verdict.status === "retained-absent") return { ...row, retention: { rule: ABSENT_RETIRED_CLAUDE_VERSION_RULE, root: verdict.root, witness: verdict.witness } };
    return verdict.status === "drift" ? { ...row, reason: verdict.reason } : row;
  });
  const stored = binding.directories ?? [];
  let captured: Array<{ sha256: string | null }> | null;
  try { captured = captureDiscoveryDirectories(stored.map(directory => directory.path)); } catch { captured = null; }
  const directories = stored.map((directory, index): ClaudeBindingDirectoryReport => {
    const row = { index, path: directory.path };
    if (captured === null) return { ...row, status: "drift", reason: "REFUSED" };
    return captured[index]!.sha256 === directory.sha256 ? { ...row, status: "current" } : { ...row, status: "drift", reason: "MEMBERSHIP_CHANGED" };
  });
  const failures: ClaudeBindingFailure[] = [
    ...sources.flatMap(row => row.status === "drift" ? [{ kind: "source" as const, index: row.index, path: row.path, reason: row.reason! }] : []),
    ...directories.flatMap(row => row.status === "drift" ? [{ kind: "directory" as const, index: row.index, path: row.path, reason: row.reason! }] : []),
    ...(accepted ? [] : [{ kind: "binding" as const, reason: "DISCOVERY_REFUSED" as const }]),
  ];
  // Like the candidate capture, the verdict is a point-in-time witness only if
  // the policy bytes it verified are still the policy at return time.
  if (readPolicy(dataDir).text !== snapshot.text) refuse("POLICY_CHANGED");
  return {
    schema: CLAUDE_DISCOVERY_BINDING_VERIFICATION_SCHEMA,
    ok: failures.length === 0,
    policySha256: createHash("sha256").update(snapshot.text).digest("hex"),
    discoverySha256: hashClaudeDiscoveryBinding(binding),
    agent: "claude",
    method: binding.method,
    rootCount: binding.roots.length,
    sources,
    directories,
    failures,
  };
}
