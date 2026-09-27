import type { Command } from "commander";
import { prepareProfileWorkspace } from "../../lib/workspace-profile.js";
import { RemoteSkillsAuthClient } from "../../lib/remote-auth.js";
import { workspaceLeaveInput, workspaceLeaveProfileContext, RemoteWorkspaceLeaveError, RemoteWorkspaceLeaveUnconfirmedError, WorkspaceLeaveInputError } from "../../lib/remote-workspace-leave.js";
import { NameInputError, promptCode, readCode } from "./customer-verification.js";
import type { RemoteCustomerRole } from "../../lib/remote-profile.js";

export function registerWorkspaceLeaveCommand(workspace: Command) {
  workspace.command("leave <membership-id>").allowExcessArguments(false)
    .description("Leave exactly this membership after fresh verification; saved profiles stay unchanged")
    .requiredOption("--expected-role <role>", "Observed role: owner, admin, member or viewer")
    .requiredOption("--email <email>", "Account email for fresh verification")
    .requiredOption("--confirm", "Confirm losing access through this membership and signing in again")
    .option("--user-id <id>", "Observed user ID; required without a named workspace profile")
    .option("--code-stdin", "Read a previously requested six-digit verification code from stdin")
    .option("--json", "Output the confirmed result as JSON")
    .action(async (membershipId: string, options: { expectedRole: RemoteCustomerRole; email: string; confirm: boolean; userId?: string; codeStdin?: boolean; json?: boolean }) => {
      try {
        if (options.confirm !== true) throw new WorkspaceLeaveInputError();
        const pending = prepareProfileWorkspace("Leave workspace");
        const target = await pending.resolve();
        const captured = workspaceLeaveInput(workspaceLeaveProfileContext(membershipId, options.userId, target.context), { expectedRole: options.expectedRole, confirm: true });
        if (!options.email.includes("@")) throw new NameInputError("Provide the verified account email.");
        if (!options.codeStdin && (options.json || !process.stdin.isTTY || !process.stderr.isTTY))
          throw new NameInputError("Use --code-stdin with a fresh verification code for noninteractive leave actions.");
        const client = new RemoteSkillsAuthClient(target.origin);
        let code: string | null;
        if (options.codeStdin) code = await readCode();
        else { await client.requestCode(options.email); code = await promptCode(); }
        if (code === null) return;
        target.unchanged();
        const result = await client.leaveWorkspace(options.email, code, captured.context, captured.input);
        if (options.json) console.log(JSON.stringify(result));
        else console.log("Workspace membership left. Sign in again to an available workspace. Saved credentials are unchanged; this membership's credentials no longer grant access.");
      } catch (error) {
        const known = error instanceof RemoteWorkspaceLeaveError || error instanceof RemoteWorkspaceLeaveUnconfirmedError;
        const message = known || error instanceof WorkspaceLeaveInputError || error instanceof NameInputError ? error.message
          : "Leaving could not be confirmed. Check the selected profile and exact membership, sign in again and inspect available workspaces before another action. Do not retry automatically; saved credentials are unchanged.";
        if (options.json) console.log(JSON.stringify({ error: message, ...(known ? { code: error.code } : {}) }));
        else console.error(message);
        process.exitCode = 1;
      }
    });
}
