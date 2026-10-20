import { writeCliOutput } from "../output.js";
import type { Command } from "commander";
import { readSync } from "node:fs";
import { configuredSkillsApiUrl, normalizeSkillsApiOrigin, skillsApiRequestUrl } from "../../lib/fleet-credentials.js";
import { buildSkillContext, type SkillContextInput } from "../../lib/skill-context.js";
import { loadSelectedSkill, type ResolvedSelectionContext, type SelectionResolverOptions } from "../../lib/selection-resolver.js";
import { inspectSessionWriteLock, readSkillSessionSnapshotIfExists, recoverSessionWriteLock, SkillSelectionError, type SkillSessionReceipt } from "../../lib/selection-cache.js";
import { readManagedSkillPolicy } from "../../lib/managed-policy.js";
import { inspectSkillSession, reconcileSkillSession, renewSkillSessionPin, SessionPinMigrationTimeout, type SessionPinMigration, type SessionReconciliationInput, type SessionSelectionMetadata } from "../../lib/session-reconciliation.js";
import { awaitBackgroundRenewal, BACKGROUND_RENEWAL_WAIT_MS, backgroundRenewalError, readBackgroundRenewalState, renewalModeFor, runBackgroundRenewal, SessionRenewalInBackground, startBackgroundRenewal } from "../../lib/session-background-renewal.js";

function sessionSelectionLabel(selection: SessionSelectionMetadata): string {
  return `${selection.slug}@${selection.version} ${selection.bundleDigest}`;
}

