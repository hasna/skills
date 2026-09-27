import type { Command } from "commander";
import { resolve } from "node:path";
import { RemoteSkillsAuthClient } from "../../lib/remote-auth.js";
import { getApiUrl } from "../../lib/auth-store.js";
import { privatePublicationCustomerError, privatePublicationSession } from "../../lib/private-publication-customer.js";
import { preparePrivatePublication, continuePrivatePublication, inspectPrivatePublication, type PrivatePublicationResult } from "../../lib/private-publication-recovery.js";
import { PrivatePublicationError, publicationUuid } from "../../lib/remote-private-publications.js";
import { promptCode, readCode } from "./customer-verification.js";

type Options = { email: string; userId?: string; membershipId?: string; codeStdin?: boolean; json?: boolean; confirm?: boolean;
  recoveryDir: string; skillId?: string; expectedCurrentVersion?: string; expectEmpty?: boolean; idempotencyKey?: string; waitSeconds?: string };
function verifyOptions(options: Options, action: string) {
  if ((options.userId === undefined) !== (options.membershipId === undefined)
    || (options.userId !== undefined && (!publicationUuid(options.userId) || !publicationUuid(options.membershipId))))
    throw new PrivatePublicationError("PUBLICATION_CONTEXT_REQUIRED", "Provide both observed --user-id and --membership-id UUIDs.");
  if ((action === "publish" || action === "resume" || action === "cancel") && options.confirm !== true)
    throw new PrivatePublicationError("PUBLICATION_CONFIRM_REQUIRED", "Use --confirm to approve this publication action.");
  if (action === "publish" && (!publicationUuid(options.skillId) || Boolean(options.expectEmpty) === (options.expectedCurrentVersion !== undefined)
    || (options.expectedCurrentVersion !== undefined && !publicationUuid(options.expectedCurrentVersion))
    || (options.idempotencyKey !== undefined && !publicationUuid(options.idempotencyKey))))
    throw new PrivatePublicationError("INVALID_PUBLICATION_INPUT", "Provide --skill-id and exactly one of --expect-empty or --expected-current-version; optional --idempotency-key must be a UUID.");
  if (options.waitSeconds !== undefined && (!/^(?:0|[1-9]\d{0,2})$/.test(options.waitSeconds) || Number(options.waitSeconds) > 300))
    throw new PrivatePublicationError("INVALID_PUBLICATION_INPUT", "Use --wait-seconds from 0 to 300.");
  if (!options.codeStdin && (options.json || !process.stdin.isTTY || !process.stderr.isTTY))
    throw new PrivatePublicationError("PUBLICATION_CODE_REQUIRED", "Use --code-stdin with a fresh code for noninteractive publishing.");
}
function print(result: PrivatePublicationResult, json?: boolean) {
  if (json) console.log(JSON.stringify(result));
  else { console.log(`Publication: ${result.state}`); console.log(`Recovery: ${result.recoveryDirectory}`); console.log(result.nextAction); }
  // Pending is explicitly distinct from completed publication.
  if (!result.committed && !["cancelled", "expired"].includes(result.state)) process.exitCode = 2;
}
export function registerPrivatePublications(parent: Command) {
  const group = parent.command("publication").description("Publish and reconcile private source versions on a compatible hosted server; execution is separate");
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
        let code: string | null;
        if (options.codeStdin) code = await readCode();
        else { await new RemoteSkillsAuthClient(getApiUrl("Publish private skills")).requestCode(options.email); code = await promptCode(); }
        if (code === null) return;
        const context = options.userId ? { userId: options.userId, membershipId: options.membershipId! } : undefined;
        const client = await privatePublicationSession(options.email, code, context), directory = resolve(options.recoveryDir);
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
