import { registerRemoteInvitationTools } from "./remote-invitation-tools.js";
import { registerPrivatePublicationTools } from "./private-publication-tools.js";
import { registerRecurringTools } from "./remote-recurring-tools.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RemoteSkillsAuthClient } from "../lib/remote-auth.js";
import { captureProfileWorkspace } from "../lib/workspace-profile.js";
import type { RemoteWorkspaceContext } from "../lib/remote-workspace-selection.js";
import { REMOTE_CUSTOMER_OPERATIONS } from "../lib/remote-customer-operations.js";
import { createRemoteSkillsClient, RemoteCapabilityUnavailableError, RemoteWorkspaceMemberError, RemoteCreditCheckoutError, type RemoteSkillsClient } from "../lib/remote-client.js";
import { workspaceLeaveProfileContext, RemoteWorkspaceLeaveError, RemoteWorkspaceLeaveUnconfirmedError } from "../lib/remote-workspace-leave.js";
import { mcpError, mcpJson } from "./helpers.js";
import { decodeRemoteFiles, describeRemoteFiles } from "../lib/remote-files.js";

export function registerRemoteCustomerTools(server: McpServer) {
  registerRemoteInvitationTools(server);
  registerPrivatePublicationTools(server);
  registerRecurringTools(server);
  const memberRole = z.enum(["owner", "admin", "member", "viewer"]);
  const memberInput = { membershipId: z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/),
    expectedRole: memberRole, email: z.string().email(), code: z.string().regex(/^\d{6}$/) };
  server.registerTool("leave_workspace", {
    title: "Leave Current Workspace",
    description: "Leave exactly the observed user and membership with confirm=true and fresh verification. The server enforces last-owner and last-workspace safeguards. Sign in again afterwards; no automatic retry or saved-profile deletion.",
    annotations: { destructiveHint: true, idempotentHint: false, readOnlyHint: false },
    inputSchema: z.object({ ...memberInput, userId: memberInput.membershipId, confirm: z.literal(true) }).strict(),
  }, async ({ membershipId, userId, expectedRole, email, code, confirm }) => {
    try { return mcpJson(await freshAccount("Leave workspace", (client, context) => client.leaveWorkspace(email, code,
      workspaceLeaveProfileContext(membershipId, userId, context), { expectedRole, confirm }))); }
    catch (error) {
      return error instanceof RemoteWorkspaceLeaveError || error instanceof RemoteWorkspaceLeaveUnconfirmedError
        ? mcpError(error.code, error.message)
        : mcpError("WORKSPACE_LEAVE_UNCONFIRMED", "Leaving could not be confirmed. Check the selected profile and exact membership, sign in again and inspect available workspaces before another action. Do not retry automatically; saved credentials are unchanged.");
    }
  });
  server.registerTool("set_workspace_member_role", {
    title: "Set Current Workspace Member Role",
    description: "Change exactly this membership incarnation with its observed expectedRole and fresh verification. The server enforces owner/admin policy. No automatic refresh or retry; saved credentials stay unchanged.",
    inputSchema: z.object({ ...memberInput, role: memberRole }).strict(),
  }, async ({ membershipId, role, expectedRole, email, code }) => {
    try { return mcpJson(await freshAccount("Set workspace member role", (client, context) => client.setWorkspaceMemberRole(email, code, membershipId, { role, expectedRole }, context))); }
    catch (error) { return memberError(error); }
  });
  server.registerTool("remove_workspace_member", {
    title: "Remove Current Workspace Member",
    description: "Remove exactly this membership incarnation using its observed expectedRole and fresh verification. Self-removal is unavailable. A retry cannot remove a later replacement membership; saved credentials stay unchanged.",
    inputSchema: z.object(memberInput).strict(),
  }, async ({ membershipId, expectedRole, email, code }) => {
    try { return mcpJson(await freshAccount("Remove workspace member", (client, context) => client.removeWorkspaceMember(email, code, membershipId, { expectedRole }, context))); }
    catch (error) { return memberError(error); }
  });
  server.registerTool("list_workspace_members", {
    title: "List Current Workspace Members",
    description: "Read one roster page on the selected Skills server using fresh owner/admin email verification. Saved credentials are unchanged. This does not invite, change or switch members/workspaces.",
    inputSchema: z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/),
      limit: z.number().int().min(1).max(100).optional(), cursor: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/).optional() }).strict(),
  }, async ({ email, code, limit, cursor }) => {
    try {
      return mcpJson(await freshAccount("List workspace members", (client, context) => client.listWorkspaceMembers(email, code, { limit, cursor }, context)));
    } catch {
      return mcpError("WORKSPACE_MEMBERS_FAILED", "Unable to list workspace members. Check the selected server, owner/admin permissions, pagination and fresh verification code.");
    }
  });
  for (const kind of ["profile", "workspace"] as const) {
    server.registerTool(kind === "profile" ? "update_account_profile" : "update_workspace_name", {
      title: kind === "profile" ? "Update Account Display Name" : "Update Workspace Name",
      description: "Update only the name on the explicitly selected Skills server using fresh email OTP. Workspace changes require an owner/admin. Saved credentials are unchanged.",
      inputSchema: z.object({ name: z.string().min(1), email: z.string().email(), code: z.string().regex(/^\d{6}$/) }).strict(),
    }, async ({ name, email, code }) => {
      try {
        return mcpJson(await freshAccount("Update customer name", async (client, context) => kind === "profile"
          ? client.updateProfile(email, code, { displayName: name }, context)
          : client.updateCurrentWorkspace(email, code, { name }, context)));
      } catch {
        return mcpError("NAME_UPDATE_FAILED", "Unable to update the name. Check the selected server, name, permissions and fresh verification code.");
      }
    });
  }
  for (const operation of REMOTE_CUSTOMER_OPERATIONS) {
    if (operation.name === "create_credit_checkout") {
      server.registerTool(operation.name, {
        title: operation.title,
        description: "Create one external checkout link on the selected Skills server. Retain an idempotency_key before calling and reuse it only for explicit recovery on the same server, account and pack. No automatic retries; payment requires customer confirmation.",
        inputSchema: { pack_id: z.string().min(1), idempotency_key: z.string().regex(/^[A-Za-z0-9._:-]{8,255}$/).optional() },
      }, ({ pack_id, idempotency_key }) => callRemote(client => operation.invoke(client, pack_id, { idempotencyKey: idempotency_key })));
      continue;
    }
    const inputSchema: Record<string, ReturnType<typeof z.string>> = {};
    if (operation.parameter) inputSchema[operation.parameter] = z.string().min(1);
    server.registerTool(operation.name, {
      title: operation.title,
      description: `${operation.title} on the explicitly configured Skills server. Missing server capabilities return an error. Checkout links require external customer confirmation.`,
      inputSchema,
    }, async (input: Record<string, unknown>) => callRemote(client => operation.invoke(client, operation.parameter ? String(input[operation.parameter]) : "")));
  }
  server.registerTool("list_api_keys", {
    title: "List API Keys", description: "List account API keys using fresh email OTP reauthentication.",
    inputSchema: { email: z.string().email(), code: z.string().regex(/^\d{6}$/) },
  }, async ({ email, code }) => {
    try { return mcpJson(await freshAccount("List API keys", (client, context) => client.listApiKeys(email, code, context))); }
    catch { return mcpError("KEY_LIST_FAILED", "Unable to list API keys. Check the selected profile, server, account and fresh verification code."); }
  });
  server.registerTool("revoke_api_key", {
    title: "Revoke API Key", description: "Revoke an account API key using fresh email OTP reauthentication.",
    inputSchema: { key_id: z.string().min(1), email: z.string().email(), code: z.string().regex(/^\d{6}$/) },
  }, async ({ key_id, email, code }) => {
    try { return mcpJson(await freshAccount("Revoke API key", (client, context) => client.revokeApiKey(email, code, key_id, context))); }
    catch { return mcpError("KEY_REVOKE_FAILED", "Unable to revoke this API key. Check the selected profile, key, account and fresh verification code."); }
  });
  server.registerTool("create_api_key", {
    title: "Create API Key", description: "Create an API key using fresh email OTP reauthentication; returns its secret once. A stored API key cannot grant this authority.",
    inputSchema: { name: z.string().min(1), email: z.string().email(), code: z.string().regex(/^\d{6}$/), scopes: z.array(z.string()).optional() },
  }, async ({ name, email, code, scopes }) => {
    const capturedScopes = scopes === undefined ? undefined : [...scopes];
    try { return mcpJson(await freshAccount("Create API key", (client, context) => client.createApiKey(email, code, name, capturedScopes, context))); }
    catch { return mcpError("KEY_CREATION_FAILED", "API key creation could not be confirmed. Check the selected profile and workspace keys before retrying; a lost response may still have created a key."); }
  });
  server.registerTool("quote_skill", {
    title: "Quote Remote Skill", description: "Get the configured server's credit quote without submitting a run.",
    inputSchema: { name: z.string(), input: z.record(z.string(), z.unknown()).optional(), args: z.array(z.string()).optional(),
      files: z.array(z.object({ name: z.string(), base64: z.string().max(1_398_104), contentType: z.string().optional() })).max(10).optional().describe("The same inline files to submit after approval; quoted descriptors bind their exact bytes, names and types.") },
  }, ({ name, input, args, files }) => callRemote(client => {
    const descriptors = describeRemoteFiles(decodeRemoteFiles(files ?? []));
    return client.quoteRun(name, input, args, descriptors.length ? descriptors : undefined);
  }));
  server.registerTool("download_run_artifact", {
    title: "Download Verified Run Artifact", description: "Return verified artifact bytes as base64 (at most 1 MiB); use the CLI for larger files.",
    inputSchema: { run_id: z.string(), artifact_id: z.string() },
  }, ({ run_id, artifact_id }) => callRemote(async client => {
    const artifact = await client.getVerifiedRunArtifact(run_id, artifact_id, 1024 * 1024);
    const { bytes, ...metadata } = artifact;
    return { ...metadata, base64: Buffer.from(bytes).toString("base64") };
  }));
}

