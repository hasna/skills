import { isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { need, snapshot, unchanged } from "./codex-hook-trust-files.js";
import { codexTrustReconcileWitness, codexTrustUnmanagedSemantic } from "./codex-hook-trust-layout.js";

type Snapshot = ReturnType<typeof snapshot>;
export interface NativeHookAdditionsRecovery { path: string; reviewedPlanDigest?: string }
const events = { UserPromptSubmit: ["userPromptSubmit", "user_prompt_submit"], SessionStart: ["sessionStart", "session_start"], SubagentStart: ["subagentStart", "subagent_start"] } as const;
const matchedEvents = { ...events, PreToolUse: ["preToolUse", "pre_tool_use"] } as const;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const text = (value: unknown, max = 2048): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\0\r\n]/.test(value);
// V2 reviews bind exact already-trusted commands, including multiline shell
// supervisors. Validate without normalizing any command bytes; v1 stays strict.
const v2Command = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 16384 && !/[\0\r]/.test(value);
const structure = (value: string): any => JSON.parse(JSON.stringify(Bun.TOML.parse(value)));
function exactKeys(value: any, keys: string[]) {
  need(value && typeof value === "object" && !Array.isArray(value) && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()), "RECONCILE_ADDITIONS_REVIEW_SCHEMA");
}
const nativeKeys = ["key", "eventName", "handlerType", "command", "matcher", "timeoutSec", "async", "statusMessage", "additionalContextLimit", "sourcePath", "source", "pluginId", "isManaged", "currentHash", "enabled", "trustStatus"];

/** Internal capability, not a caller-supplied config override. */
export interface ReviewedNativeHookAdditions { readonly reviewSha256: string }
type JournalHook = { key: string; currentHash: string };
type TrustState = Readonly<{ trusted_hash: string; enabled?: true }>;
type AddedTrustState = Readonly<{ key: string; state: TrustState }>;
const proofs = new WeakMap<ReviewedNativeHookAdditions, {
  before: Snapshot; current: Snapshot; journalHooks: JournalHook[];
  states: readonly AddedTrustState[]; recheck: () => void;
}>();

/** Rebind the proof to this exact journal transition and recheck every source.
 * A serialized/cloned receipt can never create a discovery exception. */
export function readReviewedAdditionTrustStates(proof: ReviewedNativeHookAdditions, before: Snapshot, current: Snapshot, journalHooks: JournalHook[]): readonly AddedTrustState[] {
  const captured = proofs.get(proof);
  need(!!captured && captured.before.file === before.file && captured.before.sha256 === before.sha256
    && captured.current.file === current.file && captured.current.sha256 === current.sha256
    && isDeepStrictEqual(captured.journalHooks, journalHooks.map(({ key, currentHash }) => ({ key, currentHash }))), "RECONCILE_ADDITIONS_PROOF_CHANGED");
  captured.recheck(); unchanged(before); unchanged(current);
  return captured.states;
}

/** An explicit, private review of a later producer's append-only hook change.
 * The producer backups must themselves describe exactly the completed journal
 * operation. Neither a claimed receipt nor a matching raw hash grants authority
 * to replace an original hook or accept unrelated configuration changes. */
