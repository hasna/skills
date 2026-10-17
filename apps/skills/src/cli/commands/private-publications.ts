import type { Command } from "commander";
import { resolve } from "node:path";
import { RemoteSkillsAuthClient } from "../../lib/remote-auth.js";
import { privatePublicationCustomerError, preparePrivatePublicationSession, preparePrivateSkillHistorySession } from "../../lib/private-publication-customer.js";
import { preparePrivatePublication, continuePrivatePublication, inspectPrivatePublication, type PrivatePublicationResult } from "../../lib/private-publication-recovery.js";
import { checkedPrivateSkillCreate, PrivatePublicationError, publicationUuid } from "../../lib/remote-private-publications.js";
import { promptCode, readCode } from "./customer-verification.js";

type VerificationOptions = { email: string; userId?: string; membershipId?: string; codeStdin?: boolean; json?: boolean; confirm?: boolean };
type Options = VerificationOptions & {
  recoveryDir: string; skillId?: string; expectedCurrentVersion?: string; expectEmpty?: boolean; idempotencyKey?: string; waitSeconds?: string };
function verifySessionOptions(options: VerificationOptions) {
  if ((options.userId === undefined) !== (options.membershipId === undefined)
    || (options.userId !== undefined && (!publicationUuid(options.userId) || !publicationUuid(options.membershipId))))
    throw new PrivatePublicationError("PUBLICATION_CONTEXT_REQUIRED", "Provide both observed --user-id and --membership-id UUIDs.");
  if (!options.codeStdin && (options.json || !process.stdin.isTTY || !process.stderr.isTTY))
    throw new PrivatePublicationError("PUBLICATION_CODE_REQUIRED", "Use --code-stdin with a fresh code for noninteractive private-skill commands.");
}
function verifyOptions(options: Options, action: string) {
  verifySessionOptions(options);
  if ((action === "publish" || action === "resume" || action === "cancel") && options.confirm !== true)
    throw new PrivatePublicationError("PUBLICATION_CONFIRM_REQUIRED", "Use --confirm to approve this publication action.");
  if (action === "publish" && (!publicationUuid(options.skillId) || Boolean(options.expectEmpty) === (options.expectedCurrentVersion !== undefined)
    || (options.expectedCurrentVersion !== undefined && !publicationUuid(options.expectedCurrentVersion))
    || (options.idempotencyKey !== undefined && !publicationUuid(options.idempotencyKey))))
    throw new PrivatePublicationError("INVALID_PUBLICATION_INPUT", "Provide --skill-id and exactly one of --expect-empty or --expected-current-version; optional --idempotency-key must be a UUID.");
  if (options.waitSeconds !== undefined && (!/^(?:0|[1-9]\d{0,2})$/.test(options.waitSeconds) || Number(options.waitSeconds) > 300))
    throw new PrivatePublicationError("INVALID_PUBLICATION_INPUT", "Use --wait-seconds from 0 to 300.");
}
function print(result: PrivatePublicationResult, json?: boolean) {
  if (json) console.log(JSON.stringify(result));
  else { console.log(`Publication: ${result.state}`); console.log(`Recovery: ${result.recoveryDirectory}`); console.log(result.nextAction); }
  // Pending is explicitly distinct from completed publication.
  if (!result.committed && !["cancelled", "expired"].includes(result.state)) process.exitCode = 2;
}
export function registerPrivatePublications(parent: Command) {
  const group = parent.command("publication").description("Create private skills, publish and reconcile source versions on a compatible hosted server; execution is separate");
  group.command("create").allowExcessArguments(false)
    .description("Create a private or team skill using fresh session verification (requires Pro)")
    .argument("<slug>", "Lowercase kebab-case skill slug")
    .requiredOption("--display-name <name>", "Skill display name")
    .option("--description <text>", "Skill description", "")
    .option("--visibility <visibility>", "private or team", "private")
    .requiredOption("--email <email>", "Account email for fresh interactive verification")
    .option("--user-id <uuid>", "Observed account UUID (required without an enrolled named profile)")
    .option("--membership-id <uuid>", "Observed workspace membership UUID")
    .option("--code-stdin", "Read a fresh six-digit verification code from stdin")
    .option("--confirm", "Explicitly approve skill creation")
    .option("--json", "Output validated skill identifiers without credentials or server free text")
    .action(async (slug: string, options: VerificationOptions & { displayName: string; description: string; visibility: string }) => {
      try {
        const body = checkedPrivateSkillCreate({ slug, displayName: options.displayName, description: options.description, visibility: options.visibility, confirm: options.confirm });
        verifySessionOptions(options);
        const context = options.userId ? { userId: options.userId, membershipId: options.membershipId! } : undefined;
        const pending = preparePrivatePublicationSession(context);
        let code: string | null;
        if (options.codeStdin) code = await readCode();
        else { await new RemoteSkillsAuthClient(pending.origin).requestCode(options.email); code = await promptCode(); }
        if (code === null) return;
        const client = await pending.verify(options.email, code);
        const result = await client.createSkill({ ...body, confirm: true });
        if (options.json) console.log(JSON.stringify(result));
        else { console.log(`Created ${result.visibility} skill: ${result.slug}`); console.log(`Skill ID: ${result.id}`); }
      } catch (error) {
        const result = error instanceof PrivatePublicationError ? privatePublicationCustomerError(error)
          : { error: "Unable to verify the selected account and workspace for skill creation. Check the server, membership and fresh code; no credential was saved.", code: "SKILL_CREATE_SESSION_UNAVAILABLE", uncertain: false };
        if (options.json) console.log(JSON.stringify(result)); else console.error(result.error);
        process.exitCode = 1;
      }
    });
  group.command("versions").allowExcessArguments(false)
    .description("Read one page of a private skill's versions and current version using fresh interactive sign-in")
    .argument("<skill-id>", "Private or team skill UUID from the workspace catalog or create result")
    .requiredOption("--email <email>", "Account email for fresh interactive verification")
    .option("--user-id <uuid>", "Observed account UUID (required without an enrolled named profile)")
    .option("--membership-id <uuid>", "Observed workspace membership UUID")
    .option("--code-stdin", "Read a fresh six-digit verification code from stdin")
    .option("--limit <count>", "Page size from 1 to 50", "20")
    .option("--cursor <uuid>", "Read the next page using its returned cursor")
    .option("--json", "Output validated history metadata without credentials or source content")
    .action(async (skillId: string, options: VerificationOptions & { limit: string; cursor?: string }) => {
      try {
        if (!publicationUuid(skillId) || !/^[1-9]\d?$/.test(options.limit) || Number(options.limit) > 50
          || (options.cursor !== undefined && !publicationUuid(options.cursor)))
          throw new PrivatePublicationError("INVALID_PRIVATE_HISTORY_INPUT", "Provide a private skill UUID, --limit from 1 to 50, and an optional UUID --cursor.");
        verifySessionOptions(options);
        const context = options.userId ? { userId: options.userId, membershipId: options.membershipId! } : undefined;
        const pending = preparePrivateSkillHistorySession(context);
        let code: string | null;
        if (options.codeStdin) code = await readCode();
        else { await new RemoteSkillsAuthClient(pending.origin).requestCode(options.email); code = await promptCode(); }
        if (code === null) return;
        const client = await pending.verify(options.email, code);
        const history = await client.listVersions(skillId, { limit: Number(options.limit), cursor: options.cursor });
        if (options.json) console.log(JSON.stringify(history));
        else {
          console.log(`Private versions of ${history.slug} (${history.skillId})`);
          console.log(`Current version: ${history.currentVersion ?? "Not published yet"}`);
          if (!history.versions.length) console.log("No versions on this page.");
          for (const version of history.versions) console.log(`  ${version.version}${version.id === history.currentVersionId ? " (current)" : ""}  published: ${version.releasedAt ?? "Not released"}  created: ${version.createdAt}`);
          if (history.nextCursor) console.log(`More versions: repeat this command with --cursor ${history.nextCursor} and fresh verification.`);
        }
      } catch (error) {
        const result = error instanceof PrivatePublicationError ? privatePublicationCustomerError(error)
          : { error: "Unable to read private version history. Check the selected account, workspace and fresh verification; no skill or credential was changed.", code: "PRIVATE_HISTORY_UNAVAILABLE", uncertain: false };
        if (options.json) console.log(JSON.stringify(result)); else console.error(result.error);
        process.exitCode = 1;
      }
    });
  const publishCommand = group.command("publish").allowExcessArguments(false)
      .description("Publish private source with explicit current-version comparison")
      .requiredOption("--recovery-dir <directory>", "New recovery directory for publish; existing directory for other actions")
      .requiredOption("--email <email>", "Account email for fresh interactive verification")
      .option("--user-id <uuid>", "Observed account UUID (required without an enrolled named profile)")
      .option("--membership-id <uuid>", "Observed workspace membership UUID")
      .option("--code-stdin", "Read a fresh six-digit verification code from stdin")
      .option("--json", "Output a safe result without session credentials or upload URLs")
      .option("--confirm", "Explicitly approve this action")
      .argument("<directory>", "Validated local skill directory")
      .requiredOption("--skill-id <uuid>", "Existing private/team skill UUID")
      .option("--expected-current-version <uuid>", "Compare against the observed current version UUID")
      .option("--expect-empty", "Require the skill to have no current version")
      .option("--idempotency-key <uuid>", "Stable intent key; generated and saved before begin when omitted")
      .option("--wait-seconds <seconds>", "Bounded status wait from 0 to 300", "60");
  const statusCommand = group.command("status").allowExcessArguments(false)
      .description("Inspect the exact saved publication")
      .requiredOption("--recovery-dir <directory>", "New recovery directory for publish; existing directory for other actions")
      .requiredOption("--email <email>", "Account email for fresh interactive verification")
      .option("--user-id <uuid>", "Observed account UUID (required without an enrolled named profile)")
      .option("--membership-id <uuid>", "Observed workspace membership UUID")
      .option("--code-stdin", "Read a fresh six-digit verification code from stdin")
      .option("--json", "Output a safe result without session credentials or upload URLs");
  const resumeCommand = group.command("resume").allowExcessArguments(false)
      .description("Reconcile the saved intent without creating a replacement")
      .requiredOption("--recovery-dir <directory>", "New recovery directory for publish; existing directory for other actions")
      .requiredOption("--email <email>", "Account email for fresh interactive verification")
      .option("--user-id <uuid>", "Observed account UUID (required without an enrolled named profile)")
      .option("--membership-id <uuid>", "Observed workspace membership UUID")
      .option("--code-stdin", "Read a fresh six-digit verification code from stdin")
      .option("--json", "Output a safe result without session credentials or upload URLs")
      .option("--confirm", "Explicitly approve this action")
      .option("--wait-seconds <seconds>", "Bounded status wait from 0 to 300", "60");
  const cancelCommand = group.command("cancel").allowExcessArguments(false)
      .description("Cancel the exact saved publication")
      .requiredOption("--recovery-dir <directory>", "New recovery directory for publish; existing directory for other actions")
      .requiredOption("--email <email>", "Account email for fresh interactive verification")
      .option("--user-id <uuid>", "Observed account UUID (required without an enrolled named profile)")
      .option("--membership-id <uuid>", "Observed workspace membership UUID")
      .option("--code-stdin", "Read a fresh six-digit verification code from stdin")
      .option("--json", "Output a safe result without session credentials or upload URLs")
      .option("--confirm", "Explicitly approve this action");
  for (const [action, command] of [["publish", publishCommand], ["status", statusCommand], ["resume", resumeCommand], ["cancel", cancelCommand]] as const) {
    command.action(async (...args: unknown[]) => {
      const options = (action === "publish" ? args[1] : args[0]) as Options;
      try {
        verifyOptions(options, action);
        const context = options.userId ? { userId: options.userId, membershipId: options.membershipId! } : undefined;
        const pending = preparePrivatePublicationSession(context);
        let code: string | null;
        if (options.codeStdin) code = await readCode();
        else { await new RemoteSkillsAuthClient(pending.origin).requestCode(options.email); code = await promptCode(); }
        if (code === null) return;
        const client = await pending.verify(options.email, code), directory = resolve(options.recoveryDir);
        if (action === "publish") await preparePrivatePublication(client, resolve(args[0] as string), directory,
          { skillId: options.skillId!, expectedCurrentVersionId: options.expectedCurrentVersion ?? null, idempotencyKey: options.idempotencyKey });
        const result = action === "publish" || action === "resume"
          ? await continuePrivatePublication(client, directory, { confirm: true, waitMs: Number(options.waitSeconds) * 1000 })
          : await inspectPrivatePublication(client, directory, action === "cancel");
        print(result, options.json);
      } catch (error) {
        const result = privatePublicationCustomerError(error);
        if (options.json) console.log(JSON.stringify(result)); else console.error(result.error);
        process.exitCode = 1;
      }
    });
  }
}
