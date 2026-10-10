import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { AgentDiscoveryBinding, DiscoverySource } from "./agent-discovery.js";
import { need, unchanged, type snapshot } from "./codex-hook-trust-files.js";
import { codexTrustReconcileWitness, codexTrustUnmanagedSemantic } from "./codex-hook-trust-layout.js";
import { readReviewedAdditionTrustStates, type ReviewedNativeHookAdditions } from "./codex-hook-additions-review.js";
import { CODEX_DISCOVERY_PROJECTION_FIELDS } from "./codex-settings-witness.js";

type Snapshot = ReturnType<typeof snapshot>;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const fields = [...CODEX_DISCOVERY_PROJECTION_FIELDS];
const structure = (text: string): any => JSON.parse(JSON.stringify(Bun.TOML.parse(text)));
// This field is a derived runtime projection of the policy's Codex plugin
// controls. Older persisted discovery bindings omit it; the verifier supplies
// an explicit empty array when there are no controls. Bind the same semantic
// value in both forms while retaining every non-empty control in the digest.
const discoveryDigest = (binding: AgentDiscoveryBinding): string => {
  const controls = binding.codexDisabledPluginSkills;
  if (!Object.hasOwn(binding, "codexDisabledPluginSkills") || (Array.isArray(controls) && controls.length === 0)) {
    const { codexDisabledPluginSkills: _controls, ...withoutControls } = binding;
    return sha(JSON.stringify({ ...withoutControls, codexDisabledPluginSkills: [] }));
  }
  return sha(JSON.stringify(binding));
};

/** A receipt projection, not an override supplied by a CLI caller. Only this
 * module can create the in-memory proof used by discovery verification. */
export interface CodexHookDiscoveryRecovery {
  readonly configPath: string;
  readonly beforeSha256: string;
  readonly currentSha256: string;
  readonly discoverySha256: string;
  readonly typedProjectionSha256: string;
}
const proofs = new WeakMap<CodexHookDiscoveryRecovery, { before: Snapshot; current: Snapshot; recheckAdditions: () => void }>();

/** Called after a complete journal/intent or the current reviewed native
 * transaction and exact intended trust writes have been checked. Recheck those
 * writes here so a raw hash alone can never
 * grant this exception. Policy bytes and recorded sources remain unchanged. */
export function createCodexHookDiscoveryRecovery(binding: AgentDiscoveryBinding, before: Snapshot, current: Snapshot, hooks: Array<{ key: string; currentHash: string }>, additions?: ReviewedNativeHookAdditions): CodexHookDiscoveryRecovery | undefined {
  const journalHooks = hooks.map(({ key, currentHash }) => ({ key, currentHash }));
  const additionStates = additions ? readReviewedAdditionTrustStates(additions, before, current, journalHooks) : [];
  const recheckAdditions = () => { if (additions) readReviewedAdditionTrustStates(additions, before, current, journalHooks); };
  const raw = binding.sources.filter(source => source.path === current.file && source.hashMode === "bytes");
  if (!raw.some(source => source.sha256 !== current.sha256)) return undefined;
  need(binding.agent === "codex" && binding.method === "reviewed" && raw.length === 1 && raw[0]!.sha256 === before.sha256 && before.sha256 !== current.sha256, "RECONCILE_DISCOVERY_CONFIG_WITNESS");
  need(raw[0]!.format === undefined && raw[0]!.fields === undefined && raw[0]!.managedPlugins === undefined, "RECONCILE_DISCOVERY_CONFIG_WITNESS");
  const typed = binding.sources.filter(source => source.path === current.file && source.format === "toml");
  need(typed.length === 1 && typed[0]!.hashMode === undefined && isDeepStrictEqual(typed[0]!.fields, fields), "RECONCILE_DISCOVERY_TYPED_WITNESS");
  const original = structure(before.text), actual = structure(current.text);
  const project = (value: any) => Object.fromEntries(fields.map(field => [field, value[field] ?? null]));
  const projection = sha(JSON.stringify(project(original)));
  need(typed[0]!.sha256 === projection && sha(JSON.stringify(project(actual))) === projection && isDeepStrictEqual(project(original), project(actual)), "RECONCILE_DISCOVERY_TYPED_WITNESS");
  const keys = [...journalHooks.map(hook => hook.key), ...additionStates.map(hook => hook.key)];
  need(journalHooks.length > 0 && keys.length <= 100 && new Set(keys).size === keys.length && journalHooks.every(hook => typeof hook.key === "string" && /^sha256:[a-f0-9]{64}$/.test(hook.currentHash)), "RECONCILE_DISCOVERY_TRUST_WITNESS");
  const expected = structuredClone(original);
  expected.hooks ??= {}; expected.hooks.state ??= {};
  for (const hook of journalHooks) expected.hooks.state[hook.key] = { ...expected.hooks.state[hook.key], enabled: true, trusted_hash: hook.currentHash };
  for (const { key, state } of additionStates) expected.hooks.state[key] = { ...state };
  need(isDeepStrictEqual(expected, actual) && codexTrustReconcileWitness(before.text, keys) === codexTrustReconcileWitness(current.text, keys) && codexTrustUnmanagedSemantic(before.text, keys) === codexTrustUnmanagedSemantic(current.text, keys), "RECONCILE_DISCOVERY_TRUST_WITNESS");
  unchanged(before); unchanged(current);
  const witness = Object.freeze({ configPath: current.file, beforeSha256: before.sha256, currentSha256: current.sha256, discoverySha256: discoveryDigest(binding), typedProjectionSha256: projection });
  proofs.set(witness, { before, current, recheckAdditions });
  return witness;
}

export function assertCodexHookDiscoveryRecovery(binding: AgentDiscoveryBinding, witness: CodexHookDiscoveryRecovery): void {
  const proof = proofs.get(witness);
  need(!!proof && binding.agent === "codex" && witness.discoverySha256 === discoveryDigest(binding), "RECONCILE_DISCOVERY_RECOVERY_CHANGED");
  unchanged(proof.before); unchanged(proof.current);
  proof.recheckAdditions();
}

/** Verify this one historical byte witness using the already-validated native
 * transition. Every other source still uses its ordinary current-file hash. */
export function verifiesCodexHookDiscoverySource(binding: AgentDiscoveryBinding, source: DiscoverySource, currentDigest: string | null, witness?: CodexHookDiscoveryRecovery): boolean {
  if (!witness || source.path !== witness.configPath || source.hashMode !== "bytes") return false;
  assertCodexHookDiscoveryRecovery(binding, witness);
  need(source.sha256 === witness.beforeSha256 && currentDigest === witness.currentSha256, "RECONCILE_DISCOVERY_RECOVERY_CHANGED");
  return true;
}
