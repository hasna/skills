import { registerInvitationRecoveryCommands } from "./invitation-recovery.js";
import type { Command } from "commander";
import { prepareProfileWorkspace } from "../../lib/workspace-profile.js";
import { RemoteSkillsAuthClient } from "../../lib/remote-auth.js";
import { invitationCustomerError, invitationProfileContext, invokeFreshInvitation } from "../../lib/invitation-customer-action.js";
import { invitationId, invitationInput, WorkspaceInvitationInputError, type InvitationAction, type InvitationInputs, type IssueRemoteWorkspaceInvitation } from "../../lib/remote-invitations.js";
import { NameInputError, promptCode, readCode } from "./customer-verification.js";
import { promptInvitationToken, readInvitationSecrets } from "./invitation-verification.js";

type Options = { userId: string; membershipId: string; email: string; json?: boolean; confirm?: boolean; codeStdin?: boolean; secretsStdin?: boolean;
  after?: string; recipient?: string; role?: IssueRemoteWorkspaceInvitation["role"]; idempotencyKey?: string; expectedGeneration?: string };
export function registerWorkspaceInvitationCommands(workspace: Command) {
  const invitations = workspace.command("invitations").description("Manage workspace invitations with fresh verification and unchanged saved credentials");
  registerInvitationRecoveryCommands(invitations);
  for (const action of ["list", "get", "issue", "resend", "revoke", "accept"] as const) {
    const targeted = ["get", "resend", "revoke", "accept"].includes(action), mutation = !["list", "get"].includes(action);
    const command = invitations.command(action + (targeted ? " <invitation-id>" : "")).allowExcessArguments(false)
      .description(action === "accept" ? "Accept a received invitation; does not switch workspace or create credentials" : `${action} invitations in the exact observed workspace`)
      .requiredOption("--user-id <id>", "Observed account ID from workspace list")
      .requiredOption("--membership-id <id>", "Exact observed current membership; must match any selected profile")
      .requiredOption("--email <email>", "Account email for fresh verification")
      .option("--json", "Output the validated result as JSON");
    if (mutation) command.requiredOption("--confirm", "Confirm this exact invitation action");
    if (action === "list") command.option("--after <id>", "Exact nextCursor from the previous page");
    if (action === "issue") command.requiredOption("--recipient <email>", "Invitation recipient").requiredOption("--role <role>", "owner, admin, member or viewer");
    if (action === "issue" || action === "resend") command.requiredOption("--idempotency-key <id>", "Your stable request UUID; reuse only with the same original context and parameters");
    if (action === "resend" || action === "revoke") command.requiredOption("--expected-generation <number>", "Generation you observed before confirming");
    if (action === "accept") command.option("--secrets-stdin", "Read a fresh six-digit code and invitation token on two separate stdin lines");
    else command.option("--code-stdin", "Read a previously requested six-digit verification code from stdin");
    command.action(async (...args: unknown[]) => {
      const id = targeted ? String(args[0]) : undefined, options = args[targeted ? 1 : 0] as Options;
      try {
        if (mutation && options.confirm !== true) throw new WorkspaceInvitationInputError();
        let input: InvitationInputs[InvitationAction] = action === "list" ? { ...(options.after === undefined ? {} : { after: options.after }) }
          : action === "get" ? { invitationId: id! }
          : action === "issue" ? { email: options.recipient!, role: options.role!, idempotencyKey: options.idempotencyKey!, confirm: true }
          : action === "resend" ? { invitationId: id!, expectedGeneration: Number(options.expectedGeneration), idempotencyKey: options.idempotencyKey!, confirm: true }
          : action === "revoke" ? { invitationId: id!, expectedGeneration: Number(options.expectedGeneration), confirm: true }
          : { invitationId: id!, token: "", confirm: true };
        // Validate public fields and snapshot identity before reading any secret or requesting OTP.
        if (action === "accept") invitationId(id);
        else input = invitationInput(action, input);
        const context = invitationProfileContext(options.userId, options.membershipId);
        if (!options.email.includes("@")) throw new NameInputError("Provide the verified account email.");
        const stdin = action === "accept" ? options.secretsStdin : options.codeStdin;
        if (!stdin && (options.json || !process.stdin.isTTY || !process.stderr.isTTY)) throw new NameInputError(action === "accept"
          ? "Use --secrets-stdin with a fresh code and invitation token on two separate lines." : "Use --code-stdin with a fresh verification code.");
        const target = await prepareProfileWorkspace("Manage invitations").resolve();
        invitationProfileContext(context.userId, context.membershipId, target.context);
        const client = new RemoteSkillsAuthClient(target.origin);
        let code: string | null, token: string | null = null;
        if (action === "accept" && stdin) ({ code, token } = await readInvitationSecrets());
        else {
          if (action === "accept") { token = await promptInvitationToken(); if (token === null) return; }
          if (stdin) code = await readCode();
          else { await client.requestCode(options.email); code = await promptCode(); }
        }
        if (code === null) return;
        if (action === "accept") input = invitationInput("accept", { invitationId: id!, token: token!, confirm: true });
        target.unchanged();
        const result = await invokeFreshInvitation(client, options.email, code, context, action, input);
        console.log(JSON.stringify(result, null, options.json ? undefined : 2));
      } catch (error) {
        const result = error instanceof NameInputError ? { code: "INVITATION_INPUT_INVALID", error: error.message } : invitationCustomerError(error);
        if (options.json) console.log(JSON.stringify(result)); else console.error(result.error);
        process.exitCode = 1;
      }
    });
  }
}
