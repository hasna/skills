import { captureSumiSettings } from "../../lib/sumi-settings-witness.js";
import { writeCliOutput } from "../output.js";
import type { Command } from "commander";
import { existsSync, lstatSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { type ReviewedDiscoveryInputs } from "../../lib/agent-discovery.js";
import { normalizeHermesHookInput, assertHermesTool } from "../../lib/agent-hermes.js";
import { parseSkillContextInput, selectedProfileId } from "./context.js";
import { AGENT_ADAPTERS, INTEGRATION_AGENTS, normalizeAgentHookEvent } from "../../lib/agent-adapters.js";
import { planAgentIntegration, planClaudeManagedHookProjection, planAgentSettingsWitnessUpgrade, applyAgentIntegration, inventoryNativeSkills, archiveNativeSkills, assertManagedAgentBridge, hookContextOutput, normalizeAgentHookPrompt, readNativeMigrationTargetManifest, selectNativeMigrationTargets, type IntegrationAgent } from "../../lib/agent-integration.js";
import { enrollCodexNativeHooks, reconcileCodexNativeHooks } from "../../lib/agent-codex-trust.js";
import { codexNativeHookEnvelopeFromInput, CODEX_NATIVE_POLICY_FD_ENV } from "../../lib/codex-native-skill-policy.js";
import { planCodexNativeTrust, applyCodexNativeTrust, previewCodexNativeTrust } from "../../lib/codex-native-trust.js";
import { HookDiagnosticError, hookChildError, hookFailureReason, isOptionalHookContextFailure, hookUnavailableContext } from "../../lib/hook-diagnostics.js";
import { readSkillSessionSnapshotIfExists, SkillSelectionError } from "../../lib/selection-cache.js";
import { captureClaudeSettingsV2, captureClaudeSettingsV3 } from "../../lib/claude-settings-witness.js";
import { captureCodexSettings, captureCodexSettingsV2, captureCodexSettingsV3, captureCodexSettingsV4 } from "../../lib/codex-settings-witness.js";
import { captureClaudeMarketplaceRegistryV2 } from "../../lib/claude-marketplace-registry.js";
import { captureCodexNativeSkillCatalog } from "../../lib/codex-native-skill-catalog.js";

const RECOVERABLE_CONTEXT_CACHE_ERRORS = new Set(["CACHED_PROFILE_EXPIRED", "CACHED_PROFILE_MISSING", "CACHED_BUNDLE_MISSING"]);

/** Called only after the configured native bridge has been verified. */
function pinnedHookProfile(input: unknown, configuredProfile: string): string {
  try {
    const parsed = parseSkillContextInput(JSON.stringify(input));
    if (!parsed.sessionId) return configuredProfile;
    // Match buildSkillContext's native identity and parent derivation exactly.
    const sessionId = parsed.agentId ? `${parsed.sessionId}:${parsed.agentId}` : parsed.sessionId;
    const session = readSkillSessionSnapshotIfExists(sessionId);
    const parentId = parsed.parentSessionId ?? (parsed.agentId ? parsed.sessionId : undefined);
    const parent = !session && parentId ? readSkillSessionSnapshotIfExists(parentId) : null;
    // This selects the profile, not the payload. The context subprocess rereads
    // and validates the receipt, project conflicts, authority and generation.
    // A named missing parent still fails in the ordinary context resolver.
    return session?.receipt.profile.profileId ?? parent?.receipt.profile.profileId ?? configuredProfile;
  } catch (error) {
    if (error instanceof SkillSelectionError) throw new HookDiagnosticError(error.code, "context");
    throw error;
  }
}

async function contextForHook(input: unknown, profileId: string, cached: boolean, deadline: number): Promise<any> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new HookDiagnosticError("SKILLS_HOOK_TIMEOUT", "context");
  const args = [process.execPath, process.argv[1]!, "context", "--stdin", "--json", "--selection-profile", profileId];
  if (cached) args.push("--cached", "--auto-reconcile-safe");
  const child = Bun.spawn(args, { stdin: new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, Math.min(6500, remaining));
  let result: any;
  let status: number;
  let output: string;
  try {
    const [stdout, , exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (timedOut) throw new HookDiagnosticError("SKILLS_HOOK_TIMEOUT", "context");
    status = exitCode;
    output = stdout;
  } finally { clearTimeout(timer); }
  if (status !== 0) {
    const failure = hookChildError(output, "context");
    // The cached context child may safely reconcile an expired session after
    // authenticated loaded-selection comparison. Missing cache still gets an
    // authenticated read; identity and integrity failures never use fallback.
    if (cached && RECOVERABLE_CONTEXT_CACHE_ERRORS.has(failure.code)) {
      return contextForHook(input, profileId, false, deadline);
    }
    throw failure;
  }
  try { result = JSON.parse(output); } catch { throw new HookDiagnosticError("SKILLS_HOOK_INVALID_RESPONSE", "context"); }
  if (typeof result?.context !== "string") throw new HookDiagnosticError("SKILLS_HOOK_INVALID_RESPONSE", "context");
  return result;
}

function agents(value: string): IntegrationAgent[] {
  if (value === "all") return [...INTEGRATION_AGENTS];
  if (INTEGRATION_AGENTS.includes(value as IntegrationAgent)) return [value as IntegrationAgent];
  throw new Error(`Supported agents: ${INTEGRATION_AGENTS.join(", ")}, all`);
}

export function registerAgentIntegration(parent: Command): void {
  const hook = parent.command("hook").description("Load selected Skills context through agent lifecycle hooks");
  hook.command("project-claude-settings")
    .requiredOption("--expected-target-sha256 <sha256>", "SHA-256 of the exact target settings bytes supplied on stdin")
    .option("--expected-source-sha256 <sha256>", "Source witness from the preceding projection, for revalidation")
    .option("--json", "Return only command-leaf replacements and content witnesses", false)
    .description("Read-only projection of verified Skills hooks into copied Claude settings supplied on stdin")
    .action(async (options: { expectedTargetSha256: string; expectedSourceSha256?: string }) => {
      try {
        const bytes = Buffer.alloc(1024 * 1024 + 1); let length = 0;
        while (length < bytes.length) {
          const count = readSync(0, bytes, length, bytes.length - length, null);
          if (!count) break; length += count;
        }
        if (length > 1024 * 1024) throw new Error("CLAUDE_MANAGED_HOOK_TARGET_INVALID");
        const targetSettings = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
        const plan = planClaudeManagedHookProjection({ targetSettings, expectedTargetSha256: options.expectedTargetSha256,
          expectedSourceSha256: options.expectedSourceSha256, projectDir: process.cwd() });
        await writeCliOutput(JSON.stringify(plan));
      } catch (error) {
        const code = error instanceof Error && /^CLAUDE_MANAGED_HOOK_[A-Z_]+$/.test(error.message)
          ? error.message : "CLAUDE_MANAGED_HOOK_PROJECTION_FAILED";
        console.error(code); process.exitCode = 1;
      }
    });
  hook.command("native-catalog")
    .requiredOption("--cwd <path>", "Absolute project directory observed by native Codex skills/list")
    .requiredOption("--output <file>", "New private file for the projected native catalog")
    .option("--codex-command <path>", "Installed Codex executable used by the native client", "codex")
    .option("--json", "Output bounded capture metadata as JSON", false)
    .description("Capture a reviewed Codex native skill catalog for exact hook enrollment")
    .action(async (options: { cwd: string; output: string; codexCommand: string; json: boolean }) => {
      try {
        if (!isAbsolute(options.cwd) || !isAbsolute(options.output)) throw new Error("CODEX_NATIVE_SKILL_CATALOG_ABSOLUTE_PATH_REQUIRED");
        if (existsSync(options.output)) throw new Error("CODEX_NATIVE_SKILL_CATALOG_OUTPUT_EXISTS");
        const catalog = await captureCodexNativeSkillCatalog({
          command: options.codexCommand, home: homedir(),
          ...(process.env.CODEX_HOME === undefined ? {} : { codexHome: process.env.CODEX_HOME }),
          cwd: options.cwd,
        });
        const bytes = JSON.stringify(catalog, null, 2) + "\n";
        try { writeFileSync(options.output, bytes, { flag: "wx", mode: 0o600 }); }
        catch (error) {
          if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") throw new Error("CODEX_NATIVE_SKILL_CATALOG_OUTPUT_EXISTS");
          throw error;
        }
        const written = lstatSync(options.output);
        if (!written.isFile() || written.isSymbolicLink() || (written.mode & 0o077) !== 0
          || readFileSync(options.output, "utf8") !== bytes) throw new Error("CODEX_NATIVE_SKILL_CATALOG_READBACK_FAILED");
        const receipt = { version: catalog.version, cwd: catalog.cwd, skillCount: catalog.skills.length,
          output: options.output, bytes: Buffer.byteLength(bytes), sha256: createHash("sha256").update(bytes).digest("hex") };
        await writeCliOutput(options.json ? JSON.stringify(receipt) : `Captured ${receipt.skillCount} native Codex skill(s) in ${receipt.output}.`);
      } catch (error) {
        const message = error instanceof Error && /^[A-Z][A-Z0-9_]{2,120}$/.test(error.message)
          ? error.message : "CODEX_NATIVE_SKILL_CATALOG_CAPTURE_FAILED";
        console.error(message);
        process.exitCode = 1;
      }
    });
  hook.command("witness")
    .requiredOption("--kind <kind>", "sumi-settings-v1, claude-settings-v3, claude-settings-v2, codex-settings-v4, codex-settings-v3, codex-settings-v2, codex-settings-v1 or claude-marketplace-registry-v2")
    .requiredOption("--path <path>", "Canonical absolute path to the reviewed settings or registry file")
    .option("--json", "Output the discovery witness as JSON", false)
    .description("Capture an explicit versioned review witness without installing it")
    .action(async (options: {kind: string; path: string}) => {
      const capture = options.kind === "sumi-settings-v1" ? captureSumiSettings : options.kind === "codex-settings-v4" ? captureCodexSettingsV4 : options.kind === "codex-settings-v3" ? captureCodexSettingsV3 : options.kind === "codex-settings-v2" ? captureCodexSettingsV2 : options.kind === "codex-settings-v1" ? captureCodexSettings : options.kind === "claude-settings-v3" ? captureClaudeSettingsV3
        : options.kind === "claude-settings-v2" ? captureClaudeSettingsV2
        : options.kind === "claude-marketplace-registry-v2" ? captureClaudeMarketplaceRegistryV2 : null;
      if (!capture) throw new Error("Unsupported witness kind; select sumi-settings-v1, claude-settings-v3, claude-settings-v2, codex-settings-v4, codex-settings-v3, codex-settings-v2, codex-settings-v1 or claude-marketplace-registry-v2");
      await writeCliOutput(JSON.stringify(capture(options.path), null, 2));
    });
  hook.command("rebind-settings")
    .requiredOption("--agent <agent>", "claude, codex or sumi")
    .requiredOption("--reviewed-preimage <path>", "Exact preserved legacy settings.json, config.toml or sumi.json")
    .requiredOption("--expected-policy-sha256 <sha256>", "Exact current managed policy bytes")
    .requiredOption("--expected-settings-sha256 <sha256>", "Exact current native settings bytes")
    .option("--codex-witness-version <version>", "Explicit target: 2 (legacy default) 3 (service tier and model-advertised effort), or 4 (native availability UI counts)")
    .option("--apply", "Apply the explicit semantic witness upgrade with preservation and readback", false)
    .option("--json", "Return the metadata-only plan or receipt", false)
    .description("Explicitly migrate a legacy native settings witness after proving only known preferences changed")
    .action(async (options) => {
      try {
        if (!["claude", "codex", "sumi"].includes(options.agent)) throw new Error("Settings witness rebind accepts claude, codex or sumi");
        if (options.codexWitnessVersion !== undefined && !["2", "3", "4"].includes(options.codexWitnessVersion)) throw new Error("Codex witness version accepts 2, 3 or 4");
        const plan = planAgentSettingsWitnessUpgrade({ ...(options.codexWitnessVersion !== undefined ? { targetCodexVersion: Number(options.codexWitnessVersion) as 2 | 3 | 4 } : {}), agent: options.agent, reviewedPreimage: options.reviewedPreimage, expectedPolicySha256: options.expectedPolicySha256, expectedSettingsSha256: options.expectedSettingsSha256 });
        const result = options.apply ? applyAgentIntegration(plan) : { changed: [], backups: [] };
        const receipt = { applied: options.apply, settingsWitnessUpgrade: plan.settingsWitnessUpgrade, ...result };
        await writeCliOutput(options.json ? JSON.stringify(receipt) : `Settings witness ${options.apply ? "upgraded" : "planned"} for ${options.agent}. Native configuration was not changed.`);
      } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
    });

  hook.command("trust-native")
    .requiredOption("--platform <platform>", "Native consumer platform key: darwin-arm64, darwin-x64, linux-arm64 or linux-x64")
    .requiredOption("--digest <sha256>", "SHA-256 of an independently verified final native Codex executable; repeat for several", (value: string, previous?: string[]) => [...(previous ?? []), value])
    .requiredOption("--expected-policy-sha256 <sha256>", "Exact current managed policy bytes")
    .option("--apply", "Write the trust with exact-bytes compare-and-swap, preservation and readback", false)
    .option("--json", "Return the preview or apply receipt as JSON", false)
    .description("Bind reviewed native Codex executable digests for one platform in the managed policy; other fields are preserved (values identical; the file is re-serialized with the package formatter); digests come only from these arguments, never from a fetch")
    .action(async (options) => {
      try {
        const plan = planCodexNativeTrust({ platform: options.platform, digests: options.digest, expectedPolicySha256: options.expectedPolicySha256 });
        const receipt = options.apply ? applyCodexNativeTrust(plan, options.expectedPolicySha256) : previewCodexNativeTrust(plan);
        if (options.json) await writeCliOutput(JSON.stringify(receipt));
        else await writeCliOutput(`${options.apply ? "Bound" : "Planned"} ${receipt.digestsAfter.length} reviewed native executable digest(s) for ${receipt.platform} (before: ${receipt.digestsBefore.length}). Policy SHA-256 ${receipt.policySha256Before} -> ${receipt.policySha256After}.${options.apply ? receipt.backup ? ` Original preserved at ${receipt.backup.path} and read back.` : " No bytes changed." : " Use --apply with the same --expected-policy-sha256 to write."}`);
      } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
    });

  hook.command("agents").option("--json", "Output the adapter capability inventory", false)
    .description("Show maintained native adapters and explicit coverage limits")
    .action(async () => { await writeCliOutput(JSON.stringify({ agents: INTEGRATION_AGENTS.map(agent => ({ agent, bridge: true, ...AGENT_ADAPTERS[agent] })), inventoryOnly: ["codewith", "windsurf", "pi", "amp", "cline", "roo", "copilot"], limitations: ["Cursor prompt hooks gate submission; selected context is injected at session start only.", "Native discovery checks cover known home roots and current project ancestors. External plugin hook injection and arbitrary added directories require separate review.", "Hermes injects selected prompt context, but native pre_llm_call fails open. Exact native hook trust, bundled reseeding opt-out, native payload retirement and a supervised pre-tool guard are required. Child failures block explicitly; native host/supervisor death is not a universal fail-closed guarantee.", "Restart agents and use their normal hook trust controls after installation."] }, null, 2)); });
  hook.command("install")
    .option("--agent <agent>", `Agent to configure: ${INTEGRATION_AGENTS.join(", ")}, all`, "all")
    .option("--command <path>", "Skills executable used by the hook (preserves existing binding; new agents use skills)")
    .option("--selection-profile <id>", "Selection profile (preserves existing binding; new agents use default)")
    .option("--include-vendor", "Retained for compatibility; vendor system skills are always inventoried and disabled", false)
    .option("--discovery-inputs <file>", "Advanced reviewed active plugin roots and source hashes for unsupported registrations")
    .option("--codex-skill-denials <file>", "Explicit reviewed remote skill denials: array of exact name, path and document sha256; requires fresh catalog and discovery inputs")
    .option("--codex-native-catalog <file>", "Reviewed supported Codex skill and installed-plugin receipt for exact qualified-name disables")
    .option("--reviewed-cache-alias <path>", "Exact skill-containing vendor cache alias reviewed for this hook plan")
    .option("--allow-root-aliases", "Allow home .claude/.codex aliases to existing directories within this home", false)
    .option("--apply", "Apply the plan, preserving prior configuration in private backups", false)
    .option("--json", "Output a receipt as JSON", false)
    .description("Plan or install one Skills CLI bridge plus native prompt hooks")
    .action(async (options) => {
      try {
        const discoveryInputs: ReviewedDiscoveryInputs | undefined = options.discoveryInputs ? JSON.parse(readFileSync(options.discoveryInputs, "utf8")) : undefined;
        const plan = planAgentIntegration({ projectDir: process.cwd(), agents: agents(options.agent), command: options.command, profileId: options.selectionProfile, includeVendor: options.includeVendor, discoveryInputs, allowRootAliases: options.allowRootAliases, reviewedCacheAlias: options.reviewedCacheAlias, codexSkillDenials: options.codexSkillDenials ? JSON.parse(readFileSync(options.codexSkillDenials,"utf8")) : undefined, codexNativeCatalog: options.codexNativeCatalog ? JSON.parse(readFileSync(options.codexNativeCatalog, "utf8")) : undefined });
        const result = options.apply ? applyAgentIntegration(plan) : { changed: [], backups: [] };
        // Configuration contents can include credentials. Only paths/counts leave this command.
        const receipt = { codexPluginSkillReview: plan.codexPluginSkillReview, codexPluginSkills: plan.changes.filter(change=>change.path.endsWith("agent-policy.json")).map(change=>JSON.parse(change.after).bridge?.codexPluginSkills ?? []).flat(), applied: options.apply, planned: plan.changes.map(change => change.path), ...result, rootAliases: plan.rootAliases ?? [], discovery: plan.discoveryAfter, nativeSkills: plan.nativeSkills.map(entry => ({ agent: entry.agent, path: entry.path, managed: entry.managed, vendor: entry.vendor, system: entry.system === true, bridge: entry.bridge === true })), requiresNativeRetirement: plan.nativeSkills.some(entry => !entry.bridge && !entry.system) };
        if (options.json) await writeCliOutput(JSON.stringify(receipt));
        else await writeCliOutput(`${options.apply ? "Configured" : "Planned"} ${plan.changes.length} agent configuration change(s).${options.apply ? " Restart the agent and trust the installed hook configuration." : " Use --apply to install."}`);
      } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
    });

  const trust = hook.command("trust")
    .option("--agent <agent>", "Native trust adapter (codex)")
    .option("--codex-command <path>", "Installed Codex executable used for its native configuration API", "codex")
    .option("--apply", "Enable and trust only the exact managed Skills hook identities", false)
    .option("--plan-digest <sha256>", "Exact reviewed dry-run digest required with --apply")
    .option("--json", "Output the native trust plan or receipt", false)
    .description("Plan or enroll exact Skills hooks through Codex native trust controls")
    .action(async (options) => {
      try {
        if (!options.agent) throw new Error("Native trust enrollment requires --agent codex");
        if (options.agent !== "codex") throw new Error("Native trust enrollment currently supports --agent codex only");
        const result = await enrollCodexNativeHooks({ codexCommand: options.codexCommand, codexHome: process.env.CODEX_HOME, apply: options.apply, reviewedPlanDigest: options.planDigest });
        if (options.json) await writeCliOutput(JSON.stringify(result));
        else await writeCliOutput(result.applied
          ? result.bindingRefreshRequired
            ? `Enrolled ${result.planned.length} native Skills hook trust state(s). Managed context remains blocked: review the current configuration and run skills hook install with fresh --discovery-inputs and the same --command. Policy was not changed. Existing sessions were not reloaded.`
            : `Enrolled ${result.planned.length} Skills hook(s) for new Codex processes. Existing sessions were not reloaded; use their native hook controls.`
          : result.planned.length ? `Planned ${result.planned.length} native hook trust change(s). Review the --json plan, then use --apply --plan-digest ${result.planDigest}.` : "The managed Skills hooks are enabled and trusted for new Codex processes. Existing session dispatch was not checked.");
      } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
    });
  trust.command("reconcile")
    .requiredOption("--agent <agent>", "Native trust adapter (codex)")
    .requiredOption("--journal <path>", "Private incomplete native trust journal to inspect")
    .option("--codex-command <path>", "Installed Codex executable used for its native configuration API", "codex")
    .option("--supersede-binding", "Resolve a stale journal only when current policy differs solely by the reviewed Codex CLI binding", false)
    .option("--review-claude-discovery <reason>", "Preview recovery for exact unrelated Claude discovery roots/sources; provide an authoritative evidence reference")
    .option("--review-native-hook-additions <path>", "Private review file binding exact later hook additions and the producer's preimage backups")
    .option("--recovery-plan-digest <sha256>", "Record recovery only for the exact reviewed discovery/additions preview")
    .option("--skills-package-tar <path>", "Exact package tarball consumed by the reviewed executable")
    .option("--skills-package-tar-sha256 <sha256>", "SHA-256 of the reviewed Skills package tarball")
    .option("--skills-package-tar-bytes <bytes>", "Byte length of the reviewed Skills package tarball")
    .option("--skills-package-manifest-sha256 <sha256>", "SHA-256 of the reviewed Skills package manifest")
    .option("--skills-executable-sha256 <sha256>", "SHA-256 of the reviewed running Skills executable")
    .option("--json", "Output the reconciliation receipt", false)
    .description("Verify an interrupted Codex native trust write and resolve its private journal")
    .action(async (options) => {
      try {
        if (options.agent !== "codex") throw new Error("Native trust reconciliation currently supports --agent codex only");
        if (options.recoveryPlanDigest !== undefined && options.reviewClaudeDiscovery === undefined && options.reviewNativeHookAdditions === undefined) throw new Error("--recovery-plan-digest requires --review-claude-discovery or --review-native-hook-additions");
        const proofFields = [options.skillsPackageTar, options.skillsPackageTarSha256, options.skillsPackageTarBytes, options.skillsPackageManifestSha256, options.skillsExecutableSha256];
        if (proofFields.some(value => value !== undefined) && proofFields.some(value => value === undefined)) throw new Error("Release provenance requires package tar path, tar hash/bytes, manifest hash, and executable hash together");
        const releaseProof = proofFields.every(value => value !== undefined) ? { packageTarPath: options.skillsPackageTar, packageTarSha256: options.skillsPackageTarSha256, packageTarBytes: Number(options.skillsPackageTarBytes), manifestSha256: options.skillsPackageManifestSha256, executableSha256: options.skillsExecutableSha256 } : undefined;
        const claudeDiscoveryRecovery = options.reviewClaudeDiscovery === undefined ? undefined : { reason: options.reviewClaudeDiscovery, reviewedPlanDigest: options.recoveryPlanDigest };
        const nativeHookAdditionsRecovery = options.reviewNativeHookAdditions === undefined ? undefined : { path: options.reviewNativeHookAdditions, reviewedPlanDigest: options.recoveryPlanDigest };
        const result = await reconcileCodexNativeHooks({ journal: options.journal, codexCommand: options.codexCommand, supersedeBinding: options.supersedeBinding, releaseProof, claudeDiscoveryRecovery, nativeHookAdditionsRecovery });
        if (options.json) await writeCliOutput(JSON.stringify(result));
        else await writeCliOutput(result.reconciled
          ? result.bindingRefreshRequired
            ? `Reconciled native Codex trust journal ${result.journal}. Managed context remains blocked: install the reviewed binding with fresh --discovery-inputs before using ordinary hooks. Policy was not changed. No native configuration was written.`
            : `Reconciled native Codex trust journal ${result.journal}. No native configuration was written.`
          : `Recovery remains pending. Review the private --json plan, then repeat with --recovery-plan-digest ${result.recoveryPlanDigest}.`);
      } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
    });

  hook.command("user-prompt")
    .requiredOption("--agent <agent>", `Native payload/output adapter: ${INTEGRATION_AGENTS.join(", ")}`)
    .option("--event <event>", "Native lifecycle event supplied by the installed adapter")
    .option("--selection-profile <id>", "Selection profile to load")
    .description("Read native lifecycle JSON on stdin and return selected context")
    .action(async (options) => {
      const deadline = Date.now() + 12_000;
      // The installed blocking event must survive malformed JSON/input too.
      let event = options.agent === "hermes" && options.event === "pre_tool_call" ? "pre_tool_call" : "UserPromptSubmit";
      let selectionProfile: string | undefined;
      let verifiedContextBoundary = false;
      let nativeEvent = event;
      try {
        if (agents(options.agent).length !== 1) throw new Error("A hook invocation requires one agent");
        // Keep the exact raw stdin bytes: the native policy adapter hashes them
        // before any decoding, and the input is parsed from those same bytes.
        const inputBytes = readFileSync(0), inputText = inputBytes.toString("utf8");
        if (inputText.length > 1024 * 1024) throw new Error("Hook input is too large");
        let input = JSON.parse(inputText);
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected hook input object");
        nativeEvent = options.event ?? input.hook_event_name ?? event;
        if (options.agent === "hermes") input = normalizeHermesHookInput({ ...input, hook_event_name: nativeEvent });
        event = options.agent === "hermes" ? input.hook_event_name : normalizeAgentHookEvent(options.agent, nativeEvent);
        input.hook_event_name = event;
        const projects: string[] = [process.cwd()];
        if (input.cwd !== undefined) {
          if (typeof input.cwd !== "string" || !isAbsolute(input.cwd) || input.cwd.includes("\0")) throw new Error("Invalid native hook working directory");
          projects.push(input.cwd);
        }
        if (options.agent === "cursor") {
          if (!Array.isArray(input.workspace_roots) || input.workspace_roots.length > 32 || input.workspace_roots.some((path: unknown) => typeof path !== "string" || !isAbsolute(path) || path.includes("\0"))) throw new Error("Invalid Cursor workspace roots");
          projects.push(...input.workspace_roots);
          input.cwd ??= input.workspace_roots[0] ?? process.cwd();
          input.session_id ??= input.conversation_id;
        }
        selectionProfile = selectedProfileId(options.selectionProfile);
        if (options.agent === "hermes" && event === "pre_tool_call") {
          assertManagedAgentBridge("hermes", { projectDirs: projects, profileId: selectionProfile });
          assertHermesTool(input);
          await writeCliOutput(JSON.stringify({ action: "continue" }));
          return;
        }
        if ((options.agent === "claude" && event === "PreToolUse") || (options.agent === "gemini" && event === "BeforeTool")) {
          assertManagedAgentBridge(options.agent, { projectDirs: projects, profileId: selectionProfile });
          const skill = options.agent === "claude" ? input.tool_input?.skill : input.tool_input?.name;
          if (skill !== "skills-cli") throw new Error("NATIVE_SKILL_DRIFT: invoke only skills-cli; load selected payload instructions with skills load");
          await writeCliOutput(JSON.stringify(options.agent === "claude" ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "Verified Skills CLI bridge" } } : {}));
          return;
        }
        // Validate event before starting the context operation.
        hookContextOutput(event, { context: "" });
        // A patched Codex reports its effective native skill policy on these two
        // events. Hand the exact native fields and the stdin digest to the guard's
        // adapter; every other agent, event and guard call keeps today's behaviour.
        const codexNativePolicy = options.agent === "codex" ? codexNativeHookEnvelopeFromInput(input, event, inputBytes, process.env[CODEX_NATIVE_POLICY_FD_ENV]) : undefined;
        assertManagedAgentBridge(options.agent, { projectDirs: projects, profileId: selectionProfile, ...(codexNativePolicy ? { codexNativePolicy: { ...codexNativePolicy, deadlineMs: deadline } } : {}) });
        if (typeof input.prompt === "string") input.prompt = normalizeAgentHookPrompt(options.agent, nativeEvent, input.prompt);
        // Validate every context field before a timeout or API refusal can be
        // classified as optional delivery failure. No unchecked input continues.
        parseSkillContextInput(JSON.stringify(input));
        verifiedContextBoundary = true;
        if (event === "SessionStart") {
          // Station reporting is telemetry, not profile authorization. Keep
          // it on explicit sync, outside the blocking lifecycle path. Reserve
          // two seconds of the existing total budget for verified context.
          const remaining = deadline - Date.now() - 2_000;
          if (remaining <= 0) throw new HookDiagnosticError("SKILLS_HOOK_TIMEOUT", "sync");
          const refresh = Bun.spawn([process.execPath, process.argv[1]!, "sync", "--selection-profile", selectionProfile, "--no-station-report", "--json"], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
          let timedOut = false;
          const timer = setTimeout(() => { timedOut = true; refresh.kill("SIGKILL"); }, remaining);
          try {
            const [stdout, , status] = await Promise.all([new Response(refresh.stdout).text(), new Response(refresh.stderr).text(), refresh.exited]);
            if (timedOut) throw new HookDiagnosticError("SKILLS_HOOK_TIMEOUT", "sync");
            if (status !== 0) throw hookChildError(stdout, "sync");
          } finally { clearTimeout(timer); }
        }
        // Existing sessions retain their profile when the managed default changes.
        // SessionStart refresh and the bridge guard above still use the configured
        // profile; explicit context CLI requests keep their strict mismatch rules.
        selectionProfile = pinnedHookProfile(input, selectionProfile);
        // An expired snapshot may advance only when all loaded selections are unchanged.
        const result = await contextForHook(input, selectionProfile, true, deadline);
        const output = hookContextOutput(event, result) as { hookSpecificOutput?: { hookEventName: string; additionalContext: string } };
        if (options.agent === "hermes") {
          await writeCliOutput(JSON.stringify({ context: output.hookSpecificOutput?.additionalContext ?? "" }));
        } else if (options.agent === "cursor") {
          await writeCliOutput(JSON.stringify(event === "SessionStart" ? { additional_context: output.hookSpecificOutput?.additionalContext ?? "" } : { continue: true }));
        } else {
          if (options.agent === "gemini" && output.hookSpecificOutput) output.hookSpecificOutput.hookEventName = nativeEvent;
          await writeCliOutput(JSON.stringify(output));
        }
      } catch (error) {
        if (verifiedContextBoundary && isOptionalHookContextFailure(error)) {
          const unavailable = hookUnavailableContext(error, selectionProfile);
          // These envelopes contain a fixed diagnostic only, never a child
          // payload or a receipt. Native skill tool checks are outside this path.
          if (options.agent === "cursor") await writeCliOutput(JSON.stringify({ continue: true, user_message: unavailable }));
          else if (options.agent === "hermes") await writeCliOutput(JSON.stringify({ context: unavailable }));
          else {
            const output = hookContextOutput(event, { context: unavailable }) as any;
            if (options.agent === "gemini" && output.hookSpecificOutput) output.hookSpecificOutput.hookEventName = nativeEvent ?? event;
            await writeCliOutput(JSON.stringify({ systemMessage: unavailable, ...output }));
          }
          return;
        }
        const reason = error instanceof Error && error.message.startsWith("NATIVE_SKILL_DRIFT:")
          ? error.message
          : hookFailureReason(error, selectionProfile);
        if (options.agent === "hermes") {
          // pre_llm_call is non-blocking in Hermes. Make the refusal visible;
          // pre_tool_call has native fail_closed and uses the blocking shape.
          await writeCliOutput(JSON.stringify(event === "pre_tool_call" ? { action: "block", message: reason } : { context: `Required Skills context is unavailable. ${reason} Do not substitute native skill payloads; stop and repair the bridge before task actions.` }));
        } else if (options.agent === "claude" && event === "PreToolUse") await writeCliOutput(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
        else if (options.agent === "cursor") await writeCliOutput(JSON.stringify({ continue: false, user_message: reason }));
        else if (options.agent === "gemini") await writeCliOutput(JSON.stringify({ decision: "deny", continue: false, reason }));
        else if (event === "UserPromptSubmit") await writeCliOutput(JSON.stringify({ decision: "block", reason }));
        else if (event === "SessionStart") await writeCliOutput(JSON.stringify({ continue: false, stopReason: reason, systemMessage: reason }));
        else await writeCliOutput(JSON.stringify({ systemMessage: reason, hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: "Required Skills context was unavailable. Report this to the parent before performing task actions." } }));
      }
    });

  const migrate = parent.command("migrate").description("Preserve and retire native agent skill copies");
  migrate.command("native")
    .option("--agent <agent>", "Limit inventory and migration to one maintained agent")
    .option("--project <directory>", "Also inventory a project and its ancestors (the current directory and its ancestors are always included)")
    .option("--include-unmanaged", "Archive user-authored skills as well as Skills-managed copies", false)
    .option("--include-vendor", "Retire vendor SKILL.md discovery files while preserving plugin scripts and assets", false)
    .option("--reviewed-cache-alias <path>", "Exact skill-containing vendor cache alias reviewed for migration; runtime hooks still refuse it")
    .option("--target-manifest <file>", "Reviewed exact native migration target manifest")
    .option("--discovery-inputs <file>", "Advanced reviewed active plugin roots and source hashes")
    .option("--allow-root-aliases", "Allow home .claude/.codex aliases to existing directories within this home", false)
    .option("--apply", "Move selected skills to private archives outside agent discovery roots", false)
    .option("--json", "Output inventory and archive receipt as JSON", false)
    .description("Inventory native skill copies; preserve complete directories before retiring them")
    .action(async (options) => {
      try {
        if (options.agent && !INTEGRATION_AGENTS.includes(options.agent as IntegrationAgent)) throw new Error(`Unsupported migration agent: ${options.agent}`);
        const discoveryInputs: ReviewedDiscoveryInputs | undefined = options.discoveryInputs ? JSON.parse(readFileSync(options.discoveryInputs, "utf8")) : undefined;
        if (options.targetManifest && (options.includeUnmanaged || options.includeVendor)) throw new Error("--target-manifest cannot be combined with broad native migration selectors");
        const targetManifest = options.targetManifest ? readNativeMigrationTargetManifest(options.targetManifest) : undefined;
        if (options.apply && options.reviewedCacheAlias && !targetManifest) throw new Error("Applying a reviewed cache alias requires an exact --target-manifest");
        const includeVendor = options.includeVendor || Boolean(targetManifest?.targets.some(target => target.vendor));
        const inventory = inventoryNativeSkills(undefined, { projectDirs: [process.cwd(), ...(options.project ? [options.project] : [])], agents: options.agent ? [options.agent as IntegrationAgent] : undefined, includeVendor, configured: includeVendor, discoveryInputs, allowRootAliases: options.allowRootAliases, reviewedCacheAlias: options.reviewedCacheAlias });
        if (targetManifest) selectNativeMigrationTargets(inventory, targetManifest);
        const result = options.apply ? archiveNativeSkills(inventory, { includeUnmanaged: options.includeUnmanaged, includeVendor: options.includeVendor, allowRootAliases: options.allowRootAliases, targetManifest }) : { entries: [], ...(targetManifest ? { targetManifest: { schema: targetManifest.schema, digest: targetManifest.digest, targetCount: targetManifest.targets.length } } : {}) };
        if (options.json) await writeCliOutput(JSON.stringify({ applied: options.apply, inventory, ...result }));
        else await writeCliOutput(`${inventory.length} native skill(s) found; ${result.entries.length} archived with recovery receipts.${options.apply ? "" : " Use --apply to archive managed copies."}`);
      } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
    });
}