function memberError(error: unknown) {
  return error instanceof RemoteWorkspaceMemberError ? mcpError(error.code, error.message)
    : mcpError("WORKSPACE_MEMBER_FAILED", "Unable to manage workspace member. Check the selected server and fresh verification, then refresh the roster before another action.");
}

async function callRemote(action: (client: RemoteSkillsClient) => Promise<unknown>) {
  try {
    const client = await createRemoteSkillsClient();
    if (!client) return mcpError("AUTH_REQUIRED", "Configure a Skills API and sign in with skills auth login");
    return mcpJson(await action(client));
  } catch (error) {
    if (error instanceof RemoteCreditCheckoutError) {
      return { ...mcpJson({ code: error.code, message: error.message, status: error.status,
        requestIdempotencyKey: error.requestIdempotencyKey,
        ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }) }), isError: true };
    }
    if (error instanceof RemoteCapabilityUnavailableError) {
      return { ...mcpJson({ code: error.code, message: error.message, status: error.status }), isError: true };
    }
    return mcpError("REMOTE_REQUEST_FAILED", error instanceof Error ? error.message : "Skills server request failed");
  }
}

/** A named host profile restricts each fresh-auth call to its live key identity.
 * Capture per invocation; never mutate process.env or persist an OTP/JWT. */
async function freshAccount<T>(action: string, operation: (client: RemoteSkillsAuthClient, context?: RemoteWorkspaceContext) => Promise<T>): Promise<T> {
  const target = await captureProfileWorkspace(action);
  target.unchanged();
  return operation(new RemoteSkillsAuthClient(target.origin), target.context);
}
