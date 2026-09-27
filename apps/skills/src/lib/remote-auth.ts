import { requestInvitationEmail, type RequestInvitationEmailChallenge, type AcceptInvitationEmailChallenge } from "./remote-invitation-recovery.js";
import { RemotePrivatePublicationsClient } from "./remote-private-publications.js";
import { invitationInput, type ListRemoteWorkspaceInvitations, type IssueRemoteWorkspaceInvitation,
  type ResendRemoteWorkspaceInvitation, type RevokeRemoteWorkspaceInvitation, type AcceptRemoteWorkspaceInvitation } from "./remote-invitations.js";
import { workspaceLeaveInput, type LeaveRemoteWorkspace } from "./remote-workspace-leave.js";
import { workspaceContext, workspaceExpectedUserId, parseWorkspaceLogin,
  type RemoteWorkspaceContext, type RemoteWorkspaceSession, type RemoteAccountWorkspaceDiscovery } from "./remote-workspace-selection.js";
import { readBoundedResponse } from "./remote-files.js";
import { workspaceMembersQuery, type RemoteWorkspaceMembersOptions } from "./remote-workspace.js";
import { workspaceMemberRoleInput, workspaceMemberRemovalInput, type SetRemoteWorkspaceMemberRole, type RemoveRemoteWorkspaceMember } from "./remote-workspace.js";
import { RemoteSkillsClient } from "./remote-client.js";
import { normalizeSkillsApiOrigin, skillsApiRequestUrl } from "./fleet-credentials.js";
import { customerNamePatch, type UpdateRemoteProfile, type UpdateRemoteWorkspace } from "./remote-profile.js";

const MAX_ERROR_DETAIL_LENGTH = 200;
export class HostedApiError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly detail?: string;
  readonly endpoint?: string;
  readonly apiUrl?: string;

  constructor(
    message: string,
    options: { status?: number; code?: string; detail?: string; endpoint?: string; apiUrl?: string } = {},
  ) {
    super(message);
    this.name = "HostedApiError";
    this.status = options.status;
    this.code = options.code;
    this.detail = options.detail;
    this.endpoint = options.endpoint;
    this.apiUrl = options.apiUrl;
  }
}


async function requestAuthApi(instance: string, path: string, options?: RequestInit) {
  // Throws MissingApiUrlError when nothing is configured. Credentials are never
  // sent to a default host, so the command fails before any request is made.
  const url = normalizeSkillsApiOrigin(instance);
  const safeUrl = url;
  const requestUrl = skillsApiRequestUrl(url, path);
  const endpoint = `${(options?.method || "GET").toUpperCase()} ${requestUrl}`;
  let res: Response;
  try {
    res = await fetch(requestUrl, {
      ...options,
      redirect: "error",
      signal: options?.signal ?? AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
  } catch (err) {
    throw new HostedApiError(`Unable to reach the Skills API: ${(err as Error).message}`, {
      endpoint,
      apiUrl: safeUrl,
    });
  }

  const text = await res.text();
  const body = text ? parseJsonBody(text) : {};
  if (!res.ok) {
    const record = isRecord(body) ? body : {};
    const detail = typeof record.detail === "string" ? record.detail : undefined;
    const error = typeof record.error === "string" ? record.error : undefined;
    const code = typeof record.code === "string" ? record.code : undefined;
    throw new HostedApiError(detail || error || `${res.status} ${res.statusText}`, {
      status: res.status,
      code,
      detail,
      endpoint,
      apiUrl: safeUrl,
    });
  }

  return body as any;
}

function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { detail: condenseErrorBody(text) };
  }
}

// Error bodies are frequently HTML pages from a proxy/CDN rather than API JSON.
// Dumping the raw page hides the real message, so keep a short single-line summary.
function condenseErrorBody(text: string): string {
  const stripped = /<[a-z!/]/i.test(text)
    ? text
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]*>/g, " ")
    : text;
  const collapsed = stripped.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_ERROR_DETAIL_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_ERROR_DETAIL_LENGTH - 1).trimEnd()}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Passwordless auth transport for an explicitly selected instance. It never writes credentials. */
