import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RemoteSkillsAuthClient } from "../lib/remote-auth.js";
import { captureProfileWorkspace } from "../lib/workspace-profile.js";
import { invitationCustomerError, invitationProfileContext, invokeFreshInvitation } from "../lib/invitation-customer-action.js";
import { invitationInput, type InvitationAction, type InvitationInputs } from "../lib/remote-invitations.js";
import { mcpError, mcpJson } from "./helpers.js";

export function registerRemoteInvitationTools(server: McpServer) {
  const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  const verification = { userId: uuid, membershipId: uuid, email: z.string().email().max(254), code: z.string().regex(/^\d{6}$/) };
  const schemas = {
    list: z.object({ ...verification, after: uuid.optional() }).strict(),
    get: z.object({ ...verification, invitationId: uuid }).strict(),
    issue: z.object({ ...verification, recipient: z.string().email().max(254), role: z.enum(["owner", "admin", "member", "viewer"]), idempotencyKey: uuid, confirm: z.literal(true) }).strict(),
    resend: z.object({ ...verification, invitationId: uuid, expectedGeneration: z.number().int().min(1).max(10), idempotencyKey: uuid, confirm: z.literal(true) }).strict(),
    revoke: z.object({ ...verification, invitationId: uuid, expectedGeneration: z.number().int().min(1).max(10), confirm: z.literal(true) }).strict(),
    accept: z.object({ ...verification, invitationId: uuid, token: z.string().regex(/^[A-Za-z0-9_-]{43}$/).describe("Secret from the invitation email; supplied only in the MCP request, never returned or saved."), confirm: z.literal(true) }).strict(),
  };
  for (const action of ["list", "get", "issue", "resend", "revoke", "accept"] as const) {
    const read = action === "list" || action === "get";
    server.registerTool(action === "list" ? "list_workspace_invitations" : `${action}_workspace_invitation`, {
      title: `${action[0].toUpperCase() + action.slice(1)} Workspace Invitation${action === "list" ? "s" : ""}`,
      description: "Use fresh verification bound to the exact observed user/current membership and any selected profile. Mutations require confirm=true; issue/resend require a stable caller request key. Never retry uncertain outcomes automatically. Acceptance does not switch workspace or create credentials. Zero-membership account recovery is not supported by this flow.",
      annotations: { destructiveHint: !read, idempotentHint: true, readOnlyHint: read },
      inputSchema: schemas[action],
    }, async (value: Record<string, unknown>) => {
      try {
        const { userId, membershipId, email, code, recipient, ...rest } = value;
        const input = invitationInput(action, (action === "issue" ? { ...rest, email: recipient } : rest) as InvitationInputs[InvitationAction]);
        const context = invitationProfileContext(String(userId), String(membershipId));
        const target = await captureProfileWorkspace("Manage invitations");
        invitationProfileContext(context.userId, context.membershipId, target.context); target.unchanged();
        return mcpJson(await invokeFreshInvitation(new RemoteSkillsAuthClient(target.origin), String(email), String(code), context, action, input));
      } catch (error) { const result = invitationCustomerError(error); return mcpError(result.code, result.error); }
    });
  }
}
