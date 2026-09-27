import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pkg from "../../package.json" with { type: "json" };
import { isSkillsLocalOptIn } from "../lib/local-opt-in.js";
import { prepareInvitationRecoveryTarget } from "../lib/invitation-recovery-target.js";
import { RemoteSkillsAuthClient } from "../lib/remote-auth.js";
import { invitationEmailCustomerError, type RequestInvitationEmailChallenge, type AcceptInvitationEmailChallenge } from "../lib/remote-invitation-recovery.js";
import { mcpError, mcpJson } from "./helpers.js";

/** Dedicated anonymous proof surface. Ordinary tools and credential resolution are not initialized. */
export async function startInvitationRecoveryMcp(args: string[], env: Record<string, string | undefined> = process.env) {
  if (args.length !== 2 || !args.includes("--invitation-recovery") || !args.includes("--stdio")
    || env.MCP_HTTP === "1" || !!env.MCP_HTTP_PORT || isSkillsLocalOptIn(env)) throw new Error("Use only --invitation-recovery --stdio with an explicit Skills API URL.");
  const target = prepareInvitationRecoveryTarget(env);
  const server = new McpServer({ name: "skills-invitation-recovery", version: pkg.version });
  const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  const proof = { invitationId: uuid, challengeId: uuid, token: z.string().regex(/^[A-Za-z0-9_-]{43}$/).describe("Invitation secret, only in this request; never logged or persisted."), confirm: z.literal(true) };
  const client = new RemoteSkillsAuthClient(target.origin);
  server.registerTool("request_invitation_email_challenge", {
    title: "Request Invitation Recovery Code", description: "Existing accounts without usable memberships only. Retain the caller challenge UUID before this single request. The response does not confirm eligibility or email delivery. No automatic retry or credential writes.",
    inputSchema: z.object(proof).strict(), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, async (input: RequestInvitationEmailChallenge) => {
    try { target.unchanged(); return mcpJson(await client.requestInvitationEmailChallenge(input)); }
    catch (error) { const result = invitationEmailCustomerError(error); return mcpError(result.code, result.error); }
  });
  server.registerTool("accept_invitation_email_challenge", {
    title: "Accept Invitation with Recovery Code", description: "Use exact invitation, retained challenge and fresh emailed proof. Success requires ordinary sign-in afterward; it returns no session. After an uncertain response sign in to inspect memberships; never retry acceptance automatically. Host request history contains secrets.",
    inputSchema: z.object({ ...proof, code: z.string().regex(/^\d{6}$/) }).strict(), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, async (input: AcceptInvitationEmailChallenge) => {
    try { target.unchanged(); return mcpJson(await client.acceptInvitationEmailChallenge(input)); }
    catch (error) { const result = invitationEmailCustomerError(error); return mcpError(result.code, result.error); }
  });
  target.unchanged(); await server.connect(new StdioServerTransport());
}
