import type { Command } from "commander";
import { RemoteSkillsAuthClient } from "../../lib/remote-auth.js";
import { prepareInvitationRecoveryTarget } from "../../lib/invitation-recovery-target.js";
import { invitationEmailIds, invitationEmailCustomerError, InvitationEmailInputError } from "../../lib/remote-invitation-recovery.js";
import { promptInvitationToken, promptInvitationRecoveryCode, readInvitationSecrets } from "./invitation-verification.js";

async function readToken() {
  if (process.stdin.isTTY) throw new InvitationEmailInputError();
  let value = "";
  for await (const chunk of process.stdin) { value += chunk.toString(); if (value.length > 45) throw new InvitationEmailInputError(); }
  const matched = /^([A-Za-z0-9_-]{43})(?:\r?\n)?$/.exec(value);
  if (!matched) throw new InvitationEmailInputError();
  return matched[1];
}
export function registerInvitationRecoveryCommands(invitations: Command) {
  for (const action of ["challenge", "accept"] as const) {
    // Commander .command() shares its parent's output configuration by reference.
    // Prepare an independent command so proof-safe errors cannot replace ordinary CLI errors.
    const command = invitations.createCommand(`email-${action}`).argument("<invitation-id>").allowExcessArguments(false).enablePositionalOptions()
      .configureOutput({ writeErr: () => { process.stderr.write("Invitation recovery arguments were refused. Supply proof only through masked input or the documented stdin flags.\n"); } })
      .description(action === "challenge" ? "Request an eligibility-neutral recovery code; does not confirm delivery" : "Accept with invitation proof; requires ordinary sign-in afterward")
      .requiredOption("--challenge-id <id>", "Your retained challenge UUID; generate it before the request and keep the same exact context")
      .requiredOption("--confirm", "Confirm this exact invitation recovery action")
      .option(action === "challenge" ? "--token-stdin" : "--secrets-stdin", action === "challenge" ? "Read the invitation token from one stdin line" : "Read the recovery code then invitation token from two stdin lines")
      .option("--json", "Output only validated results")
      .action(async (invitationId: string, options: { challengeId: string; confirm?: boolean; tokenStdin?: boolean; secretsStdin?: boolean; json?: boolean }) => {
        try {
          if (options.confirm !== true) throw new InvitationEmailInputError();
          const ids = invitationEmailIds(invitationId, options.challengeId), target = prepareInvitationRecoveryTarget();
          const piped = action === "challenge" ? options.tokenStdin : options.secretsStdin;
          if (!piped && (options.json || !process.stdin.isTTY || !process.stderr.isTTY)) throw new InvitationEmailInputError();
          let token: string | null, code: string | null = null;
          if (piped && action === "accept") ({ token, code } = await readInvitationSecrets());
          else if (piped) token = await readToken();
          else {
            token = await promptInvitationToken(); if (token === null) return;
            if (action === "accept") { code = await promptInvitationRecoveryCode(); if (code === null) return; }
          }
          target.unchanged();
          const client = new RemoteSkillsAuthClient(target.origin);
          const result = action === "challenge" ? await client.requestInvitationEmailChallenge({ ...ids, token: token!, confirm: true })
            : await client.acceptInvitationEmailChallenge({ ...ids, token: token!, code: code!, confirm: true });
          console.log(JSON.stringify(result, null, options.json ? undefined : 2));
        } catch (error) { const result = invitationEmailCustomerError(error); if (options.json) console.log(JSON.stringify(result)); else console.error(result.error); process.exitCode = 1; }
      });
    invitations.addCommand(command);
  }
}
