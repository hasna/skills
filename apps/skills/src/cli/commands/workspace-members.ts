import type { Command } from "commander";
import { prepareProfileWorkspace } from "../../lib/workspace-profile.js";
import { RemoteSkillsAuthClient } from "../../lib/remote-auth.js";
import { workspaceMembersQuery } from "../../lib/remote-workspace.js";
import { NameInputError, promptCode, readCode } from "./customer-verification.js";

export function registerWorkspaceMembersCommand(workspace: Command) {
  workspace.command("members").allowExcessArguments(false)
    .description("List the current workspace roster with fresh owner/admin verification")
    .requiredOption("--email <email>", "Account email for fresh verification")
    .option("--code-stdin", "Read a previously requested six-digit verification code from stdin")
    .option("--limit <count>", "Page size from 1 to 100 (server default: 50)")
    .option("--cursor <cursor>", "Unchanged nextCursor from the preceding page")
    .option("--json", "Output the complete page as JSON")
    .action(async (options: { email: string; codeStdin?: boolean; limit?: string; cursor?: string; json?: boolean }) => {
      try {
        if (options.limit !== undefined && !/^[1-9]\d{0,2}$/.test(options.limit)) throw new NameInputError("Use a roster limit from 1 to 100.");
        const page = { limit: options.limit === undefined ? undefined : Number(options.limit), cursor: options.cursor };
        workspaceMembersQuery(page);
        const pending = prepareProfileWorkspace("List workspace members");
        const client = new RemoteSkillsAuthClient(pending.origin);
        if (!options.codeStdin && (options.json || !process.stdin.isTTY || !process.stderr.isTTY))
          throw new NameInputError("Use --code-stdin with a fresh verification code for JSON or noninteractive roster requests.");
        let code: string | null;
        if (options.codeStdin) code = await readCode();
        else { await client.requestCode(options.email); code = await promptCode(); }
        if (code === null) return;
        const target = await pending.resolve();
        target.unchanged();
        const result = await client.listWorkspaceMembers(options.email, code, page, target.context);
        if (options.json) console.log(JSON.stringify(result));
        else {
          const text = (value: string) => value.replace(/[\p{Cc}\p{Cs}\u2028\u2029]/gu, " ");
          console.log(`Workspace: ${result.organizationId}`);
          if (!result.members.length) console.log("No members in this page.");
          for (const member of result.members) console.log(`${text(member.email)}\t${member.role}\t${text(member.displayName ?? "")}\t${member.membershipId}\t${member.createdAt}`);
          if (result.nextCursor !== null) console.log(`Next cursor: ${result.nextCursor}`);
        }
      } catch (error) {
        const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
        const message = error instanceof NameInputError ? error.message
          : `Unable to list workspace members${status ? ` (HTTP ${status})` : ""}. Check the selected server, owner/admin permissions, pagination and fresh verification code.`;
        if (options.json) console.log(JSON.stringify({ error: message })); else console.error(message);
        process.exitCode = 1;
      }
    });
}
