import type { Command } from "commander";
import { getApiUrl } from "../../lib/auth-store.js";
import { RemoteSkillsAuthClient } from "../../lib/remote-auth.js";
import { prepareWorkspaceEnrollment, WorkspaceProfileError } from "../../lib/workspace-profile.js";
import { NameInputError, promptCode, readCode } from "./customer-verification.js";

type Options = { email?: string; codeStdin?: boolean; json?: boolean };
async function codeFor(client: RemoteSkillsAuthClient, options: Options): Promise<string | null> {
  if (!options.email?.includes("@")) throw new NameInputError("Provide the account email with --email.");
  if (options.codeStdin) return readCode();
  if (options.json || !process.stdin.isTTY || !process.stderr.isTTY) throw new NameInputError("Use --code-stdin with a fresh verification code for noninteractive requests.");
  await client.requestCode(options.email);
  return promptCode();
}
function errorResult(error: unknown, json?: boolean) {
  const message = error instanceof NameInputError || error instanceof WorkspaceProfileError ? error.message
    : "Unable to complete workspace sign-in. Check the selected server, profile, account and fresh verification code.";
  if (json) console.log(JSON.stringify({ error: message })); else console.error(message);
  process.exitCode = 1;
}
export function registerWorkspaceListCommand(workspace: Command) {
  workspace.command("list").allowExcessArguments(false)
    .description("Discover eligible workspaces with fresh sign-in; no credentials are saved")
    .requiredOption("--email <email>", "Account email for fresh verification")
    .option("--code-stdin", "Read a previously requested six-digit verification code from stdin")
    .option("--json", "Output safe workspace identities as JSON")
    .action(async (options: Options) => {
      try {
        const origin = getApiUrl("Discover workspaces", { ...process.env });
        const client = new RemoteSkillsAuthClient(origin);
        const code = await codeFor(client, options); if (code === null) return;
        const result = await client.listAccountWorkspaces(options.email!, code);
        if (options.json) console.log(JSON.stringify({ apiUrl: origin, ...result }));
        else {
          console.log(`Account: ${result.userId}\nAPI: ${origin}`);
          for (const entry of result.workspaces) console.log(`${entry.current ? "*" : " "} ${entry.organization.name}\t${entry.role}\t${entry.membershipId}`);
          console.log("* Initial sign-in workspace. Enroll a named profile with auth login --membership-id <id>.");
        }
      } catch (error) { errorResult(error, options.json); }
    });
}
export async function loginWorkspace(options: Options & { membershipId: string }) {
  try {
    const enrollment = await prepareWorkspaceEnrollment(options.membershipId);
    const code = await codeFor(new RemoteSkillsAuthClient(enrollment.origin), options); if (code === null) return;
    const result = await enrollment.complete(options.email!, code);
    if (options.json) console.log(JSON.stringify(result));
    else console.log(`Signed in as ${result.email}\nProfile: ${result.profile}\nAPI: ${result.apiUrl}\nWorkspace: ${result.organization} (${result.organizationId})\nMembership: ${result.membershipId}\nRole: ${result.role}\nOne workspace key saved. Use HASNA_PROFILE=${result.profile} for subsequent commands.`);
  } catch (error) { errorResult(error, options.json); }
}