export function reviewNativeHookAdditions(options: {
  path: string; intent: Snapshot; policy: Snapshot; configBefore: Snapshot; configCurrent: Snapshot;
  hooksBefore: Snapshot; hooksCurrent: Snapshot; nativeHooksPath: string;
  journalHooks: Array<{ key: string; currentHash: string }>; recordedNativeHooks: any[];
}) {
  need(isAbsolute(options.path), "RECONCILE_ADDITIONS_REVIEW_PATH");
  const reviewFile = snapshot(options.path, true), review = JSON.parse(reviewFile.text);
  exactKeys(review, ["version", "kind", "reason", "producerEvidence", "journalIntentSha256", "policySha256", "configCurrentSha256", "hooksCurrentSha256", "producerBefore", "additions"]);
  need((review.version === 1 || review.version === 2) && review.kind === "native-hook-additions" && text(review.reason) && text(review.producerEvidence), "RECONCILE_ADDITIONS_REVIEW_SCHEMA");
  for (const [name, expected] of [["journalIntentSha256", options.intent.sha256], ["policySha256", options.policy.sha256], ["configCurrentSha256", options.configCurrent.sha256], ["hooksCurrentSha256", options.hooksCurrent.sha256]] as const) need(hash(review[name]) && review[name] === expected, "RECONCILE_ADDITIONS_REVIEW_CHANGED");
  exactKeys(review.producerBefore, ["configPath", "configSha256", "hooksPath", "hooksSha256"]);
  const before = review.producerBefore;
  need(isAbsolute(before.configPath) && isAbsolute(before.hooksPath) && hash(before.configSha256) && hash(before.hooksSha256), "RECONCILE_ADDITIONS_PRODUCER_PREIMAGE");
  const producerConfig = snapshot(before.configPath, true), producerHooks = snapshot(before.hooksPath, true);
  need(producerConfig.sha256 === before.configSha256 && producerHooks.sha256 === before.hooksSha256 && producerHooks.sha256 === options.hooksBefore.sha256, "RECONCILE_ADDITIONS_PRODUCER_PREIMAGE");
  const original = structure(options.configBefore.text), producer = structure(producerConfig.text), expectedProducer = structuredClone(original), originalKeys = options.journalHooks.map(hook => hook.key);
  expectedProducer.hooks ??= {}; expectedProducer.hooks.state ??= {};
  for (const hook of options.journalHooks) expectedProducer.hooks.state[hook.key] = { ...expectedProducer.hooks.state[hook.key], enabled: true, trusted_hash: hook.currentHash };
  need(isDeepStrictEqual(expectedProducer, producer) && codexTrustReconcileWitness(options.configBefore.text, originalKeys) === codexTrustReconcileWitness(producerConfig.text, originalKeys) && codexTrustUnmanagedSemantic(options.configBefore.text, originalKeys) === codexTrustUnmanagedSemantic(producerConfig.text, originalKeys), "RECONCILE_ADDITIONS_PRODUCER_PREIMAGE");
  need(Array.isArray(review.additions) && review.additions.length > 0 && review.additions.length <= 20, "RECONCILE_ADDITIONS_REVIEW_SCHEMA");
  const expectedHooks = JSON.parse(options.hooksBefore.text), currentHooks = JSON.parse(options.hooksCurrent.text), expectedConfig = structuredClone(producer);
  need(expectedHooks.hooks && typeof expectedHooks.hooks === "object" && !Array.isArray(expectedHooks.hooks), "RECONCILE_ADDITIONS_DECLARATIONS");
  const added: any[] = [], states: AddedTrustState[] = [], seen = new Set<string>(), commands = new Set(options.recordedNativeHooks.map(hook => hook.command));
  for (const addition of review.additions) {
    exactKeys(addition, review.version === 1 ? ["event", "nativeHook"] : ["event", "nativeHook", "trustState"]);
    need(Object.hasOwn(review.version === 1 ? events : matchedEvents, addition.event), "RECONCILE_ADDITIONS_DECLARATIONS");
    const event = addition.event as keyof typeof matchedEvents, hook = addition.nativeHook;
    exactKeys(hook, nativeKeys);
    const groups = expectedHooks.hooks[event] ?? [];
    need(Array.isArray(groups), "RECONCILE_ADDITIONS_DECLARATIONS");
    const key = `${options.nativeHooksPath}:${matchedEvents[event][1]}:${groups.length}:0`;
    need(hook.key === key && !seen.has(key) && !options.recordedNativeHooks.some(originalHook => originalHook.key === key) && !Object.hasOwn(expectedConfig.hooks.state, key), "RECONCILE_ADDITIONS_IDENTITY");
    need(hook.eventName === matchedEvents[event][0] && hook.handlerType === "command" && (review.version === 2 ? v2Command(hook.command) : text(hook.command, 16384)) && !commands.has(hook.command) && Number.isInteger(hook.timeoutSec) && hook.timeoutSec > 0 && hook.timeoutSec <= 60 && (event === "PreToolUse" ? text(hook.matcher) : hook.matcher === null) && hook.async === false && hook.statusMessage === null && hook.additionalContextLimit === null && hook.sourcePath === options.nativeHooksPath && hook.source === "user" && hook.pluginId === null && hook.isManaged === false && /^sha256:[a-f0-9]{64}$/.test(hook.currentHash) && hook.enabled === true && hook.trustStatus === "trusted", "RECONCILE_ADDITIONS_IDENTITY");
    let trustState: TrustState = { enabled: true, trusted_hash: hook.currentHash };
    if (review.version === 2) {
      const state = addition.trustState;
      exactKeys(state, state && Object.hasOwn(state, "enabled") ? ["enabled", "trusted_hash"] : ["trusted_hash"]);
      need(state.trusted_hash === hook.currentHash && (!Object.hasOwn(state, "enabled") || state.enabled === true), "RECONCILE_ADDITIONS_TRUST_STATE");
      trustState = { ...state };
    }
    seen.add(key); commands.add(hook.command); added.push(hook);
    states.push(Object.freeze({ key, state: Object.freeze(trustState) }));
    expectedHooks.hooks[event] = [...groups, { ...(event === "PreToolUse" ? { matcher: hook.matcher } : {}), hooks: [{ type: "command", command: hook.command, timeout: hook.timeoutSec }] }];
    expectedConfig.hooks.state[key] = trustState;
  }
  need(isDeepStrictEqual(expectedHooks, currentHooks), "RECONCILE_ADDITIONS_DECLARATIONS");
  const keys = added.map(hook => hook.key);
  need(isDeepStrictEqual(expectedConfig, structure(options.configCurrent.text)) && codexTrustReconcileWitness(producerConfig.text, keys) === codexTrustReconcileWitness(options.configCurrent.text, keys) && codexTrustUnmanagedSemantic(producerConfig.text, keys) === codexTrustUnmanagedSemantic(options.configCurrent.text, keys), "RECONCILE_ADDITIONS_CONFIG");
  const inputs = [reviewFile, producerConfig, producerHooks, options.intent, options.policy, options.configBefore, options.configCurrent, options.hooksBefore, options.hooksCurrent];
  const recheck = () => { for (const input of inputs) unchanged(input); };
  recheck();
  const trustProof: ReviewedNativeHookAdditions = Object.freeze({ reviewSha256: reviewFile.sha256 });
  proofs.set(trustProof, { before: options.configBefore, current: options.configCurrent, journalHooks: options.journalHooks.map(({ key, currentHash }) => ({ key, currentHash })), states: Object.freeze(states), recheck });
  return { hooks: added, recheck, trustProof, receipt: { ...(review.version === 2 ? { version: 2 } : {}), reviewPath: reviewFile.file, reviewSha256: reviewFile.sha256, reason: review.reason as string, producerEvidence: review.producerEvidence as string, producerBefore: { configPath: producerConfig.file, configSha256: producerConfig.sha256, hooksPath: producerHooks.file, hooksSha256: producerHooks.sha256 }, additions: review.version === 1 ? added : review.additions } };
}
