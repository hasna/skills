import { writeCliOutput } from "../output.js";
import type { Command } from "commander";
import { readSync } from "node:fs";
import { configuredSkillsApiUrl, normalizeSkillsApiOrigin, skillsApiRequestUrl } from "../../lib/fleet-credentials.js";
import { buildSkillContext, type SkillContextInput } from "../../lib/skill-context.js";
import { loadSelectedSkill, type SelectionResolverOptions } from "../../lib/selection-resolver.js";
import { inspectSessionWriteLock, recoverSessionWriteLock, SkillSelectionError } from "../../lib/selection-cache.js";
import { readManagedSkillPolicy } from "../../lib/managed-policy.js";
import { inspectSkillSession, reconcileSkillSession, reconcileSkillSessionIfSafe, type SessionReconciliationInput } from "../../lib/session-reconciliation.js";

export function selectedProfileId(explicit?: string): string {
  return explicit ?? process.env.HASNA_SKILLS_SELECTION_PROFILE ?? readManagedSkillPolicy()?.profileId ?? "default";
}
export interface ContextCommandOptions { selectionProfile?: string; cached?: boolean; autoReconcileSafe?: boolean; json?: boolean; stdin?: boolean; session?: string; restore?: boolean; maxChars?: string; maxSkills?: string; file?: string }
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
        const result = inspectSkillSession(id);
        await writeCliOutput(options.json ? JSON.stringify(result) : `${JSON.stringify(id)}: ${result.profileId} at ${result.profileRevision}\nReceipt SHA256: ${result.receiptSha256}`);
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
          : `Planned one session reconciliation. Review --json output, then use --apply --plan-digest ${result.planDigest} --plan-issued-at ${result.plan.issuedAt} --plan-expires-at ${result.plan.expiresAt}.`);
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
    .option("--auto-reconcile-safe", "For managed hooks, archive and renew an expired session only when all loaded selections are unchanged", false)
    .option("--session <id>", "Keep the same skill versions across this session")
    .option("--restore", "Re-emit loaded session context after compaction or resume", false)
    .option("--max-chars <count>", "Maximum injected characters", "8000")
    .option("--max-skills <count>", "Maximum loaded skills", "3")
    .option("--json", "Return context and selection receipts as JSON", false)
    .action(async (prompt: string | undefined, options: ContextCommandOptions) => {
      try {
        if (options.autoReconcileSafe && !options.cached) throw new SkillSelectionError("INVALID_CONTEXT_INPUT", "--auto-reconcile-safe requires --cached.");
        const input = options.stdin ? parseSkillContextInput(await readContextStdin()) : { prompt: prompt ?? "" };
        input.profileId = selectedProfileId(options.selectionProfile ?? input.profileId);
        input.cwd ??= process.cwd();
        input.sessionId = options.session ?? input.sessionId;
        input.restore ||= options.restore;
        const resolverOptions = { ...contextResolverOptions(options), maxChars: Number(options.maxChars), maxSkills: Number(options.maxSkills) };
        let result;
        try { result = await buildSkillContext(input, resolverOptions); }
        catch (error) {
          if (!options.cached || !options.autoReconcileSafe || !(error instanceof SkillSelectionError)
              || error.code !== "CACHED_PROFILE_EXPIRED" || !input.sessionId) throw error;
          const sessionId = input.agentId ? `${input.sessionId}:${input.agentId}` : input.sessionId;
          if (!await reconcileSkillSessionIfSafe(sessionId, input.profileId!, resolverOptions)) throw error;
          result = await buildSkillContext(input, resolverOptions);
        }
        await writeCliOutput(options.json ? JSON.stringify(result) : result.context);
      } catch (error) { reportContextError(error, options.json); }
    });
}
export function reportContextError(error: unknown, json = false): void {
  const storageFull = error instanceof Error && ["ENOSPC", "EDQUOT"].includes((error as NodeJS.ErrnoException).code ?? "");
  const code = error instanceof SkillSelectionError ? error.code : storageFull ? "SKILLS_STORAGE_FULL" : "SKILLS_CONTEXT_FAILED";
  // Foreign response bodies and credentials must not reach hook output through an Error string.
  const message = error instanceof SkillSelectionError ? error.message : storageFull
    ? "Skills could not save verified local state because the filesystem is full or its quota is exhausted. Free space through your approved recoverable cleanup process, then retry the same session."
    : "Skills context could not be loaded. Check authentication and the selected profile.";
  if (json) console.log(JSON.stringify({ error: { code, message } }));
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
  return {
    prompt: string("prompt"), cwd: string("cwd"), sessionId: string("sessionId", "session_id"),
    agentId: string("agentId", "agent_id"), profileId: string("profileId", "profile_id"),
    skills: strings("skills"), paths: strings("paths"),
    restore: value.restore === true || (event === "SessionStart" && ["compact", "resume"].includes(source ?? "")),
  };
}
