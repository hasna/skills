import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import { codexNativeConfigEqual } from "./codex-native-config.js";
import { getDataDirReadOnly } from "./config.js";
import { parseManagedSkillPolicy } from "./managed-policy.js";
import { assertManagedAgentBridge } from "./agent-integration.js";
import { createCodexHookDiscoveryRecovery } from "./codex-hook-discovery-recovery.js";
import { renderAgentHookCommand } from "./agent-adapters.js";
import { connectCodexHookRpc, SUPPORTED_CODEX_HOOK_VERSIONS, type CodexHookRpc } from "./codex-hook-rpc.js";
import { codexTrustReconcileWitness, codexTrustTextWitness, codexTrustUnmanagedSemantic } from "./codex-hook-trust-layout.js";
import { need, snapshot, unchanged, save } from "./codex-hook-trust-files.js";
import { bindSkillsCli, inspectRecordedSkillsCli, type ReviewedSkillsCli } from "./codex-hook-trust-identity.js";
import { reviewedClaudeDiscoveryChange, type ClaudeDiscoveryRecovery } from "./codex-hook-policy-recovery.js";
import { readReviewedAdditionTrustStates, reviewNativeHookAdditions, type NativeHookAdditionsRecovery } from "./codex-hook-additions-review.js";

export interface CodexNativeHookTrustOptions { home?: string; dataDir?: string; codexCommand?: string; codexHome?: string; apply?: boolean; reviewedPlanDigest?: string; reviewedSkillsCli?: ReviewedSkillsCli }
export interface SkillsCliReleaseProof { packageTarPath: string; packageTarSha256: string; packageTarBytes: number; manifestSha256: string; executableSha256: string }
export interface CodexNativeHookReconcileOptions { home?: string; dataDir?: string; codexCommand?: string; journal: string; reviewedSkillsCli?: ReviewedSkillsCli; releaseProof?: SkillsCliReleaseProof; supersedeBinding?: boolean; claudeDiscoveryRecovery?: ClaudeDiscoveryRecovery; nativeHookAdditionsRecovery?: NativeHookAdditionsRecovery }
type Connect = typeof connectCodexHookRpc;
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const structure = (text: string) => JSON.parse(JSON.stringify(Bun.TOML.parse(text)));
const eventNames = { UserPromptSubmit: ["userPromptSubmit", "user_prompt_submit"], SessionStart: ["sessionStart", "session_start"], SubagentStart: ["subagentStart", "subagent_start"] } as const;
const makePlanDigest = (value: unknown) => createHash("sha256").update(json(value)).digest("hex");
const safeNativeHook = (hook: any) => ({ key: hook.key, eventName: hook.eventName, handlerType: hook.handlerType, command: hook.command, matcher: hook.matcher, timeoutSec: hook.timeoutSec, async: hook.async, statusMessage: hook.statusMessage, additionalContextLimit: hook.additionalContextLimit, sourcePath: hook.sourcePath, source: hook.source, pluginId: hook.pluginId, isManaged: hook.isManaged, currentHash: hook.currentHash, enabled: hook.enabled, trustStatus: hook.trustStatus });
const withoutCodexCommand = (value: any) => { const copy = structuredClone(value); if (copy?.bridge?.commands && Object.hasOwn(copy.bridge.commands, "codex")) copy.bridge.commands.codex = "<reviewed-codex-binding>"; return copy; };
function verifyReleaseArtifact(proof: SkillsCliReleaseProof, skillsCli: ReturnType<typeof bindSkillsCli>): void {
  need(isAbsolute(proof.packageTarPath) && !proof.packageTarPath.includes("\0"), "RECONCILE_RELEASE_PROVENANCE_PATH");
  const tarPath = realpathSync(proof.packageTarPath);
  need(statSync(tarPath).isFile(), "RECONCILE_RELEASE_PROVENANCE_PATH");
  const tarBytes = readFileSync(tarPath);
  need(tarBytes.byteLength === proof.packageTarBytes && createHash("sha256").update(tarBytes).digest("hex") === proof.packageTarSha256, "RECONCILE_RELEASE_ARTIFACT_CHANGED");
  const packageRoot = dirname(dirname(realpathSync(skillsCli.receipt.path)));
  const manifest = readFileSync(join(packageRoot, "package.json"));
  need(createHash("sha256").update(manifest).digest("hex") === skillsCli.receipt.manifestSha256 && skillsCli.receipt.manifestSha256 === proof.manifestSha256, "RECONCILE_RELEASE_MANIFEST_CHANGED");
  need(createHash("sha256").update(readFileSync(skillsCli.receipt.path)).digest("hex") === proof.executableSha256 && skillsCli.receipt.sha256 === proof.executableSha256, "RECONCILE_RELEASE_EXECUTABLE_CHANGED");
  const members: Array<[string, Buffer]> = [["package/package.json", manifest], ["package/bin/index.js", readFileSync(skillsCli.receipt.path)]];
  for (const [member, expected] of members) {
    let actual: Buffer; try { actual = execFileSync("tar", ["-xOf", tarPath, member], { maxBuffer: 32 * 1024 * 1024 }) as Buffer; } catch { throw new Error("RECONCILE_RELEASE_ARTIFACT_MEMBER_MISSING"); }
    need(Buffer.compare(actual, expected) === 0, "RECONCILE_RELEASE_ARTIFACT_MEMBER_CHANGED");
  }
}