export function selectedProfileId(explicit?: string): string {
  return explicit ?? process.env.HASNA_SKILLS_SELECTION_PROFILE ?? readManagedSkillPolicy()?.profileId ?? "default";
}
export interface ContextCommandOptions { selectionProfile?: string; cached?: boolean; autoReconcileSafe?: boolean; autoMigrateSessionPin?: boolean; backgroundRenewal?: boolean; renewalBudgetMs?: string; json?: boolean; stdin?: boolean; session?: string; restore?: boolean; maxChars?: string; maxSkills?: string; file?: string }
export function contextResolverOptions(options: ContextCommandOptions): SelectionResolverOptions {
  if (!options.cached) return {};
  const configured = configuredSkillsApiUrl();
  if (!configured) throw new SkillSelectionError("CACHED_AUTHORITY_REQUIRED", "Cached reads require a configured Skills authority; set up the authority before using --cached.");
  const authority = skillsApiRequestUrl(normalizeSkillsApiOrigin(configured.value), "/api/v1/").replace(/\/$/, "");
  return { cached: true, authority };
}
export function registerContextCommands(parent: Command): void {
  const sessions = parent.command("sessions").description("Inspect exact session pins and explicitly reconcile one reviewed receipt");
  sessions.command("show <id>")
    .option("--json", "Return metadata as JSON", false)
    .description("Inspect one session receipt without displaying payloads or changing its pin")
    .action(async (id: string, options: { json?: boolean }) => {
      try {
        // The last background renewal attempt is reported as metadata only.
        const state = readBackgroundRenewalState(id);
        const backgroundRenewal = state ? { status: state.status, mode: state.mode, pinVerifiedAt: state.pinVerifiedAt, startedAt: state.startedAt,
          ...(state.finishedAt ? { finishedAt: state.finishedAt } : {}), ...(state.code ? { code: state.code } : {}) } : undefined;
        const result = { ...inspectSkillSession(id), ...(backgroundRenewal ? { backgroundRenewal } : {}) };
        await writeCliOutput(options.json ? JSON.stringify(result) : [
          `${JSON.stringify(id)}: ${result.profileId} at ${result.profileRevision}`, `Receipt SHA256: ${result.receiptSha256}`,
          ...(backgroundRenewal ? [`Background renewal (${backgroundRenewal.mode}): ${backgroundRenewal.status}${backgroundRenewal.code ? ` with ${backgroundRenewal.code}` : ""}, started ${backgroundRenewal.startedAt}${backgroundRenewal.finishedAt ? `, finished ${backgroundRenewal.finishedAt}` : ""}`] : []),
          ...result.selections.map(selection => `${selection.loaded ? "Loaded" : "Unloaded"}: ${sessionSelectionLabel(selection)}`),
        ].join("\n"));
      } catch (error) { reportContextError(error, options.json); }
    });
  sessions.command("recover-lock <id>")
    .option("--apply", "Archive the exact reviewed stale lock", false)
    .option("--review-digest <sha256>", "Exact digest returned by the lock review; required with --apply")
    .option("--confirm-local-host", "Confirm this PID-only legacy lock was created on this host", false)
    .option("--json", "Return lock metadata or recovery result as JSON", false)
    .description("Review a stale session write lock, then archive it without changing the receipt")
    .action(async (id: string, options: { apply?: boolean; reviewDigest?: string; confirmLocalHost?: boolean; json?: boolean }) => {
      try {
        if (!options.apply) {
          const result = inspectSessionWriteLock(id);
          await writeCliOutput(options.json ? JSON.stringify(result)
            : `Lock for ${JSON.stringify(id)}: PID ${result.pid}, schema ${result.schemaVersion}, modified ${result.lockMtime}.\nReceipt SHA256: ${result.receiptSha256}\nReview digest: ${result.reviewDigest}`);
          return;
        }
        if (!options.reviewDigest || !/^[a-f0-9]{64}$/.test(options.reviewDigest) || !options.confirmLocalHost) {
          throw new SkillSelectionError("SESSION_LOCK_REVIEW_REQUIRED", "Apply requires the exact review digest and --confirm-local-host after verifying this lock belongs to this host.");
        }
        const archivePath = recoverSessionWriteLock(id, options.reviewDigest);
        await writeCliOutput(options.json ? JSON.stringify({ sessionId: id, recovered: true, archivePath })
          : `Archived the stale lock at ${archivePath}. The session receipt was not changed.`);
      } catch (error) { reportContextError(error, options.json); }
    });
  // Started detached by managed hooks only; it acts only for the exact lock
  // operation that started it, so a stray invocation does nothing.
  sessions.command("renew-background <id>", { hidden: true })
    .requiredOption("--selection-profile <id>", "The session's pinned selection profile")
    .requiredOption("--operation-id <uuid>", "The exact background renewal lock operation")
    .option("--migrate", "For an expired pin, migrate a refused renewal of the same profile (the managed hook's setting)", false)
    .option("--project-dir <dir>", "The prompt's directory; a project lock there keeps a refusal")
    .option("--json", "Return the outcome as JSON", false)
    .description("Renew one session pin in the background for a managed hook")
    .action(async (id: string, options: { selectionProfile: string; operationId: string; migrate?: boolean; projectDir?: string; json?: boolean }) => {
      try {
        const result = await runBackgroundRenewal(id, options.selectionProfile, options.operationId, { migrate: options.migrate === true, projectDir: options.projectDir });
        await writeCliOutput(options.json ? JSON.stringify(result) : `Background renewal ${result.status}${result.code ? ` (${result.code})` : ""}.`);
        if (result.status === "failed") process.exitCode = 1;
      } catch (error) { reportContextError(error, options.json); }
    });
  sessions.command("reconcile <id>")
    .requiredOption("--from-profile <id>", "Expected current session profile")
    .requiredOption("--from-revision <revision>", "Expected current session profile revision")
    .requiredOption("--receipt-sha256 <sha256>", "Expected exact current receipt bytes")
    .requiredOption("--selection-profile <id>", "Intended target selection profile")
    .requiredOption("--profile-revision <revision>", "Expected current API target revision")
    .option("--apply", "Archive the old receipt and atomically apply the reviewed plan", false)
    .option("--plan-digest <sha256>", "Exact reviewed plan digest; required with --apply")
    .option("--plan-issued-at <timestamp>", "Exact reviewed plan issuedAt; required with --apply")
    .option("--plan-expires-at <timestamp>", "Exact reviewed plan expiresAt; required with --apply")
    .option("--json", "Return the plan or application receipt as JSON", false)
    .description("Plan an intentional migration of one session pin when loaded selections changed")
    .action(async (id: string, options: Omit<SessionReconciliationInput, "sessionId"> & { json?: boolean }) => {
      try {
        const result = await reconcileSkillSession({ ...options, sessionId: id });
        await writeCliOutput(options.json ? JSON.stringify(result) : result.applied
          ? `Reconciled ${JSON.stringify(id)} to ${result.plan.target.profileId} at ${result.plan.target.profileRevision}.\nPreserved original receipt: ${result.archivePath}`
          : [
            `Planned one session reconciliation: ${result.plan.retainedLoadedCount} loaded retained, ${result.plan.retiredLoadedCount} loaded retired.`,
            ...result.plan.selectionDelta.map(row => `${row.outcome} (${row.reason}): ${sessionSelectionLabel(row.selection)}${row.replacement ? ` -> ${sessionSelectionLabel(row.replacement)}` : ""}`),
            ...result.plan.addedSelections.map(selection => `Added selection (unloaded): ${sessionSelectionLabel(selection)}`),
            `Review --json output, then use --apply --plan-digest ${result.planDigest} --plan-issued-at ${result.plan.issuedAt} --plan-expires-at ${result.plan.expiresAt}.`,
          ].join("\n"));
      } catch (error) { reportContextError(error, options.json); }
    });
  parent.command("load <skill>")
    .description("Load an exact API-selected skill and return its version/digest receipt")
    .option("--selection-profile <id>", "Selection profile (separate from the credential --profile)")
    .option("--cached", "Use only an explicitly selected verified cache, at most 24 hours old", false)
    .option("--session <id>", "Pin this load to a session")
    .option("--file <path>", "Read an exact bundle file (default: SKILL.md, README.md, then CLAUDE.md)")
    .option("--json", "Return content and provenance as JSON", false)
    .action(async (skill: string, options: ContextCommandOptions) => {
      try {
        const result = await loadSelectedSkill(skill, selectedProfileId(options.selectionProfile), {
          ...contextResolverOptions(options), projectDir: process.cwd(), sessionId: options.session, file: options.file,
        });
        await writeCliOutput(options.json ? JSON.stringify(result) : result.content);
      } catch (error) { reportContextError(error, options.json); }
    });
  parent.command("context [prompt]")
    .description("Select bounded, versioned skill context for this prompt without running skills")
    .option("--stdin", "Read native hook JSON or a prompt from stdin", false)
    .option("--selection-profile <id>", "Selection profile (separate from the credential --profile)")
    .option("--cached", "Use only an explicitly selected verified cache, at most 24 hours old", false)
    .option("--auto-reconcile-safe", "For managed hooks, renew authorized immutable session pins without adopting newer selected versions", false)
    .option("--auto-migrate-session-pin", "With --auto-reconcile-safe: when renewal is refused because the same profile moved on, migrate the pin to the current revision and retire changed or removed loaded skills; managed hooks name them once. A project lock at the input cwd keeps the refusal", false)
    .option("--renewal-budget-ms <ms>", "With --auto-reconcile-safe: milliseconds this command may spend before its session pin renewal must finish, counted from when the command starts; the renewal never exceeds its own budget either")
    .option("--background-renewal", "With --auto-reconcile-safe (managed hooks): renew session pins in a detached background worker, ahead of expiry for root sessions; an expired pin waits a few seconds for it and otherwise delivers no payload", false)
    .option("--session <id>", "Keep the same skill versions across this session")
    .option("--restore", "Re-emit loaded session context after compaction or resume", false)
    .option("--max-chars <count>", "Optional maximum injected characters")
    .option("--max-skills <count>", "Maximum loaded skills", "3")
    .option("--json", "Return context and selection receipts as JSON", false)
    .action(async (prompt: string | undefined, options: ContextCommandOptions) => {
      // A managed hook's budget counts from here, before the first context attempt.
      const started = performance.now();
      try {
        if (options.autoReconcileSafe && !options.cached) throw new SkillSelectionError("INVALID_CONTEXT_INPUT", "--auto-reconcile-safe requires --cached.");
        if (options.renewalBudgetMs !== undefined && !options.autoReconcileSafe) throw new SkillSelectionError("INVALID_CONTEXT_INPUT", "--renewal-budget-ms requires --auto-reconcile-safe.");
        if (options.renewalBudgetMs !== undefined && !/^\d{1,6}$/.test(options.renewalBudgetMs)) throw new SkillSelectionError("INVALID_CONTEXT_INPUT", "--renewal-budget-ms must be a whole number of milliseconds.");
        const renewalDeadline = options.renewalBudgetMs === undefined ? undefined : started + Number(options.renewalBudgetMs);
        if (options.autoMigrateSessionPin && !options.autoReconcileSafe) throw new SkillSelectionError("INVALID_CONTEXT_INPUT", "--auto-migrate-session-pin requires --auto-reconcile-safe.");
        if (options.backgroundRenewal && !options.autoReconcileSafe) throw new SkillSelectionError("INVALID_CONTEXT_INPUT", "--background-renewal requires --auto-reconcile-safe.");
        const input = options.stdin ? parseSkillContextInput(await readContextStdin()) : { prompt: prompt ?? "" };
        input.profileId = selectedProfileId(options.selectionProfile ?? input.profileId);
        input.cwd ??= process.cwd();
        input.sessionId = options.session ?? input.sessionId;
        input.restore ||= options.restore;
        let pinned: { receipt: SkillSessionReceipt; receiptSha256: string } | null = null;
        const resolverOptions = { ...contextResolverOptions(options), ...(options.maxChars === undefined ? {} : { maxChars: Number(options.maxChars) }), maxSkills: Number(options.maxSkills),
          ...(options.backgroundRenewal ? { onResolved: (resolved: ResolvedSelectionContext) => {
            pinned = resolved.session && resolved.sessionSnapshot ? { receipt: resolved.session, receiptSha256: resolved.sessionSnapshot.receiptSha256 } : null;
          } } : {}) };
        const sessionId = input.sessionId && (input.agentId ? `${input.sessionId}:${input.agentId}` : input.sessionId);
        let result: Awaited<ReturnType<typeof buildSkillContext>> & { sessionPinMigration?: SessionPinMigration };
        try { result = await buildSkillContext(input, resolverOptions); }
        catch (error) {
          if (!options.cached || !options.autoReconcileSafe || !(error instanceof SkillSelectionError)
              || error.code !== "CACHED_PROFILE_EXPIRED" || !sessionId) throw error;
          // The expired pin is this session's own or, for a child that has no
          // receipt yet, the parent pin it would inherit. With background
          // renewal the renewal runs in a detached worker; this prompt waits a
          // few seconds for it and never repeats it inline. Until it commits,
          // an expired pin delivers nothing. Only when no worker can be
          // started at all does the prompt renew inline, as before.
          const target = options.backgroundRenewal ? expiredSessionPin(sessionId, input) : null;
          if (options.backgroundRenewal && !target) throw error;
          const launch = target ? startBackgroundRenewal({ sessionId: target.sessionId, profileId: input.profileId!, pinVerifiedAt: target.verifiedAt, receiptSha256: target.receiptSha256,
            mode: "expired", migrate: options.autoMigrateSessionPin === true, projectDir: input.cwd }) : undefined;
          if (target && launch && !(launch.status === "failed" && launch.notStarted)) {
            if (launch.status === "failed") throw backgroundRenewalError(launch.state);
            const waitMs = Math.min(BACKGROUND_RENEWAL_WAIT_MS, renewalDeadline === undefined ? BACKGROUND_RENEWAL_WAIT_MS : Math.floor(renewalDeadline - performance.now()));
            const outcome = await awaitBackgroundRenewal(target.sessionId, target.verifiedAt, waitMs, {}, launch.operationId);
            if (outcome.status === "running") throw new SessionRenewalInBackground();
            if (outcome.status === "failed") throw backgroundRenewalError(outcome.state);
            result = await buildSkillContext(input, resolverOptions);
            if (outcome.status === "migrated" && outcome.state.migration && target.sessionId === sessionId) result = { ...result, sessionPinMigration: outcome.state.migration };
          } else {
            // Session creation reads the project lock at input.cwd; a lock there
            // keeps today's refusal instead of migrating past the project's pin.
            const renewal = await renewSkillSessionPin(sessionId, input.profileId!, { ...resolverOptions, migrate: options.autoMigrateSessionPin === true, projectDir: input.cwd,
              ...(renewalDeadline === undefined ? {} : { budgetMs: Math.floor(renewalDeadline - performance.now()) }) });
            if (renewal.outcome === "unchanged") throw error;
            result = await buildSkillContext(input, resolverOptions);
            if (renewal.outcome === "migrated") result = { ...result, sessionPinMigration: renewal.migration };
          }
        }
        // A root session's valid pin is renewed ahead of expiry in the
        // background; this prompt neither waits for it nor depends on it.
        const current = pinned as { receipt: SkillSessionReceipt; receiptSha256: string } | null;
        if (options.backgroundRenewal && sessionId && current && !current.receipt.parent && renewalModeFor(current.receipt.verifiedAt, Date.now()) === "ahead") {
          try { startBackgroundRenewal({ sessionId, profileId: current.receipt.profile.profileId, pinVerifiedAt: current.receipt.verifiedAt, receiptSha256: current.receiptSha256, mode: "ahead" }); }
          catch { /* best effort: the pin stays valid and expiry renews it */ }
        }
        await writeCliOutput(options.json ? JSON.stringify(result) : result.context);
      } catch (error) { reportContextError(error, options.json); }
    });
}
/**
 * The expired session pin a context request depends on: the session's own
 * receipt, or for a child without one the parent receipt it would inherit.
 * Null when neither exists (a project lock or the station profile expired).
 */
