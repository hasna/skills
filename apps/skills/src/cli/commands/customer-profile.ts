import { registerWorkspaceInvitationCommands } from "./workspace-invitations.js";
import type { Command } from "commander";
import { prepareProfileWorkspace } from "../../lib/workspace-profile.js";
import { registerWorkspaceListCommand } from "./workspace-selection.js";
import { RemoteSkillsAuthClient } from "../../lib/remote-auth.js";
import { customerNamePatch } from "../../lib/remote-profile.js";
import { NameInputError, promptCode, readCode } from "./customer-verification.js";
import { registerWorkspaceLeaveCommand } from "./workspace-leave.js";
import { registerWorkspaceMembersCommand } from "./workspace-members.js";
import { registerWorkspaceMemberMutationCommands } from "./workspace-member-mutations.js";

export function registerCustomerProfileCommands(program: Command) {
  const account = program.command("account").description("Manage your account on the selected Skills server");
  const workspace = program.command("workspace").description("Manage the current workspace on the selected Skills server");
  registerWorkspaceListCommand(workspace);
  registerWorkspaceMembersCommand(workspace);
  registerWorkspaceMemberMutationCommands(workspace);
  registerWorkspaceLeaveCommand(workspace);
  registerWorkspaceInvitationCommands(workspace);
  const commands = [
    { kind: "account", command: account.command("update") },
    { kind: "workspace", command: workspace.command("update") },
  ] as const;
  for (const { kind, command } of commands) {
    command.allowExcessArguments(false)
      .description(kind === "account" ? "Update your display name with fresh email verification" : "Update the current workspace name as an owner or admin")
      .requiredOption(kind === "account" ? "--display-name <name>" : "--name <name>", "New name (1–100 characters)")
      .requiredOption("--email <email>", "Account email for fresh verification")
      .option("--code-stdin", "Read a previously requested six-digit verification code from stdin")
      .option("--json", "Output JSON")
      .action(async (options: { email: string; displayName?: string; name?: string; json?: boolean; codeStdin?: boolean }) => {
        try {
          const pending = prepareProfileWorkspace(`Update ${kind} name`);
          const client = new RemoteSkillsAuthClient(pending.origin);
          customerNamePatch(kind === "account" ? { displayName: options.displayName } : { name: options.name }, kind === "account" ? "displayName" : "name");
          if (!options.codeStdin && (options.json || !process.stdin.isTTY || !process.stderr.isTTY)) {
            throw new NameInputError("Use --code-stdin with a fresh verification code for JSON or noninteractive updates.");
          }
          let code: string | null;
          if (options.codeStdin) code = await readCode();
          else { await client.requestCode(options.email); code = await promptCode(); }
          if (code === null) return;
          const target = await pending.resolve();
          target.unchanged();
          const result = kind === "account"
            ? await client.updateProfile(options.email, code, { displayName: options.displayName! }, target.context)
            : await client.updateCurrentWorkspace(options.email, code, { name: options.name! }, target.context);
          if (options.json) console.log(JSON.stringify(result));
          else console.log(kind === "account" ? "Display name saved." : "Workspace name saved.");
        } catch (error) {
          // Auth server bodies can contain arbitrary text. Never print a code,
          // session, response body or supplied value on these credential paths.
          const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
          const message = error instanceof NameInputError ? error.message
            : `Unable to update ${kind} name${status ? ` (HTTP ${status})` : ""}. Check the selected server, name, permissions and fresh verification code.`;
          if (options.json) console.log(JSON.stringify({ error: message })); else console.error(message);
          process.exitCode = 1;
        }
      });
  }
}