/** Resolve an interrupted native write only after the native consumer and every
 * captured pre-write input agree. This never writes Codex state; it records a
 * receipt for an already-effective operation so the ordinary apply guard can
 * stop refusing the same journal. */
export async function reconcileCodexNativeHooks(options: CodexNativeHookReconcileOptions, connect: Connect = connectCodexHookRpc) {
  let rpc: CodexHookRpc | undefined;
  try {
    const home = resolve(options.home ?? homedir()), dataDir = resolve(options.dataDir ?? getDataDirReadOnly());
    const parent = resolve(join(dataDir, "native-hook-trust")), journal = resolve(options.journal);
    need(journal.startsWith(parent + "/") && /^[a-f0-9-]{36}$/.test(journal.slice(parent.length + 1)), "RECONCILE_JOURNAL_PATH");
    const dir = lstatSync(journal, { throwIfNoEntry: false });
    need(!!dir && dir.isDirectory() && !dir.isSymbolicLink() && dir.uid === process.getuid!() && (dir.mode & 0o777) === 0o700, "UNSAFE_JOURNAL");
    need(!lstatSync(join(journal, "receipt.json"), { throwIfNoEntry: false }), "RECONCILE_ALREADY_COMPLETE");
    need(lstatSync(join(journal, "stopped.json"), { throwIfNoEntry: false })?.isFile(), "RECONCILE_JOURNAL_INCOMPLETE");
    const stoppedFile = snapshot(join(journal, "stopped.json"), true);
    const intentFile = snapshot(join(journal, "intent.json"), true), intent: any = JSON.parse(intentFile.text);
    const configBefore = snapshot(join(journal, "config.before.toml"), true), hooksBefore = snapshot(join(journal, "hooks.before.json"), true), policyBefore = snapshot(join(journal, "policy.before.json"), true);
    const legacyIntent = intent.home === undefined && intent.configSha256 === undefined && intent.configVersion === undefined && intent.declarations === undefined && intent.admitted === undefined && intent.nativeHooks === undefined;
    need(intent.version === 1 && /^[a-f0-9]{64}$/.test(intent.planDigest) && typeof intent.configPath === "string" && /^[a-f0-9]{64}$/.test(intent.policySha256) && /^[a-f0-9]{64}$/.test(intent.hooksSha256) && Array.isArray(intent.hooks) && intent.hooks.length > 0 && intent.hooks.length <= 100 && (legacyIntent || (typeof intent.home === "string" && intent.home === home && /^[a-f0-9]{64}$/.test(intent.configSha256) && typeof intent.configVersion === "string" && Array.isArray(intent.declarations) && Array.isArray(intent.admitted) && Array.isArray(intent.nativeHooks))), "RECONCILE_INTENT_INVALID");
    const declarations = intent.declarations ?? intent.hooks.map((hook: any) => ({ event: hook.event, key: `${join(home, ".codex/hooks.json")}${hook.key.slice(hook.key.indexOf(".codex/hooks.json") + ".codex/hooks.json".length)}`, command: hook.command }));
    const admitted = intent.admitted ?? intent.hooks;
    const configSha256 = intent.configSha256 ?? configBefore.sha256, configVersion = intent.configVersion ?? intent.expectedVersion;
    const digestInput = { version: 1, home: intent.home ?? home, configPath: intent.configPath, ...(intent.nativeConfigPath !== undefined ? { nativeConfigPath: intent.nativeConfigPath } : {}), configSha256, configVersion, policySha256: intent.policySha256, hooksSha256: intent.hooksSha256, skillsCli: intent.skillsCli, nativeVersion: intent.nativeVersion, declarations, admitted };
    need(makePlanDigest(digestInput) === intent.planDigest, "RECONCILE_PLAN_CHANGED");
    need(isDeepStrictEqual(intent.hooks, admitted.filter((hook: any) => !hook.enabled || hook.trustStatus !== "trusted")), "RECONCILE_INTENT_HOOKS_CHANGED");
    need(configBefore.sha256 === (intent.beforeSha256 ?? intent.configSha256) && hooksBefore.sha256 === intent.hooksSha256 && policyBefore.sha256 === intent.policySha256, "RECONCILE_JOURNAL_CHANGED");
    const policyCurrent = snapshot(join(dataDir, "agent-policy.json"), true);
    const claudeRecovery = options.claudeDiscoveryRecovery, additionsRecovery = options.nativeHookAdditionsRecovery;
    const recovery = claudeRecovery ?? additionsRecovery;
    need(!recovery || !options.supersedeBinding, "RECONCILE_RECOVERY_MODE_CONFLICT");
    need(!claudeRecovery || !additionsRecovery || claudeRecovery.reviewedPlanDigest === additionsRecovery.reviewedPlanDigest, "RECONCILE_RECOVERY_MODE_CONFLICT");
    need(recovery?.reviewedPlanDigest === undefined || /^[a-f0-9]{64}$/.test(recovery.reviewedPlanDigest), "RECONCILE_RECOVERY_PLAN_CHANGED");
    const policyChange = claudeRecovery ? reviewedClaudeDiscoveryChange(policyBefore.text, policyCurrent.text, claudeRecovery) : undefined;
    let supersededBinding = false;
    if (policyCurrent.sha256 !== policyBefore.sha256 && !claudeRecovery) {
      need(options.supersedeBinding === true, "RECONCILE_POLICY_CHANGED");
      const oldPolicy = JSON.parse(policyBefore.text), currentPolicy = JSON.parse(policyCurrent.text);
      need(isDeepStrictEqual(withoutCodexCommand(oldPolicy), withoutCodexCommand(currentPolicy)), "RECONCILE_POLICY_CHANGED");
      supersededBinding = true;
    }
    if (supersededBinding || recovery) {
      need(Array.isArray(intent.nativeHooks) && intent.nativeHooks.length > 0, "RECONCILE_NATIVE_INVENTORY_REQUIRED");
      const proof = options.releaseProof;
      need(!!proof && isAbsolute(proof.packageTarPath) && /^[a-f0-9]{64}$/.test(proof.packageTarSha256) && Number.isInteger(proof.packageTarBytes) && proof.packageTarBytes > 0 && /^[a-f0-9]{64}$/.test(proof.manifestSha256) && /^[a-f0-9]{64}$/.test(proof.executableSha256), "RECONCILE_RELEASE_PROVENANCE_REQUIRED");
    }
    const currentConfig = snapshot(intent.configPath, true);
    const policy = parseManagedSkillPolicy(policyCurrent.text), binding = policy.bridge;
    const alias = binding.rootAliases?.find((item: any) => item.agent === "codex"), physicalRoot = alias?.target ?? join(home, ".codex"), hooksPath = join(physicalRoot, "hooks.json");
    need(resolve(intent.configPath) === resolve(join(physicalRoot, "config.toml")), "RECONCILE_CONFIG_PATH_CHANGED");
    // The native lexical view remains distinct even when its root is an alias.
    const nativeConfigPath = intent.nativeConfigPath ?? intent.configPath;
    need([join(home, ".codex/config.toml"), join(physicalRoot, "config.toml")].includes(nativeConfigPath), "RECONCILE_NATIVE_CONFIG_PATH_CHANGED");
    const codexHome = nativeConfigPath !== intent.configPath ? undefined : dirname(nativeConfigPath);
    const hooksCurrent = snapshot(hooksPath);
    const additions = additionsRecovery ? reviewNativeHookAdditions({ path: additionsRecovery.path, intent: intentFile, policy: policyCurrent, configBefore, configCurrent: currentConfig, hooksBefore, hooksCurrent, nativeHooksPath: join(dirname(nativeConfigPath), "hooks.json"), journalHooks: intent.hooks, recordedNativeHooks: intent.nativeHooks }) : undefined;
    const managedHooks = [...intent.hooks, ...(additions?.hooks ?? [])];
    const managedKeys = managedHooks.map((h: any) => h.key);
    const witnessSame = codexTrustReconcileWitness(configBefore.text, managedKeys) === codexTrustReconcileWitness(currentConfig.text, managedKeys);
    const unmanagedSame = codexTrustUnmanagedSemantic(configBefore.text, managedKeys) === codexTrustUnmanagedSemantic(currentConfig.text, managedKeys);
    need(unmanagedSame && (witnessSame || supersededBinding), "RECONCILE_UNRELATED_CONFIG_CHANGED");
    const before = structure(configBefore.text), current = structure(currentConfig.text), expectedConfig = structuredClone(before);
    expectedConfig.hooks ??= {}; expectedConfig.hooks.state ??= {};
    for (const hook of intent.hooks) expectedConfig.hooks.state[hook.key] = { ...expectedConfig.hooks.state[hook.key], enabled: true, trusted_hash: hook.currentHash };
    if (additions) for (const { key, state } of readReviewedAdditionTrustStates(additions.trustProof, configBefore, currentConfig, intent.hooks)) expectedConfig.hooks.state[key] = { ...state };
    if (supersededBinding) {
      for (const hook of intent.hooks) {
        const state = current.hooks?.state?.[hook.key];
        need(state?.enabled === true && typeof state.trusted_hash === "string" && /^sha256:[a-f0-9]{64}$/.test(state.trusted_hash), "RECONCILE_CONFIG_DRIFT");
      }
    } else need(isDeepStrictEqual(expectedConfig, current), "RECONCILE_CONFIG_DRIFT");
    const configDiscoveryRecovery = recovery && binding.discovery?.codex
      ? createCodexHookDiscoveryRecovery(binding.discovery.codex, configBefore, currentConfig, intent.hooks, additions?.trustProof)
      : undefined;
    assertManagedAgentBridge("codex", { home, dataDir, projectDir: home, codexDiscoveryRecovery: configDiscoveryRecovery });
    // Recovery runs through the current CLI, while the old, unchanged command
    // stays a journal witness. Neither its source nor its hooks are executed.
    const recoveryCli = recovery ? bindSkillsCli("skills", options.reviewedSkillsCli) : undefined;
    if (recoveryCli) verifyReleaseArtifact(options.releaseProof!, recoveryCli);
    const skillsCli = recovery ? inspectRecordedSkillsCli(binding.commands.codex, intent.skillsCli) : bindSkillsCli(binding.commands.codex, options.reviewedSkillsCli);
    if (supersededBinding) verifyReleaseArtifact(options.releaseProof!, skillsCli);
    const skillsBindingChanged = !isDeepStrictEqual(skillsCli.receipt, intent.skillsCli);
    need(!skillsBindingChanged || supersededBinding, "RECONCILE_SKILLS_BINDING_CHANGED");
    if (!additions && hooksCurrent.sha256 !== intent.hooksSha256 && hooksCurrent.sha256 !== hooksBefore.sha256) {
      need(supersededBinding, "RECONCILE_HOOKS_CHANGED");
      const currentDeclarations = JSON.parse(hooksCurrent.text).hooks;
      for (const [event, [nativeEvent]] of Object.entries(eventNames)) {
        const command = renderAgentHookCommand(binding.commands.codex, "codex", binding.profiles.codex, event);
        need(isDeepStrictEqual(currentDeclarations?.[event], [{ hooks: [{ type: "command", command, timeout: 15 }] }]), "RECONCILE_BINDING_HOOK_CHANGED");
      }
    }
    rpc = await connect({ command: options.codexCommand ?? "codex", home, codexHome });
    need(rpc.version === intent.nativeVersion, "RECONCILE_NATIVE_VERSION_CHANGED");
    const discovered = await rpc.request("hooks/list", { cwds: [home] });
    need(Array.isArray(discovered?.data) && discovered.data.length === 1 && discovered.data[0].cwd === home && !discovered.data[0].errors?.length && !discovered.data[0].warnings?.length, "RECONCILE_NATIVE_DISCOVERY_REFUSED");
    const nativeHooks = discovered.data[0].hooks as any[];
    const recordedNativeHooks = intent.nativeHooks as any[] | undefined;
    if (recordedNativeHooks) need(nativeHooks.length === recordedNativeHooks.length + (additions?.hooks.length ?? 0), "RECONCILE_NATIVE_HOOK_LIST_CHANGED");
    const plannedKeys = new Set(intent.hooks.map((hook: any) => hook.key));
    let nativeTrustPending = false;
    for (const expected of [...(recordedNativeHooks ?? []), ...(additions?.hooks ?? [])]) {
      const matches = nativeHooks.filter((hook: any) => hook.key === expected.key);
      need(matches.length === 1, "RECONCILE_NATIVE_HOOK_LIST_CHANGED");
      const actual = safeNativeHook(matches[0]);
      const stable = (hook: any) => { const { enabled, trustStatus, ...identity } = hook; if (supersededBinding) delete identity.command; return identity; };
      need(isDeepStrictEqual(stable(actual), stable(expected)), "RECONCILE_NATIVE_IDENTITY_CHANGED");
      if (!plannedKeys.has(expected.key)) need(isDeepStrictEqual(actual, expected), "RECONCILE_UNRELATED_HOOK_CHANGED");
    }
    for (const wanted of intent.hooks) {
      const matches = nativeHooks.filter((h: any) => h.key === wanted.key || h.key === wanted.key.replace(join(home, ".codex/hooks.json"), hooksPath));
      need(matches.length === 1, "RECONCILE_NATIVE_IDENTITY_CHANGED");
      const h = matches[0];
      const trusted = h.trustStatus === "trusted";
      need(h.enabled === true && (trusted || (supersededBinding && h.trustStatus === "modified")) && (h.currentHash === wanted.currentHash || (supersededBinding && /^sha256:[a-f0-9]{64}$/.test(h.currentHash))), "RECONCILE_NATIVE_STATE_INCOMPLETE");
      if (!trusted) nativeTrustPending = true;
      if (supersededBinding) {
        const nativeToCliEvent: Record<string, string> = { userPromptSubmit: "UserPromptSubmit", sessionStart: "SessionStart", subagentStart: "SubagentStart" };
        need(h.command === renderAgentHookCommand(binding.commands.codex, "codex", binding.profiles.codex, nativeToCliEvent[wanted.event] ?? ""), "RECONCILE_BINDING_HOOK_CHANGED");
      }
    }
    const config = await rpc.request("config/read", { includeLayers: true, cwd: home });
    const layers = config?.layers?.filter((layer: any) => layer.name?.type === "user" && layer.name.file === nativeConfigPath && !layer.name.profile);
    need(layers?.length === 1 && !layers[0].disabledReason && codexNativeConfigEqual(layers[0].config, current), "RECONCILE_NATIVE_CONFIG_MISMATCH");
    const finalDiscovery = await rpc.request("hooks/list", { cwds: [home] });
    need(Array.isArray(finalDiscovery?.data) && finalDiscovery.data.length === 1 && finalDiscovery.data[0].cwd === home && !finalDiscovery.data[0].errors?.length && !finalDiscovery.data[0].warnings?.length && (!recordedNativeHooks || isDeepStrictEqual((finalDiscovery.data[0].hooks as any[]).map(safeNativeHook), nativeHooks.map(safeNativeHook))), "RECONCILE_NATIVE_STATE_CHANGED");
    const finalConfig = await rpc.request("config/read", { includeLayers: true, cwd: home });
    const finalLayers = finalConfig?.layers?.filter((layer: any) => layer.name?.type === "user" && layer.name.file === nativeConfigPath && !layer.name.profile);
    need(finalLayers?.length === 1 && !finalLayers[0].disabledReason && codexNativeConfigEqual(finalLayers[0].config, current), "RECONCILE_NATIVE_CONFIG_CHANGED");
    if (recovery) {
      for (const response of [config, finalConfig]) {
        const layerIndex = response.layers.findIndex((layer: any) => layer.name?.type === "user" && layer.name.file === nativeConfigPath && !layer.name.profile);
        need(response.config && response.config.features?.hooks !== false && response.layers.slice(0, layerIndex).every((layer: any) => layer.config?.hooks === undefined && layer.config?.features?.hooks === undefined), "RECONCILE_NATIVE_CONFIG_OVERRIDDEN");
      }
      recoveryCli!.recheck(); verifyReleaseArtifact(options.releaseProof!, recoveryCli!);
      if (claudeRecovery) reviewedClaudeDiscoveryChange(policyBefore.text, policyCurrent.text, claudeRecovery);
    }
    unchanged(stoppedFile); unchanged(intentFile); unchanged(configBefore); unchanged(hooksBefore); unchanged(policyBefore); unchanged(policyCurrent); unchanged(hooksCurrent); unchanged(currentConfig); additions?.recheck(); skillsCli.recheck(); assertManagedAgentBridge("codex", { home, dataDir, projectDir: home, codexDiscoveryRecovery: configDiscoveryRecovery });
    const recoveryPlan = recovery ? { version: 1, kind: additions ? claudeRecovery ? "claude-discovery-and-native-hook-additions" : "native-hook-additions" : "claude-discovery-only", journal, journalIntentSha256: intentFile.sha256, stoppedSha256: stoppedFile.sha256, originalPlanDigest: intent.planDigest, policyBeforeSha256: policyBefore.sha256, policyCurrentSha256: policyCurrent.sha256, configBeforeSha256: configBefore.sha256, configCurrentSha256: currentConfig.sha256, ...(configDiscoveryRecovery ? { configDiscoveryRecovery } : {}), ...(additions ? { nativeHookAdditions: additions.receipt } : {}), hooksSha256: hooksCurrent.sha256, nativeConfigPath, nativeVersion: rpc.version, nativeInventorySha256: makePlanDigest(nativeHooks.map(safeNativeHook)), recordedNativeInventorySha256: makePlanDigest(recordedNativeHooks), boundSkillsCli: skillsCli.receipt, recoveryCli: recoveryCli!.receipt, releaseProof: options.releaseProof, ...policyChange } : undefined;
    const recoveryPlanDigest = recoveryPlan ? makePlanDigest(recoveryPlan) : undefined;
    if (recovery?.reviewedPlanDigest !== undefined) need(recovery.reviewedPlanDigest === recoveryPlanDigest, "RECONCILE_RECOVERY_PLAN_CHANGED");
    const preview = !!recovery && recovery.reviewedPlanDigest === undefined;
    const receipt = { version: 1, status: preview ? "recovery-review-required" : supersededBinding ? "superseded" : "reconciled", reconciled: !preview, supersededBinding, automaticRollback: false, journal, planDigest: intent.planDigest, nativeVersion: rpc.version, nativeStateVerified: !nativeTrustPending, nativeTrustPending, bindingRefreshRequired: !!configDiscoveryRecovery, nativeExecutionVerified: false, configSha256: currentConfig.sha256, hooksSha256: hooksCurrent.sha256, policySha256: policyBefore.sha256, policyBeforeSha256: policyBefore.sha256, policyCurrentSha256: policyCurrent.sha256, previousSkillsCli: intent.skillsCli, skillsCli: skillsCli.receipt, releaseProof: options.releaseProof, nativeInventoryScope: recordedNativeHooks ? "complete" : "declared-managed-hooks-only", unrelatedNativeHooksPreserved: !!recordedNativeHooks, unrelatedSettingsAndCommentsPreserved: true, ...(recoveryPlan ? { recoveryPlan, recoveryPlanDigest } : {}) };
    if (preview) return receipt;
    save(join(journal, "receipt.json"), json(receipt));
    return receipt;
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("CODEX_HOOK_TRUST_") ? error.message : "CODEX_HOOK_TRUST_RECONCILE_REFUSED";
    throw new Error(message);
  } finally { await rpc?.close(); }
}