function expiredSessionPin(sessionId: string, input: { sessionId?: string; agentId?: string; parentSessionId?: string | null }): { sessionId: string; verifiedAt: string; receiptSha256: string } | null {
  const own = readSkillSessionSnapshotIfExists(sessionId);
  if (own) return { sessionId, verifiedAt: own.receipt.verifiedAt, receiptSha256: own.sha256 };
  const parentId = input.parentSessionId ?? (input.agentId ? input.sessionId : undefined);
  const parent = parentId ? readSkillSessionSnapshotIfExists(parentId) : null;
  return parent && parentId ? { sessionId: parentId, verifiedAt: parent.receipt.verifiedAt, receiptSha256: parent.sha256 } : null;
}
export function reportContextError(error: unknown, json = false): void {
  const storageFull = error instanceof Error && ["ENOSPC", "EDQUOT"].includes((error as NodeJS.ErrnoException).code ?? "");
  const code = error instanceof SkillSelectionError ? error.code : storageFull ? "SKILLS_STORAGE_FULL" : "SKILLS_CONTEXT_FAILED";
  // Foreign response bodies and credentials must not reach hook output through an Error string.
  const message = error instanceof SkillSelectionError ? error.message : storageFull
    ? "Skills could not save verified local state because the filesystem is full or its quota is exhausted. Free space through your approved recoverable cleanup process, then retry the same session."
    : "Skills context could not be loaded. Check authentication and the selected profile.";
  // Fixed markers, never free text, say why a refusal outlived its migration
  // and that a renewal continues in the background.
  const migration = error instanceof SessionPinMigrationTimeout ? error.migration : undefined;
  const renewal = error instanceof SessionRenewalInBackground ? error.renewal : undefined;
  if (json) console.log(JSON.stringify({ error: { code, message, ...(migration ? { migration } : {}), ...(renewal ? { renewal } : {}) } }));
  else console.error(message);
  process.exitCode = 1;
}
async function readContextStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  // Read the descriptor directly: Bun 1.3.14 can expose an already-ended stdin
  // stream after CLI initialization probes isTTY and awaits command imports.
  // The descriptor retains the piped hook bytes; a bounded loop avoids the
  // unbounded allocation of readFileSync(0).
  while (true) {
    const chunk = Buffer.allocUnsafe(8192);
    const count = readSync(0, chunk, 0, chunk.length, null);
    if (count === 0) break;
    size += count;
    if (size > 256 * 1024) throw new SkillSelectionError("CONTEXT_INPUT_TOO_LARGE", "The Skills hook input exceeds its size limit.");
    chunks.push(chunk.subarray(0, count));
  }
  return Buffer.concat(chunks).toString("utf8");
}
export function parseSkillContextInput(raw: string): SkillContextInput {
  if (raw.length > 256 * 1024) throw new SkillSelectionError("CONTEXT_INPUT_TOO_LARGE", "The Skills hook input exceeds its size limit.");
  if (!raw.trim().startsWith("{")) return { prompt: raw };
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
  } catch { throw new SkillSelectionError("INVALID_CONTEXT_INPUT", "The Skills hook input is not a JSON object."); }
  const string = (camel: string, snake?: string): string | undefined => {
    const entry = value[camel] ?? (snake ? value[snake] : undefined);
    if (entry === undefined) return undefined;
    if (typeof entry !== "string") throw new SkillSelectionError("INVALID_CONTEXT_INPUT", `The Skills hook field ${camel} must be a string.`);
    return entry;
  };
  const strings = (key: string): string[] | undefined => {
    const entry = value[key];
    if (entry === undefined) return undefined;
    if (!Array.isArray(entry) || !entry.every((item) => typeof item === "string")) throw new SkillSelectionError("INVALID_CONTEXT_INPUT", `The Skills hook field ${key} must be a string array.`);
    return entry;
  };
  const event = string("hookEventName", "hook_event_name");
  const source = string("source");
  const parent = Object.hasOwn(value, "parentSessionId") ? value.parentSessionId : value.parent_session_id;
  const hasParent = Object.hasOwn(value, "parentSessionId") || Object.hasOwn(value, "parent_session_id");
  if (hasParent && parent !== null && typeof parent !== "string") throw new SkillSelectionError("INVALID_CONTEXT_INPUT", "The Skills hook field parentSessionId must be a string or null.");
  const sessionId = string("sessionId", "session_id"), agentId = string("agentId", "agent_id");
  if (hasParent && (!sessionId || agentId !== undefined || parent === sessionId || typeof parent === "string" && !parent.trim())) throw new SkillSelectionError("INVALID_CONTEXT_INPUT", "Native session custody requires its own session id and a distinct parent, without a legacy agent id.");
  return {
    prompt: string("prompt"), cwd: string("cwd"), sessionId,
    agentId, profileId: string("profileId", "profile_id"),
    ...(hasParent ? { parentSessionId: parent as string | null } : {}),
    skills: strings("skills"), paths: strings("paths"),
    restore: value.restore === true || (event === "SessionStart" && ["compact", "resume"].includes(source ?? "")),
  };
}