export class RemoteSkillsAuthClient {
  readonly apiOrigin: string;
  constructor(apiUrl: string) { this.apiOrigin = normalizeSkillsApiOrigin(apiUrl); }
  /** One fresh workspace-bound session for an entire publication. No credentials are saved. */
  async openPrivatePublications(email: string, code: string, context: RemoteWorkspaceContext): Promise<RemotePrivatePublicationsClient> {
    const origin = this.apiOrigin, captured = workspaceContext(context);
    return new RemotePrivatePublicationsClient(origin, await this.switchWorkspace(email, code, captured));
  }
  requestInvitationEmailChallenge(input: RequestInvitationEmailChallenge) { return requestInvitationEmail(this.apiOrigin, "challenge", input); }
  acceptInvitationEmailChallenge(input: AcceptInvitationEmailChallenge) { return requestInvitationEmail(this.apiOrigin, "accept", input); }
  requestCode(email: string) { return this.request("/api/auth/login", { method: "POST", body: JSON.stringify({ email }) }); }
  verifyCode(email: string, code: string) { return this.request("/api/auth/verify", { method: "POST", body: JSON.stringify({ email, code }) }); }
  startDevice() { return this.request("/api/auth/device/start", { method: "POST", body: JSON.stringify({ client: "skills-sdk" }) }); }
  pollDevice(deviceCode: string) { return this.request("/api/auth/device/token", { method: "POST", body: JSON.stringify({ deviceCode }) }); }
  private async sessionClient(email: string, code: string, context?: RemoteWorkspaceContext): Promise<RemoteSkillsClient> {
    if (context !== undefined) {
      const target = workspaceContext(context), apiOrigin = this.apiOrigin;
      const session = await this.switchWorkspace(email, code, target);
      return new RemoteSkillsClient(session.token, apiOrigin);
    }
    const apiOrigin = this.apiOrigin;
    if (!email.includes("@") || !/^\d{6}$/.test(code)) throw new Error("Fresh email and six-digit verification code are required to manage this account");
    const login = await this.verifyCode(email, code);
    if (!login || typeof login.token !== "string" || !login.token) throw new Error("The server did not return an authorized account session");
    return new RemoteSkillsClient(login.token, apiOrigin);
  }
  /** Discover memberships with fresh sign-in. No key or session is saved. */
  async listAccountWorkspaces(email: string, code: string, expectedUserId?: string): Promise<RemoteAccountWorkspaceDiscovery> {
    const login = await this.workspaceLogin(email, code, expectedUserId);
    const result = await new RemoteSkillsClient(login.token, login.apiOrigin).listAccountWorkspaces(login.userId);
    return { userId: login.userId, ...result };
  }
  /** Contains a secret session token. Selection never creates or stores an API key. */
  async switchWorkspace(email: string, code: string, context: RemoteWorkspaceContext): Promise<RemoteWorkspaceSession> {
    const target = workspaceContext(context);
    const login = await this.workspaceLogin(email, code, target.userId);
    return new RemoteSkillsClient(login.token, login.apiOrigin).switchWorkspace(target);
  }
  private async workspaceLogin(email: string, code: string, expectedUserId?: string) {
    const expected = expectedUserId === undefined ? undefined : workspaceExpectedUserId(expectedUserId);
    const apiOrigin = this.apiOrigin;
    if (typeof email !== "string" || !email.includes("@") || typeof code !== "string" || !/^\d{6}$/.test(code))
      throw new Error("Fresh email and six-digit verification code are required to manage this account");
    const requestUrl = skillsApiRequestUrl(apiOrigin, "/api/auth/verify");
    let response: Response;
    try {
      response = await fetch(requestUrl, { method: "POST", redirect: "error", credentials: "omit",
        signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code }) });
    } catch { throw new HostedApiError("Unable to verify the Skills account."); }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new HostedApiError("Unable to verify the Skills account.", { status: response.status });
    }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(await readBoundedResponse(response, 64 * 1024))); }
    catch { throw new HostedApiError("The server returned an invalid account verification result."); }
    return { ...parseWorkspaceLogin(value, expected), apiOrigin };
  }
  async listWorkspaceInvitations(email: string, code: string, context: RemoteWorkspaceContext, options: ListRemoteWorkspaceInvitations = {}) {
    const target = workspaceContext(context), captured = invitationInput("list", options);
    return (await this.sessionClient(email, code, target)).listWorkspaceInvitations(target, captured);
  }
  async getWorkspaceInvitation(email: string, code: string, context: RemoteWorkspaceContext, invitationId: string) {
    const target = workspaceContext(context), captured = invitationInput("get", { invitationId });
    return (await this.sessionClient(email, code, target)).getWorkspaceInvitation(target, captured.invitationId);
  }
  async issueWorkspaceInvitation(email: string, code: string, context: RemoteWorkspaceContext, input: IssueRemoteWorkspaceInvitation) {
    const target = workspaceContext(context), captured = invitationInput("issue", input);
    return (await this.sessionClient(email, code, target)).issueWorkspaceInvitation(target, captured);
  }
  async resendWorkspaceInvitation(email: string, code: string, context: RemoteWorkspaceContext, invitationId: string, input: ResendRemoteWorkspaceInvitation) {
    const target = workspaceContext(context), captured = invitationInput("resend", { ...input, invitationId });
    const { invitationId: id, ...options } = captured;
    return (await this.sessionClient(email, code, target)).resendWorkspaceInvitation(target, id, options);
  }
  async revokeWorkspaceInvitation(email: string, code: string, context: RemoteWorkspaceContext, invitationId: string, input: RevokeRemoteWorkspaceInvitation) {
    const target = workspaceContext(context), captured = invitationInput("revoke", { ...input, invitationId });
    const { invitationId: id, ...options } = captured;
    return (await this.sessionClient(email, code, target)).revokeWorkspaceInvitation(target, id, options);
  }
  async acceptWorkspaceInvitation(email: string, code: string, context: RemoteWorkspaceContext, invitationId: string, input: AcceptRemoteWorkspaceInvitation) {
    const target = workspaceContext(context), captured = invitationInput("accept", { ...input, invitationId });
    const { invitationId: id, ...options } = captured;
    return (await this.sessionClient(email, code, target)).acceptWorkspaceInvitation(target, id, options);
  }
  async createApiKey(email: string, code: string, name: string, scopes?: string[], context?: RemoteWorkspaceContext) {
    const capturedScopes = scopes === undefined ? undefined : [...scopes];
    return (await this.sessionClient(email, code, context)).createApiKey(name, capturedScopes);
  }
  async listApiKeys(email: string, code: string, context?: RemoteWorkspaceContext) { return (await this.sessionClient(email, code, context)).listApiKeys(); }
  async revokeApiKey(email: string, code: string, keyId: string, context?: RemoteWorkspaceContext) { return (await this.sessionClient(email, code, context)).revokeApiKey(keyId); }
  /** Reauthentication is ephemeral: it never replaces a saved key or profile. */
  async updateProfile(email: string, code: string, input: UpdateRemoteProfile, context?: RemoteWorkspaceContext) {
    const body = customerNamePatch(input, "displayName");
    return (await this.sessionClient(email, code, context)).updateProfile({ displayName: body.displayName! });
  }
  async updateCurrentWorkspace(email: string, code: string, input: UpdateRemoteWorkspace, context?: RemoteWorkspaceContext) {
    const body = customerNamePatch(input, "name");
    return (await this.sessionClient(email, code, context)).updateCurrentWorkspace({ name: body.name! });
  }
  /** Fresh owner/admin session; explicit context survives default-workspace OTP selection. */
  async listWorkspaceMembers(email: string, code: string, options: RemoteWorkspaceMembersOptions = {}, context?: RemoteWorkspaceContext) {
    workspaceMembersQuery(options);
    const captured = { ...options };
    return (await this.sessionClient(email, code, context)).listWorkspaceMembers(captured);
  }
  async setWorkspaceMemberRole(email: string, code: string, membershipId: string, input: SetRemoteWorkspaceMemberRole, context?: RemoteWorkspaceContext) {
    const captured = workspaceMemberRoleInput(membershipId, input);
    return (await this.sessionClient(email, code, context)).setWorkspaceMemberRole(captured.membershipId, captured.body);
  }
  /** Fresh verification binds the exact observed incarnation before a single confirmed leave. */
  async leaveWorkspace(email: string, code: string, context: RemoteWorkspaceContext, input: LeaveRemoteWorkspace) {
    const captured = workspaceLeaveInput(context, input);
    return (await this.sessionClient(email, code, captured.context)).leaveWorkspace(captured.context, captured.input);
  }
  async removeWorkspaceMember(email: string, code: string, membershipId: string, input: RemoveRemoteWorkspaceMember, context?: RemoteWorkspaceContext) {
    const captured = workspaceMemberRemovalInput(membershipId, input);
    return (await this.sessionClient(email, code, context)).removeWorkspaceMember(captured.membershipId, captured.body);
  }
  /** Common auth transport used by CLI login, preserving the selected instance through awaits. */
  request(path: string, options?: RequestInit) {
    if (!["/api/auth/login", "/api/auth/verify", "/api/auth/device/start", "/api/auth/device/token", "/api/auth/keys", "/api/auth/whoami", "/api/auth/logout"].includes(path)) throw new Error("Unsupported authentication operation");
    return requestAuthApi(this.apiOrigin, path, options);
  }
}