/** Deliberately separate from filesystem hook installation: native trust is an
 * explicit authorization of exact owned commands, never a broad trust bypass. */
export async function enrollCodexNativeHooks(options: CodexNativeHookTrustOptions = {}, connect: Connect = connectCodexHookRpc) {
  let rpc: CodexHookRpc | undefined, journal: string | undefined;
  try {
    const home = resolve(options.home ?? homedir()), dataDir = resolve(options.dataDir ?? getDataDirReadOnly());
    assertManagedAgentBridge("codex", { home, dataDir, projectDir: home });
    const policyFile = snapshot(join(dataDir, "agent-policy.json"), true), policy = parseManagedSkillPolicy(policyFile.text);
    const binding = policy.bridge, alias = binding.rootAliases?.find((item: any) => item.agent === "codex");
    const skillsCli = bindSkillsCli(binding.commands.codex, options.reviewedSkillsCli);
    const physicalRoot = alias?.target ?? join(home, ".codex"), hooksPath = join(physicalRoot, "hooks.json"), configPath = join(physicalRoot, "config.toml");
    // Codex keys trust by the lexical discovery path. Keep the caller's native
    // view while snapshotting only the separately admitted canonical files.
    need(options.codexHome === undefined || (isAbsolute(options.codexHome) && [join(home, ".codex"), physicalRoot].includes(options.codexHome)), "NATIVE_HOME_NOT_ADMITTED");
    // An explicit native home resolves to the admitted canonical target. The
    // default must stay unset so Codex retains its normal lexical hook keys.
    const codexHome = options.codexHome === undefined ? undefined : physicalRoot;
    const nativeConfigPath = join(codexHome ?? join(home, ".codex"), "config.toml");
    const hooksFile = snapshot(hooksPath), configFile = snapshot(configPath, true), original = structure(configFile.text);
    const declarations = JSON.parse(hooksFile.text).hooks, expected: Array<{ event: string; key: string; command: string }> = [];
    for (const [event, [nativeEvent, label]] of Object.entries(eventNames)) {
      const command = renderAgentHookCommand(binding.commands.codex, "codex", binding.profiles.codex, event);
      const groups = declarations[event]; need(Array.isArray(groups), "DECLARATION_CHANGED");
      const matches = groups.flatMap((group: any, gi: number) => (group.hooks ?? []).flatMap((entry: any, hi: number) => entry.command === command ? [{ group, entry, gi, hi }] : []));
      need(matches.length === 1 && isDeepStrictEqual(matches[0].group, { hooks: [{ type: "command", command, timeout: 15 }] }), "DECLARATION_CHANGED");
      expected.push({ event: nativeEvent, key: `${join(home, ".codex/hooks.json")}:${label}:${matches[0].gi}:${matches[0].hi}`, command });
    }
    codexTrustTextWitness(configFile.text, expected.map(h => h.key));
    rpc = await connect({ command: options.codexCommand ?? "codex", home, codexHome });
    need((SUPPORTED_CODEX_HOOK_VERSIONS as readonly string[]).includes(rpc.version), "NATIVE_UNSUPPORTED_VERSION");
    const list = async () => {
      const response = await rpc!.request("hooks/list", { cwds: [home] });
      // Codex intentionally loads user hooks from both config.toml and
      // hooks.json. Permit only its exact, known coexistence warning for the
      // admitted native roots; unrelated warnings and all discovery errors
      // remain fail-closed. Keep another application's config.toml hook in
      // place rather than migrating it and invalidating its native trust key.
      const nativeRoots = [...new Set([physicalRoot, join(home, ".codex")])];
      const coexistenceWarnings = nativeRoots.flatMap(hooksRoot => nativeRoots.map(configRoot =>
        `loading hooks from both ${join(hooksRoot, "hooks.json")} and ${join(configRoot, "config.toml")}; prefer a single representation for this layer`));
      const entry = response?.data?.[0];
      need(Array.isArray(response?.data) && response.data.length === 1 && entry.cwd === home && Array.isArray(entry.hooks) && entry.hooks.length <= 10000
        && Array.isArray(entry.errors) && entry.errors.length === 0 && Array.isArray(entry.warnings) && entry.warnings.length <= 1
        && entry.warnings.every((warning: unknown) => typeof warning === "string" && coexistenceWarnings.includes(warning)), "NATIVE_DISCOVERY_REFUSED");
      return response.data[0].hooks as any[];
    };
    const admit = (hooks: any[]) => expected.map(wanted => {
      // Native versions may use the canonical path or the admitted home alias.
      const canonicalKey = wanted.key.replace(join(home, ".codex/hooks.json"), hooksPath);
      const matches = hooks.filter(h => h.key === wanted.key || h.key === canonicalKey);
      need(matches.length === 1, "AMBIGUOUS_IDENTITY"); const h = matches[0];
      need(h.eventName === wanted.event && h.handlerType === "command" && h.command === wanted.command && h.matcher === null && h.timeoutSec === 15 && h.async === false && h.statusMessage === null && h.additionalContextLimit === null && [hooksPath, join(home, ".codex/hooks.json")].includes(h.sourcePath) && h.source === "user" && h.pluginId === null && h.isManaged === false && /^sha256:[a-f0-9]{64}$/.test(h.currentHash) && typeof h.enabled === "boolean", "NATIVE_IDENTITY_CHANGED");
      need(hooks.filter(other => other.command === wanted.command).length === 1, "AMBIGUOUS_IDENTITY");
      need(["trusted", "untrusted", "modified"].includes(h.trustStatus), "UNKNOWN_TRUST_STATUS");
      return { key: h.key, event: wanted.event, command: wanted.command, handlerType: h.handlerType, timeoutSec: h.timeoutSec, sourcePath: h.sourcePath, currentHash: h.currentHash, enabled: h.enabled, trustStatus: h.trustStatus };
    });
    const discovered = await list(), admitted = admit(discovered);
    const config = await rpc.request("config/read", { includeLayers: true, cwd: home });
    const layers = config?.layers?.filter((layer: any) => layer.name?.type === "user" && layer.name.file === nativeConfigPath && !layer.name.profile);
    need(layers?.length === 1 && /^sha256:[a-f0-9]{64}$/.test(layers[0].version) && !layers[0].disabledReason && codexNativeConfigEqual(layers[0].config, original), "NATIVE_CONFIG_MISMATCH");
    need(config.config && config.config.features?.hooks !== false, "NATIVE_HOOKS_DISABLED");
    need(config.layers.slice(0, config.layers.indexOf(layers[0])).every((layer: any) => layer.config?.hooks === undefined && layer.config?.features?.hooks === undefined), "NATIVE_CONFIG_OVERRIDDEN");
    const keys = admitted.map(h => h.key), planned = admitted.filter(h => !h.enabled || h.trustStatus !== "trusted");
    const preservationText = codexTrustTextWitness(configFile.text, keys);
    const checkInputs = () => { skillsCli.recheck(); assertManagedAgentBridge("codex", { home, dataDir, projectDir: home }); unchanged(policyFile); unchanged(hooksFile); unchanged(configFile); };
    checkInputs();
    const digestInput = { version: 1, home, configPath, ...(nativeConfigPath !== configPath ? { nativeConfigPath } : {}), configSha256: configFile.sha256, configVersion: layers[0].version, policySha256: policyFile.sha256, hooksSha256: hooksFile.sha256, skillsCli: skillsCli.receipt, nativeVersion: rpc.version, declarations: expected, admitted };
    const planDigest = makePlanDigest(digestInput);
    const baseReceipt = { planDigest, skillsCli: skillsCli.receipt, nativeVersion: rpc.version, nativeConfigPath, ownedNativeProcessId: rpc.processId, agent: "codex", applied: false, planned, nativeEligible: planned.length === 0, bindingRefreshRequired: false, transport: "owned-stdio-process", existingSessionsReloaded: false, nativeExecutionVerified: false };
    if (options.apply) need(options.reviewedPlanDigest === planDigest, "PLAN_CHANGED: run the dry-run again and pass its reviewed --plan-digest with --apply");
    const parent = join(dataDir, "native-hook-trust");
    const st = lstatSync(parent, { throwIfNoEntry: false });
    if (st) {
      need(st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid!() && (st.mode & 0o777) === 0o700, "UNSAFE_JOURNAL");
      const priorJournals = readdirSync(parent); need(priorJournals.length < 1000, "JOURNAL_BOUND");
      for (const name of priorJournals) {
        need(/^[a-f0-9-]{36}$/.test(name), "UNSAFE_JOURNAL");
        need(lstatSync(join(parent, name, "receipt.json"), { throwIfNoEntry: false })?.isFile(), "RECONCILE_REQUIRED: inspect the incomplete private journal before applying again");
      }
    }
    if (!options.apply || !planned.length) return baseReceipt;
    if (!st) mkdirSync(parent, { mode: 0o700 });
    journal = join(parent, randomUUID()); mkdirSync(journal, { mode: 0o700 });
    save(join(journal, "config.before.toml"), configFile.bytes);
    save(join(journal, "hooks.before.json"), hooksFile.bytes);
    save(join(journal, "policy.before.json"), policyFile.bytes);
    save(join(journal, "intent.json"), json({ ...digestInput, planDigest, hooks: planned, nativeHooks: discovered.map(safeNativeHook) }));
    need(isDeepStrictEqual(admit(await list()), admitted), "NATIVE_DISCOVERY_CHANGED"); checkInputs();
    let result: any;
    try { result = await rpc.request("config/batchWrite", { edits: [{ keyPath: "hooks.state", value: Object.fromEntries(planned.map(h => [h.key, { enabled: true, trusted_hash: h.currentHash }])), mergeStrategy: "upsert" }], filePath: configPath, expectedVersion: layers[0].version, reloadUserConfig: true }); }
    catch { throw new Error("CODEX_HOOK_TRUST_NATIVE_WRITE_FAILED: reconcile the private journal before retrying"); }
    need(result?.status === "ok" && result.filePath === configPath && /^sha256:[a-f0-9]{64}$/.test(result.version), "NATIVE_WRITE_OVERRIDDEN");
    const after = snapshot(configPath, true), expectedConfig = structuredClone(original);
    expectedConfig.hooks ??= {}; expectedConfig.hooks.state ??= {};
    for (const h of planned) expectedConfig.hooks.state[h.key] = { ...expectedConfig.hooks.state[h.key], enabled: true, trusted_hash: h.currentHash };
    need(isDeepStrictEqual(structure(after.text), expectedConfig) && codexTrustTextWitness(after.text, keys) === preservationText, "PRESERVATION_FAILED");
    // Complete only this reviewed native transaction. A full-file discovery
    // witness still names the pre-write bytes until a separate fresh review is
    // installed; the ordinary hook guard must keep refusing in that interval.
    const savedConfig = snapshot(join(journal, "config.before.toml"), true);
    need(savedConfig.sha256 === configFile.sha256, "JOURNAL_CHANGED");
    const discoveryTransition = binding.discovery?.codex
      ? createCodexHookDiscoveryRecovery(binding.discovery.codex, savedConfig, after, planned)
      : undefined;
    unchanged(policyFile); unchanged(hooksFile); assertManagedAgentBridge("codex", { home, dataDir, projectDir: home, codexDiscoveryRecovery: discoveryTransition });
    const current = await list(), confirmed = admit(current);
    need(confirmed.every(h => h.enabled && h.trustStatus === "trusted") && isDeepStrictEqual(confirmed.map(h => [h.key, h.currentHash]), admitted.map(h => [h.key, h.currentHash])), "NATIVE_NOT_ELIGIBLE");
    need(isDeepStrictEqual(current.filter(h => !keys.includes(h.key)), discovered.filter(h => !keys.includes(h.key))), "UNRELATED_HOOK_CHANGED");
    unchanged(after); unchanged(savedConfig); unchanged(hooksFile); unchanged(policyFile); skillsCli.recheck();
    assertManagedAgentBridge("codex", { home, dataDir, projectDir: home, codexDiscoveryRecovery: discoveryTransition });
    const receipt = { ...baseReceipt, applied: true, nativeEligible: true, bindingRefreshRequired: !!discoveryTransition, ...(discoveryTransition ? { discoveryTransition } : {}), nativeConfigVersion: result.version, journal, beforeSha256: configFile.sha256, afterSha256: after.sha256, unrelatedSettingsAndCommentsPreserved: true };
    save(join(journal, "receipt.json"), json(receipt)); return receipt;
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("CODEX_HOOK_TRUST_") ? error.message : "CODEX_HOOK_TRUST_REFUSED: verify managed bridge installation and native Codex support";
    if (journal) { try { save(join(journal, "stopped.json"), json({ error: message.split(":")[0], automaticRollback: false, reconcileBeforeRetry: true })); } catch { /* Preserve original refusal; never print configuration. */ } }
    throw new Error(message);
  } finally { await rpc?.close(); }
}
