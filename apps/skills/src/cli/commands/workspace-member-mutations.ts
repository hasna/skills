import type { Command } from "commander";
import { prepareProfileWorkspace } from "../../lib/workspace-profile.js";
import { RemoteSkillsAuthClient } from "../../lib/remote-auth.js";
import { RemoteWorkspaceMemberError } from "../../lib/remote-client.js";
import { WorkspaceMemberInputError, workspaceMemberRoleInput, workspaceMemberRemovalInput } from "../../lib/remote-workspace.js";
import type { RemoteCustomerRole } from "../../lib/remote-profile.js";
import { NameInputError, promptCode, readCode } from "./customer-verification.js";

export function registerWorkspaceMemberMutationCommands(workspace: Command) {
  const member = workspace.command("member").description("Change an exact current-workspace membership with fresh verification");
  for (const action of ["role", "remove"] as const) {
    const command = member.command(`${action} <membership-id>`).allowExcessArguments(false)
      .description(action === "role" ? "Set a member role using the role observed in the roster" : "Remove this membership incarnation; self-removal is unavailable")
      .requiredOption("--expected-role <role>", "Unchanged role observed in the roster: owner, admin, member or viewer")
      .requiredOption("--email <email>", "Account email for fresh verification")
      .option("--code-stdin", "Read a previously requested six-digit verification code from stdin")
      .option("--json", "Output the complete result as JSON");
    if (action === "role") command.requiredOption("--role <role>", "Desired role: owner, admin, member or viewer");
    command.action(async (membershipId: string, options: { role?: string; expectedRole: string; email: string; codeStdin?: boolean; json?: boolean }) => {
      try {
        const captured = action === "role"
          ? { kind: "role" as const, ...workspaceMemberRoleInput(membershipId, { role: options.role as RemoteCustomerRole, expectedRole: options.expectedRole as RemoteCustomerRole }) }
          : { kind: "remove" as const, ...workspaceMemberRemovalInput(membershipId, { expectedRole: options.expectedRole as RemoteCustomerRole }) };
        const pending = prepareProfileWorkspace("Manage workspace member");
        const client = new RemoteSkillsAuthClient(pending.origin);
        if (!options.codeStdin && (options.json || !process.stdin.isTTY || !process.stderr.isTTY))
          throw new NameInputError("Use --code-stdin with a fresh verification code for JSON or noninteractive member actions.");
        let code: string | null;
        if (options.codeStdin) code = await readCode();
        else { await client.requestCode(options.email); code = await promptCode(); }
        if (code === null) return;
        const target = await pending.resolve();
        target.unchanged();
        if (captured.kind === "role") {
          const result = await client.setWorkspaceMemberRole(options.email, code, captured.membershipId, captured.body, target.context);
          if (options.json) console.log(JSON.stringify(result));
          else console.log(result.changed ? `Member role changed to ${result.member.role}.` : `Member already has role ${result.member.role}.`);
        } else {
          const result = await client.removeWorkspaceMember(options.email, code, captured.membershipId, captured.body, target.context);
          if (options.json) console.log(JSON.stringify(result));
          else console.log(result.alreadyRemoved ? "This membership was already removed." : "Membership removed.");
        }
      } catch (error) {
        const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
        const known = error instanceof RemoteWorkspaceMemberError;
        const message = known || error instanceof WorkspaceMemberInputError || error instanceof NameInputError ? error.message
          : `Unable to manage workspace member${status ? ` (HTTP ${status})` : ""}. Check the selected server and fresh verification, then refresh the roster before another action.`;
        if (options.json) console.log(JSON.stringify({ error: message, ...(known ? { code: error.code } : {}), ...(status ? { status } : {}) }));
        else console.error(message);
        process.exitCode = 1;
      }
    });
  }
}
