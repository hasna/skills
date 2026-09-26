import { recurringInput, recurringRequest, recurringFailure, parseRecurringResult, parseRecurringCapability, assertRecurringCapability,
  RemoteRecurringError, RemoteRecurringUnavailableError, RemoteRecurringReadError, RemoteRecurringUnconfirmedError,
  type RecurringAction, type RecurringInputs, type RecurringResults, type RecurringRequest, type RecurringActivation,
  type RecurringListOptions, type RecurringCapability, type RecurringConsentView, type RecurringOccurrenceView, type RecurringPage } from "./remote-recurring.js";
import { invitationInput, invitationRequest, invitationFailure, parseInvitationResult,
  RemoteWorkspaceInvitationError, RemoteWorkspaceInvitationUnconfirmedError, RemoteWorkspaceInvitationReadError,
  type InvitationAction, type InvitationInputs, type InvitationResults, type ListRemoteWorkspaceInvitations,
  type IssueRemoteWorkspaceInvitation, type ResendRemoteWorkspaceInvitation, type RevokeRemoteWorkspaceInvitation, type AcceptRemoteWorkspaceInvitation } from "./remote-invitations.js";
import { workspaceLeaveInput, workspaceLeaveFailure, parseWorkspaceLeaveResult, RemoteWorkspaceLeaveError, RemoteWorkspaceLeaveUnconfirmedError, type LeaveRemoteWorkspace, type RemoteWorkspaceLeaveResult } from "./remote-workspace-leave.js";
import { workspaceContext, parseAccountWorkspaces, parseWorkspaceIdentity, parseWorkspaceSession,
  workspaceSelectionFailure, workspaceSelectionFailures, invalidWorkspaceResult, WorkspaceIdentityMismatchError,
  workspaceExpectedUserId, type RemoteWorkspaceIdentity, type RemoteWorkspaceContext, type RemoteAccountWorkspaces, type RemoteWorkspaceSession, type RemoteWorkspaceSelectionErrorCode } from "./remote-workspace-selection.js";
import { parseWorkspaceMembersPage, workspaceMembersQuery, type RemoteWorkspaceMembersOptions, type RemoteWorkspaceMembersPage } from "./remote-workspace.js";
import { workspaceMemberRoleInput, workspaceMemberRemovalInput, parseWorkspaceMemberRoleResult, parseWorkspaceMemberRemovalResult,
  workspaceMemberFailure, workspaceMemberFailures, invalidMemberResult, type RemoteWorkspaceMemberErrorCode,
  type SetRemoteWorkspaceMemberRole, type RemoveRemoteWorkspaceMember, type RemoteWorkspaceMemberRoleResult, type RemoteWorkspaceMemberRemovalResult } from "./remote-workspace.js";
import { getApiUrl } from "./auth-store.js";
import { normalizeSkillsApiOrigin, skillsApiRequestUrl, resolveSkillsConnection } from "./fleet-credentials.js";
import { normalizeRemoteSkillRunContract, type RemoteSkillRunContract } from "./remote-run-contract.js";
import { creditCount, runQuoteReceipt, parseRemoteBillingStatus, parseRemoteCheckout, parseRemoteCreditPacks, parseRemoteRunQuote, RemoteCreditApprovalError, type RemoteCreditPack, type RemoteRunApproval, type RemoteRunQuote } from "./remote-account.js";
import { describeRemoteFiles, readBoundedResponse, sha256, MAX_REMOTE_FILE_BYTES, type RemoteInputFile, type RemoteInputFileDescriptor } from "./remote-files.js";
import { creditCheckoutFailure, creditCheckoutMessages, creditCheckoutRequestKey, type RemoteCreditCheckout, type RemoteCreditCheckoutOptions, type RemoteCreditCheckoutErrorCode } from "./remote-credit-checkout.js";
import { customerNamePatch, parseUpdatedProfile, parseUpdatedWorkspace, type UpdateRemoteProfile, type UpdateRemoteWorkspace } from "./remote-profile.js";
import { quoteUnavailableMessages, readQuoteUnavailableCode, type RemoteQuoteUnavailableCode } from "./remote-quote-errors.js";
import { parseSkillsAccess, assertSkillsPermission, type RemoteSkillsAccess } from "./remote-permissions.js";
export type { RemoteQuoteUnavailableCode } from "./remote-quote-errors.js";

/**
 * A server that predates this client's pin/tag/incremental-sync routes answered
 * 404/405 for them. The caller must never mistake that for "no pins" or "empty
 * listing" — a silently-empty sync would look like success and drop nothing on
 * the next push. This error is how the version-skew surfaces fail-closed.
 */
export class RemoteRouteUnsupportedError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly instance: string,
  ) {
    super(
      `The configured Skills instance does not support ${path} (HTTP ${status}). ` +
        `The instance at ${instance} predates this client feature — upgrade the server, or ` +
        `use a client version that matches it.`,
    );
    this.name = "RemoteRouteUnsupportedError";
  }
}

/** Any other non-ok response on the new-route methods, with the status attached. */
export class RemoteRequestError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    _statusText?: string,
  ) {
    // HTTP reason phrases are server-controlled, just like response bodies.
    // Keep the optional argument for existing SDK callers without displaying it.
    super(`Remote request to ${path} failed: HTTP ${status}`);
    this.name = "RemoteRequestError";
  }
}

/** A hosted lifecycle refusal with only its bounded, typed error code exposed. */
const KNOWN_SKILL_LIFECYCLE_CODES = new Set(["SKILL_ARCHIVE_PROFILE_CONFLICT", "LIFECYCLE_ROLE_REQUIRED"]);

export class RemoteSkillLifecycleError extends RemoteRequestError {
  readonly code?: string;

  constructor(path: string, status: number, code?: string) {
    super(path, status);
    this.name = "RemoteSkillLifecycleError";
    const safeCode = code !== undefined && KNOWN_SKILL_LIFECYCLE_CODES.has(code) ? code : undefined;
    this.code = safeCode;
    this.message = `Skill lifecycle update was refused (HTTP ${status}${safeCode ? `, code ${safeCode}` : ""})`;
  }
}

/** Bounded checkout outcome; the key is caller-owned, never copied from a server error. */
export class RemoteCreditCheckoutError extends RemoteRequestError {
  constructor(readonly code: RemoteCreditCheckoutErrorCode, status: number,
    readonly requestIdempotencyKey: string, readonly retryAfterSeconds?: number) {
    super("/api/v1/billing/credits", status);
    this.name = "RemoteCreditCheckoutError";
    this.message = creditCheckoutMessages[code];
  }
}

/** A recognized unavailable quote; status compatibility and client-owned copy. */
export class RemoteQuoteUnavailableError extends RemoteRequestError {
  constructor(path: string, readonly code: RemoteQuoteUnavailableCode) {
    super(path, 503);
    if (!Object.hasOwn(quoteUnavailableMessages, code)) throw new Error("Unknown quote refusal code");
    this.name = "RemoteQuoteUnavailableError";
    this.message = quoteUnavailableMessages[code];
  }
}

/** A recognized membership refusal, with fixed text and no server payload. */
export class RemoteWorkspaceMemberError extends RemoteRequestError {
  constructor(path: string, readonly code: RemoteWorkspaceMemberErrorCode) {
    super(path, workspaceMemberFailures[code][0]);
    this.name = "RemoteWorkspaceMemberError";
    this.message = workspaceMemberFailures[code][1];
  }
}

/** Fixed text for recognized workspace refusals; no reflected server error payload. */
export class RemoteWorkspaceSelectionError extends RemoteRequestError {
  constructor(path: string, readonly code: RemoteWorkspaceSelectionErrorCode) {
    super(path, workspaceSelectionFailures[code][0]);
    this.name = "RemoteWorkspaceSelectionError";
    this.message = workspaceSelectionFailures[code][1];
  }
}

/** A recognized unavailable capability; all displayed text is client-owned. */
export class RemoteCapabilityUnavailableError extends RemoteRequestError {
  readonly code = "SUBSCRIPTION_CHECKOUT_UNAVAILABLE" as const;

  constructor() {
    super("/api/v1/billing/checkout", 503);
    this.name = "RemoteCapabilityUnavailableError";
    this.message = "Subscription checkout is unavailable on the configured Skills server. " +
      "Use skills credits packs to view credit packs, or skills billing portal to manage an existing subscription.";
  }
}

/**
 * A remote pin on a skill, matching the hosted-pins wire shape
 * (`{ slug, pinnedAt, metadata }`). `pinnedAt`/`metadata` are server-reported
 * and may be absent.
 */
export interface RemoteSkillVersion {
  slug: string;
  version: string;
  bundleSha256: string;
  bundleByteSize: number;
  storageKind?: string;
  manifest?: Record<string, unknown>;
  createdAt: string;
  current?: boolean;
}

export interface RemotePin {
  slug: string;
  pinnedAt?: string;
  metadata?: Record<string, unknown>;
}

/** The minimal per-skill row the pin/tag/updated-since routes serve. */
export interface RemoteSkillSummary {
  slug: string;
  name?: string;
  version?: string;
  updatedAt?: string;
}

/**
 * One page of an incremental listing. `nextCursor` is an opaque continuation
 * token; null (or an absent field) means the listing is complete.
 */
export interface UpdatedSincePage {
  skills: RemoteSkillSummary[];
  nextCursor: string | null;
}

export class RemoteSkillsClient {
  private apiUrl: string;
  private apiKey: string;
  private capabilities?: Promise<RemoteSkillsAccess & { contractVersion: 1; apiVersion: 1; capabilities: string[]; billing?: { boundedRunApproval?: boolean; unit?: string }; recurringConsents?: RecurringCapability }>;

  constructor(apiKey: string, apiUrl = getApiUrl()) {
    this.apiKey = apiKey;
    this.apiUrl = normalizeSkillsApiOrigin(apiUrl);
  }

  private async request(path: string, options?: RequestInit): Promise<Response> {
    return fetch(skillsApiRequestUrl(this.apiUrl, path), {
      ...options,
      redirect: "error",
      credentials: "omit", // Explicit bearer transport never borrows browser cookie authority.
      signal: options?.signal ?? AbortSignal.timeout(15_000),
      headers: {
        "User-Agent": "hasna-skills",
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
  }

  /**
   * Fail-closed version-skew guard for the pin/tag/updated-since routes.
   *
   * A server that predates these routes answers 404 (unmatched path) or 405
   * (unmatched method). Both are surfaced as `RemoteRouteUnsupportedError` —
   * never as an empty listing, which would read as "no pins / no changes" and
   * silently desynchronize the caller. Every other non-ok response becomes a
   * `RemoteRequestError` carrying the status.
   *
   * `domainNotFoundCodes` is the one deliberate exception: a route the server
   * DOES have can 404 for a domain reason (the hosted-pins DELETE answers
   * `{ code: "PIN_NOT_FOUND" }` when no pin exists). A 404 whose JSON body
   * carries one of those codes is returned to the caller (status intact) so it
   * can apply domain semantics instead of misreporting version skew. Every
   * other 404 — including the dispatcher's `{ code: "NOT_FOUND" }` on a route
   * the server lacks — still throws `RemoteRouteUnsupportedError`.
   */
  private async requestNewRoute(
    path: string,
    options?: RequestInit,
    opts: { domainNotFoundCodes?: string[]; quoteRefusal?: boolean } = {},
  ): Promise<Response> {
    const response = await this.request(path, options);
    // Route identity for the error excludes the query string — the query is
    // caller data (cursor/since), not the route that is missing.
    const routePath = path.split("?")[0];
    if (response.status === 404 || response.status === 405) {
      if (
        response.status === 404 &&
        opts.domainNotFoundCodes?.length &&
        (await responseBodyCarriesCode(response, opts.domainNotFoundCodes))
      ) {
        return response;
      }
      void response.body?.cancel().catch(() => {});
      throw new RemoteRouteUnsupportedError(routePath, response.status, this.apiUrl);
    }
    if (!response.ok) {
      if (opts.quoteRefusal && options?.method === "POST" && /^\/api\/v1\/skills\/[^/?#]+\/quote$/.test(routePath) && response.status === 503) {
        const code = await readQuoteUnavailableCode(response);
        if (code) throw new RemoteQuoteUnavailableError(routePath, code);
      }
      if (path === "/api/v1/billing/checkout" && options?.method === "POST" && response.status === 503 &&
        await responseBodyCarriesCode(response, ["SUBSCRIPTION_CHECKOUT_UNAVAILABLE"])) {
        throw new RemoteCapabilityUnavailableError();
      }
      void response.body?.cancel().catch(() => {});
      throw new RemoteRequestError(routePath, response.status, response.statusText);
    }
    return response;
  }

  async listSkills(): Promise<any[]> {
    return this.arrayResponse("/api/v1/skills");
  }

  async getSkillMd(slug: string): Promise<string | null> {
    const res = await this.request(`/api/v1/skills/${slug}/skill.md`);
    if (!res.ok) return null;
    return res.text();
  }

  async getSkill(slug: string): Promise<any | null> {
    const res = await this.request(`/api/v1/skills/${slug}`);
    if (!res.ok) return null;
    return res.json();
  }

  /**
   * Raw GET for one skill, with the HTTP status surfaced. Used by the reconcile
   * re-check (registry-reconcile.ts) so it can distinguish "no such skill" (404) from
   * "the registry failed to answer" (any other non-success status) instead of treating
   * both as absent.
   */
  async getSkillStatus(slug: string): Promise<{ status: number; body: unknown }> {
    const res = await this.request(`/api/v1/skills/${encodeURIComponent(slug)}`, { method: "GET" });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // A non-JSON body still leaves the status usable.
    }
    return { status: res.status, body };
  }

  /** Low-level admission transport; interactive surfaces use submitQuotedRun. */
  async submitRun(slug: string, input?: Record<string, unknown>, args?: string[], approval: RemoteRunApproval = {}): Promise<RemoteSkillRunContract> {
    const quoteReceipt = runQuoteReceipt(approval.quoteReceipt);
    if (approval.idempotencyKey !== undefined && !/^[A-Za-z0-9._:-]{1,128}$/.test(approval.idempotencyKey)) throw new Error("Idempotency key must be 1-128 URL-safe characters");
    if (approval.maxCostCents !== undefined) creditCount(approval.maxCostCents);
    if (approval.maxCredits !== undefined) creditCount(approval.maxCredits);
    if (approval.maxCredits !== undefined && approval.maxCostCents !== undefined && approval.maxCredits !== approval.maxCostCents) throw new Error("Credit approval fields disagree");
    const res = await this.request(`/api/v1/runs/${encodeURIComponent(slug)}`, {
      method: "POST",
      body: JSON.stringify({ input, args,
        ...(approval.maxCredits !== undefined ? { maxCredits: approval.maxCredits } : {}),
        ...(approval.maxCostCents !== undefined ? { maxCostCents: approval.maxCostCents } : {}),
        ...(approval.idempotencyKey !== undefined ? { idempotencyKey: approval.idempotencyKey } : {}),
        ...(approval.inputFiles !== undefined ? { files: approval.inputFiles } : {}),
        ...(quoteReceipt !== undefined ? { quoteReceipt } : {}),
      }),
    });
    if (!res.ok) {
      void res.body?.cancel().catch(() => {});
      throw new RemoteRequestError(`/api/v1/runs/${encodeURIComponent(slug)}`, res.status);
    }
    return normalizeRemoteSkillRunContract(await res.json(), slug);
  }

  async quoteRun(slug: string, input: Record<string, unknown> = {}, args: string[] = [], files?: RemoteInputFileDescriptor[]): Promise<RemoteRunQuote> {
    const response = await this.requestNewRoute(`/api/v1/skills/${encodeURIComponent(slug)}/quote`, {
      method: "POST", body: JSON.stringify({ input, args, ...(files === undefined ? {} : { files }) }),
    }, { quoteRefusal: true });
    return parseRemoteRunQuote(await response.json());
  }

  getCapabilities(options: { refresh?: boolean } = {}) {
    if (!this.capabilities || options.refresh) this.capabilities = (async () => {
      const response = await this.requestNewRoute("/api/v1/capabilities");
      let value: Record<string, unknown>;
      try {
        value = await response.json() as Record<string, unknown>;
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      } catch { throw new Error("Invalid Skills capability response"); }
      if (value.contractVersion !== 1 || value.apiVersion !== 1 || !Array.isArray(value.capabilities) || value.capabilities.some(item => typeof item !== "string")) throw new Error("Unsupported Skills server capability contract");
      const billing = value.billing as { boundedRunApproval?: boolean; unit?: string } | undefined;
      const recurringConsents = parseRecurringCapability(value.recurringConsents);
      return { contractVersion: 1 as const, apiVersion: 1 as const, capabilities: value.capabilities as string[], ...parseSkillsAccess(value), ...(billing ? { billing } : {}), ...(recurringConsents ? { recurringConsents } : {}) };
    })();
    return this.capabilities;
  }

  /** Add the single supported publication scope to an existing key, metadata only. */
  async addSkillPublishScope(keyId: string, expectedScopes: string[], expectedOrgId: string): Promise<Record<string, unknown>> {
    if (!/^[A-Za-z0-9_-]+$/.test(keyId)) throw new Error("Invalid API key id");
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(expectedOrgId)) throw new Error("Invalid expected organization id");
    if (!Array.isArray(expectedScopes) || expectedScopes.length > 32 || expectedScopes.some((scope) => typeof scope !== "string" || scope.length > 128 || !/^(?:\*|[a-z][a-z0-9_-]*:(?:\*|[a-z][a-z0-9_-]*))$/.test(scope)) || new Set(expectedScopes).size !== expectedScopes.length) throw new Error("Invalid expected API key scopes");
    const path = `/api/v1/admin/keys/${encodeURIComponent(keyId)}/scopes`;
    const response = await this.request(path, { method: "PATCH", body: JSON.stringify({ expected_scopes: expectedScopes, add_scopes: ["skills:publish"] }) });
    if (!response.ok) throw new RemoteRequestError(path, response.status);
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedResponse(response, 64 * 1024))); }
    catch { throw new Error("Invalid API key scope update response"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid API key scope update response");
    const body = value as Record<string, unknown>;
    const returnedId = body.keyId;
    const orgId = body.orgId;
    const scopes = body.scopes;
    if (returnedId !== keyId || typeof orgId !== "string" || !orgId || (expectedOrgId !== undefined && orgId !== expectedOrgId) || !Array.isArray(scopes) || scopes.some((scope) => typeof scope !== "string") || body.updated !== true) {
      throw new Error("Invalid API key scope update response");
    }
    const returnedScopes = scopes as string[];
    const expectedResult = expectedScopes.includes("skills:publish") ? expectedScopes : [...expectedScopes, "skills:publish"];
    if (returnedScopes.length !== expectedResult.length || expectedResult.some((scope, index) => returnedScopes[index] !== scope)) {
      throw new Error("API key scope update response did not preserve the expected scopes");
    }
    return { keyId, orgId, scopes: [...returnedScopes], updated: true };
  }

  /** Quote first and fail closed when the caller has not approved the required credits. */
  async submitQuotedRun(slug: string, input: Record<string, unknown> = {}, args: string[] = [], approval: RemoteRunApproval = {}): Promise<RemoteSkillRunContract> {
    runQuoteReceipt(approval.quoteReceipt);
    // Capture the JSON wire values before any asynchronous quote or capability
    // lookup; callers may mutate their nested input, args or approval meanwhile.
    ({ input, args, approval } = JSON.parse(JSON.stringify({ input, args, approval })));
    const maximum = creditCount(approval.maxCredits ?? approval.maxCostCents ?? 0);
    if (approval.maxCostCents !== undefined && approval.maxCostCents !== maximum) throw new Error("Credit approval fields disagree");
    // A receipt supplied after confirmation must not be replaced by a fresh
    // quote, even when the newly selected version would have the same price.
    const quote = approval.quoteReceipt === undefined ? await this.quoteRun(slug, input, args, approval.inputFiles?.length ? approval.inputFiles : undefined) : undefined;
    if (quote && quote.pricing.costCents > maximum) throw new RemoteCreditApprovalError(quote.pricing.costCents, maximum);
    const capabilities = await this.getCapabilities();
    if (!capabilities.capabilities.includes("runs.submit") || capabilities.billing?.boundedRunApproval !== true || capabilities.billing.unit !== "credits") {
      throw new Error("The configured server does not support bounded credit approval; refusing remote submission");
    }
    return this.submitRun(quote?.skill ?? slug, input, args, { ...approval, maxCredits: maximum, maxCostCents: maximum,
      ...((quote?.quoteReceipt ?? approval.quoteReceipt) === undefined ? {} : { quoteReceipt: quote?.quoteReceipt ?? approval.quoteReceipt }),
    });
  }

  async getIdentity(): Promise<Record<string, unknown>> {
    return (await this.requestNewRoute("/api/auth/whoami")).json();
  }
  /** List memberships with the current interactive session; never writes credentials. */
  async listAccountWorkspaces(expectedUserId?: string): Promise<RemoteAccountWorkspaces> {
    const expected = expectedUserId === undefined ? undefined : workspaceExpectedUserId(expectedUserId);
    const connection = new RemoteSkillsClient(this.apiKey, this.apiUrl);
    let identity: RemoteWorkspaceIdentity | undefined;
    if (expected !== undefined) {
      const value = await connection.requestWorkspaceSelection("/api/auth/whoami");
      if (!value || typeof value !== "object" || (value as Record<string, unknown>).authMethod !== "jwt")
        throw new RemoteWorkspaceSelectionError("/api/v1/account/workspaces", "INTERACTIVE_SESSION_REQUIRED");
      identity = parseWorkspaceIdentity(value, expected);
    }
    const result = parseAccountWorkspaces(await connection.requestWorkspaceSelection("/api/v1/account/workspaces"));
    const current = result.workspaces.find(workspace => workspace.current)!;
    if (identity && (current.membershipId !== identity.user.membershipId || current.organization.id !== identity.organization.id))
      throw new WorkspaceIdentityMismatchError();
    return result;
  }
  /** Return a new ephemeral session; this client and any saved key/profile stay unchanged. */
  async switchWorkspace(context: RemoteWorkspaceContext): Promise<RemoteWorkspaceSession> {
    const target = workspaceContext(context);
    const connection = new RemoteSkillsClient(this.apiKey, this.apiUrl);
    const value = await connection.requestWorkspaceSelection("/api/auth/whoami");
    if (!value || typeof value !== "object" || (value as Record<string, unknown>).authMethod !== "jwt")
      throw new RemoteWorkspaceSelectionError("/api/v1/account/workspaces/switch", "INTERACTIVE_SESSION_REQUIRED");
    parseWorkspaceIdentity(value, target.userId);
    const selected = parseWorkspaceSession(await connection.requestWorkspaceSelection("/api/v1/account/workspaces/switch", {
      method: "POST", body: JSON.stringify({ membershipId: target.membershipId }),
    }), target);
    // Validate the returned token against the server, not merely its adjacent JSON metadata.
    const verified = await new RemoteSkillsClient(selected.token, connection.apiUrl).requestWorkspaceSelection("/api/auth/whoami");
    if (!verified || typeof verified !== "object" || (verified as Record<string, unknown>).authMethod !== "jwt")
      throw new RemoteWorkspaceSelectionError("/api/v1/account/workspaces/switch", "INTERACTIVE_SESSION_REQUIRED");
    const identity = parseWorkspaceIdentity(verified, target.userId);
    if (identity.user.membershipId !== target.membershipId || identity.organization.id !== selected.organization.id)
      throw new WorkspaceIdentityMismatchError();
    return { token: selected.token, ...identity };
  }
  private async requestWorkspaceSelection(path: string, options?: RequestInit): Promise<unknown> {
    let response: Response;
    try { response = await this.request(path, { ...options, credentials: "omit" }); }
    catch { throw new Error("Unable to reach the Skills workspace API."); }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(await readBoundedResponse(response, response.ok ? 1024 * 1024 : 4096))); }
    catch { if (response.ok) throw new Error(invalidWorkspaceResult); }
    if (!response.ok) {
      const code = workspaceSelectionFailure(value, response.status);
      if (code) throw new RemoteWorkspaceSelectionError(path, code);
      if (response.status === 404 || response.status === 405) throw new RemoteRouteUnsupportedError(path, response.status, this.apiUrl);
      throw new RemoteRequestError(path, response.status);
    }
    return value;
  }
  /** Requires a customer session; API keys and support impersonation cannot edit names. */
  async updateProfile(input: UpdateRemoteProfile) {
    const body = customerNamePatch(input, "displayName");
    return parseUpdatedProfile(await (await this.requestNewRoute("/api/v1/account/profile", { method: "PATCH", body: JSON.stringify(body) })).json());
  }
  /** Owner/admin session only; the current workspace identity and slug stay fixed. */
  async updateCurrentWorkspace(input: UpdateRemoteWorkspace) {
    const body = customerNamePatch(input, "name");
    return parseUpdatedWorkspace(await (await this.requestNewRoute("/api/v1/workspaces/current", { method: "PATCH", body: JSON.stringify(body) })).json());
  }
  /** Current owner/admin customer session only; the server refuses API keys and impersonation. */
  async listWorkspaceMembers(options: RemoteWorkspaceMembersOptions = {}): Promise<RemoteWorkspaceMembersPage> {
    const query = workspaceMembersQuery(options);
    const requestedCursor = options.cursor;
    const response = await this.requestNewRoute(`/api/v1/workspace/members${query}`);
    let value: unknown;
    try { value = await response.json(); } catch { throw new Error("The server returned an invalid workspace roster."); }
    const page = parseWorkspaceMembersPage(value);
    if (requestedCursor !== undefined && page.nextCursor === requestedCursor) throw new Error("The server returned an invalid workspace roster.");
    return page;
  }
  /** Exact incarnation and expected role; no refresh or retry. Server enforces current authority. */
  async setWorkspaceMemberRole(membershipId: string, input: SetRemoteWorkspaceMemberRole): Promise<RemoteWorkspaceMemberRoleResult> {
    const captured = workspaceMemberRoleInput(membershipId, input);
    const value = await this.requestWorkspaceMember(captured.membershipId, "PATCH", captured.body);
    return parseWorkspaceMemberRoleResult(value, captured.membershipId, captured.body.role);
  }
  /** Removes only this incarnation. A successful tombstone replay is returned unchanged. */
  async removeWorkspaceMember(membershipId: string, input: RemoveRemoteWorkspaceMember): Promise<RemoteWorkspaceMemberRemovalResult> {
    const captured = workspaceMemberRemovalInput(membershipId, input);
    return parseWorkspaceMemberRemovalResult(await this.requestWorkspaceMember(captured.membershipId, "DELETE", captured.body), captured.membershipId);
  }
  private async requestWorkspaceMember(membershipId: string, method: "PATCH" | "DELETE", body: RemoveRemoteWorkspaceMember | SetRemoteWorkspaceMemberRole): Promise<unknown> {
    const path = `/api/v1/workspace/members/${membershipId}`;
    const response = await this.request(path, { method, body: JSON.stringify(body) });
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(await readBoundedResponse(response, response.ok ? 64 * 1024 : 4096))); }
    catch { if (response.ok) throw new Error(invalidMemberResult); }
    if (!response.ok) {
      const code = workspaceMemberFailure(value, response.status);
      if (code) throw new RemoteWorkspaceMemberError(path, code);
      if (response.status === 404 || response.status === 405) throw new RemoteRouteUnsupportedError(path, response.status, this.apiUrl);
      throw new RemoteRequestError(path, response.status);
    }
    return value;
  }
  /** Leave only the explicitly confirmed current incarnation, once. No credential writes or retries. */
  async leaveWorkspace(context: RemoteWorkspaceContext, input: LeaveRemoteWorkspace): Promise<RemoteWorkspaceLeaveResult> {
    const captured = workspaceLeaveInput(context, input);
    const connection = new RemoteSkillsClient(this.apiKey, this.apiUrl);
    const value = await connection.requestWorkspaceSelection("/api/auth/whoami");
    if (!value || typeof value !== "object" || (value as Record<string, unknown>).authMethod !== "jwt")
      throw new RemoteWorkspaceLeaveError("INTERACTIVE_SESSION_REQUIRED");
    const identity = parseWorkspaceIdentity(value, captured.context.userId);
    if (identity.user.membershipId !== captured.context.membershipId) throw new WorkspaceIdentityMismatchError();
    let response: Response, body: unknown;
    try {
      response = await connection.request("/api/v1/account/workspaces/leave", { method: "POST", body: JSON.stringify(captured.body) });
      body = JSON.parse(new TextDecoder().decode(await readBoundedResponse(response, 4096)));
    } catch { throw new RemoteWorkspaceLeaveUnconfirmedError(); }
    if (!response.ok) {
      const code = workspaceLeaveFailure(body, response.status);
      if (code) throw new RemoteWorkspaceLeaveError(code);
      throw new RemoteWorkspaceLeaveUnconfirmedError();
    }
    return parseWorkspaceLeaveResult(body, captured.context.membershipId, identity.organization.id);
  }
  listWorkspaceInvitations(context: RemoteWorkspaceContext, options: ListRemoteWorkspaceInvitations = {}) {
    return this.requestWorkspaceInvitation(context, "list", options);
  }
  getWorkspaceInvitation(context: RemoteWorkspaceContext, invitationId: string) {
    return this.requestWorkspaceInvitation(context, "get", { invitationId });
  }
  issueWorkspaceInvitation(context: RemoteWorkspaceContext, input: IssueRemoteWorkspaceInvitation) {
    return this.requestWorkspaceInvitation(context, "issue", input);
  }
  resendWorkspaceInvitation(context: RemoteWorkspaceContext, invitationId: string, input: ResendRemoteWorkspaceInvitation) {
    return this.requestWorkspaceInvitation(context, "resend", { ...input, invitationId });
  }
  revokeWorkspaceInvitation(context: RemoteWorkspaceContext, invitationId: string, input: RevokeRemoteWorkspaceInvitation) {
    return this.requestWorkspaceInvitation(context, "revoke", { ...input, invitationId });
  }
  acceptWorkspaceInvitation(context: RemoteWorkspaceContext, invitationId: string, input: AcceptRemoteWorkspaceInvitation) {
    return this.requestWorkspaceInvitation(context, "accept", { ...input, invitationId });
  }
  /** One bounded operation, bound to the observed current incarnation. No retries,
   * key/session persistence or post-acceptance selection of another workspace. */
  private async requestWorkspaceInvitation<A extends InvitationAction>(context: RemoteWorkspaceContext, action: A, input: InvitationInputs[A]): Promise<InvitationResults[A]> {
    const target = workspaceContext(context), captured = invitationInput(action, input);
    const connection = new RemoteSkillsClient(this.apiKey, this.apiUrl);
    const identityValue = await connection.requestWorkspaceSelection("/api/auth/whoami");
    if (!identityValue || typeof identityValue !== "object" || (identityValue as Record<string, unknown>).authMethod !== "jwt")
      throw new RemoteWorkspaceInvitationError("INTERACTIVE_SESSION_REQUIRED");
    const identity = parseWorkspaceIdentity(identityValue, target.userId);
    if (identity.user.membershipId !== target.membershipId) throw new WorkspaceIdentityMismatchError();
    const request = invitationRequest(action, captured), read = action === "list" || action === "get";
    let response: Response, value: unknown;
    try {
      response = await connection.request(request.path, { method: request.method, ...(request.body ? { body: request.body } : {}), credentials: "omit" });
      value = JSON.parse(new TextDecoder().decode(await readBoundedResponse(response, response.ok ? 64 * 1024 : 4096)));
    } catch { throw read ? new RemoteWorkspaceInvitationReadError() : new RemoteWorkspaceInvitationUnconfirmedError(); }
    if (!response.ok) {
      const code = invitationFailure(value, response.status);
      if (code) throw new RemoteWorkspaceInvitationError(code);
      throw read ? new RemoteWorkspaceInvitationReadError() : new RemoteWorkspaceInvitationUnconfirmedError();
    }
    try { return parseInvitationResult(action, value, captured, identity.organization.id); }
    catch { throw read ? new RemoteWorkspaceInvitationReadError() : new RemoteWorkspaceInvitationUnconfirmedError(); }
  }
  previewRecurringConsent(request: RecurringRequest, context?: RemoteWorkspaceContext) {
    return this.requestRecurring("preview", request, context);
  }
  getRecurringDraft(draftId: string, context?: RemoteWorkspaceContext) {
    return this.requestRecurring("draft", { draftId }, context);
  }
  activateRecurringConsent(draftId: string, approval: RecurringActivation, context?: RemoteWorkspaceContext) {
    return this.requestRecurring("activate", { draftId, approval }, context);
  }
  listRecurringConsents(options: RecurringListOptions = {}, context?: RemoteWorkspaceContext) {
    return this.requestRecurring("list", options, context);
  }
  getRecurringConsent(consentId: string, context?: RemoteWorkspaceContext) {
    return this.requestRecurring("get", { consentId }, context);
  }
  listRecurringOccurrences(consentId: string, options: RecurringListOptions = {}, context?: RemoteWorkspaceContext) {
    return this.requestRecurring("occurrences", { ...options, consentId }, context);
  }
  revokeRecurringConsent(consentId: string, context?: RemoteWorkspaceContext) {
    return this.requestRecurring("revoke", { consentId }, context);
  }
  /** One explicit operation on a captured connection. No policy inference,
   * credential persistence, POST retries or replacement idempotency keys. */
  private async requestRecurring<A extends RecurringAction>(action: A, input: RecurringInputs[A], context?: RemoteWorkspaceContext): Promise<RecurringResults[A]> {
    const captured = recurringInput(action, input), target = context === undefined ? undefined : workspaceContext(context);
    const connection = new RemoteSkillsClient(this.apiKey, this.apiUrl);
    let capability: unknown;
    try {
      const response = await connection.request("/api/v1/capabilities");
      if (!response.ok) { await response.body?.cancel(); throw new RemoteRecurringUnavailableError(); }
      capability = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedResponse(response, 64 * 1024)));
      assertRecurringCapability(capability, action);
    } catch { throw new RemoteRecurringUnavailableError(); }
    let identity: RemoteWorkspaceIdentity, identityValue: Record<string, unknown>;
    try {
      const response = await connection.request("/api/auth/whoami");
      if (!response.ok) { await response.body?.cancel(); throw new RemoteRecurringReadError(); }
      identityValue = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedResponse(response, 64 * 1024)));
      const observedUser = (identityValue.user as Record<string, unknown> | undefined)?.id;
      identity = parseWorkspaceIdentity(identityValue, target?.userId ?? workspaceExpectedUserId(observedUser));
      if (target && identity.user.membershipId !== target.membershipId) throw new WorkspaceIdentityMismatchError();
    } catch { throw new RemoteRecurringReadError(); }
    if (action === "activate") {
      // This is only a preflight refusal; metadata never establishes freshness.
      // The original credential still reaches the server's session/SQL verifier.
      if (identityValue.authMethod !== "jwt") throw new RemoteRecurringError("RECURRING_HUMAN_APPROVAL_REQUIRED");
      assertRecurringCapability(capability, "draft");
      const selected = captured as RecurringInputs["activate"];
      const draft = await connection.dispatchRecurring("draft", { draftId: selected.draftId }, identity);
      if (!draft || draft.termsSha256 !== selected.approval.acceptedTermsSha256)
        throw new RemoteRecurringError("RECURRING_TERMS_UNAVAILABLE");
    }
    let selectedConsent: RecurringConsentView | null | undefined;
    if (action === "occurrences") {
      assertRecurringCapability(capability, "get");
      selectedConsent = await connection.dispatchRecurring("get", { consentId: (captured as RecurringInputs["occurrences"]).consentId }, identity);
    }
    const result = await connection.dispatchRecurring(action, captured, identity);
    if (action === "occurrences") {
      const items = (result as RecurringPage<RecurringOccurrenceView>).items;
      if (items.length && (!selectedConsent || items.some(item => item.scheduleId !== selectedConsent.scheduleId)))
        throw new RemoteRecurringReadError();
    }
    return result;
  }
  private async dispatchRecurring<A extends RecurringAction>(action: A, input: RecurringInputs[A], identity: RemoteWorkspaceIdentity): Promise<RecurringResults[A]> {
    const request = recurringRequest(action, input);
    let response: Response, value: unknown;
    try {
      response = await this.request(request.path, { method: request.method, ...(request.body === undefined ? {} : { body: request.body }) });
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedResponse(response,
        response.ok ? action === "list" ? 64 * 1024 * 1024 : 2 * 1024 * 1024 : 4096)));
    } catch { throw request.read ? new RemoteRecurringReadError() : new RemoteRecurringUnconfirmedError(); }
    if (!response.ok) {
      const code = recurringFailure(value, response.status);
      if (code === "RECURRING_NOT_FOUND" && (action === "draft" || action === "get")) return null as RecurringResults[A];
      if (code) throw new RemoteRecurringError(code);
      throw request.read ? new RemoteRecurringReadError() : new RemoteRecurringUnconfirmedError();
    }
    try {
      if (response.status !== 200 || value === null) throw new RemoteRecurringReadError();
      return parseRecurringResult(action, value, input, identity);
    }
    catch { throw request.read ? new RemoteRecurringReadError() : new RemoteRecurringUnconfirmedError(); }
  }
  async listApiKeys(): Promise<Record<string, unknown>[]> { return this.arrayResponse("/api/auth/keys"); }
  async createApiKey(name: string, scopes?: string[]): Promise<{ key: string; [field: string]: unknown }> {
    if (!name.trim() || name.length > 100) throw new Error("API key name must be 1-100 characters");
    const value = await (await this.requestNewRoute("/api/auth/keys", { method: "POST", body: JSON.stringify({ name, ...(scopes ? { scopes } : {}) }) })).json() as { key?: unknown };
    if (!value || typeof value.key !== "string" || !value.key.trim()) throw new Error("The server did not return a created API key");
    return value as { key: string; [field: string]: unknown };
  }
  async revokeApiKey(keyId: string): Promise<Record<string, unknown>> {
    return (await this.requestNewRoute(`/api/auth/keys/${encodeURIComponent(keyId)}`, { method: "DELETE" })).json();
  }

  async getBillingStatus() {
    return parseRemoteBillingStatus(await (await this.requestNewRoute("/api/v1/billing/status")).json());
  }

  async listCreditPacks(): Promise<RemoteCreditPack[]> {
    return parseRemoteCreditPacks(await (await this.requestNewRoute("/api/v1/billing/credits")).json());
  }

  /** One checkout POST. Retain an explicit key before calling to recover even a lost process. */
  async createCreditCheckout(packId: string, options: RemoteCreditCheckoutOptions = {}): Promise<RemoteCreditCheckout> {
    const requestIdempotencyKey = creditCheckoutRequestKey(options.idempotencyKey);
    const packs = await this.listCreditPacks();
    if (!packs.some(pack => pack.id === packId)) throw new Error("Choose a credit pack returned by skills credits packs");
    let response: Response;
    try {
      response = await this.request("/api/v1/billing/credits", {
        method: "POST", body: JSON.stringify({ packId, idempotencyKey: requestIdempotencyKey }),
      });
    } catch {
      throw new RemoteCreditCheckoutError("CREDIT_CHECKOUT_UNCONFIRMED", 0, requestIdempotencyKey);
    }
    if (response.status === 404 || response.status === 405) {
      void response.body?.cancel().catch(() => {});
      throw new RemoteRouteUnsupportedError("/api/v1/billing/credits", response.status, this.apiUrl);
    }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedResponse(response, 4096))); }
    catch { throw new RemoteCreditCheckoutError("CREDIT_CHECKOUT_UNCONFIRMED", response.status, requestIdempotencyKey); }
    if (!response.ok) {
      const failure = creditCheckoutFailure(value, response.status, requestIdempotencyKey);
      throw new RemoteCreditCheckoutError(failure.code, response.status, requestIdempotencyKey, failure.retryAfterSeconds);
    }
    try {
      const checkout = parseRemoteCheckout(value);
      const echo = (value as Record<string, unknown>).requestIdempotencyKey;
      if (echo !== undefined && echo !== requestIdempotencyKey) throw new Error("checkout request key changed");
      return { ...checkout, requestIdempotencyKey };
    } catch { throw new RemoteCreditCheckoutError("CREDIT_CHECKOUT_UNCONFIRMED", response.status, requestIdempotencyKey); }
  }

  async getUsage(): Promise<Record<string, unknown>[]> { return this.arrayResponse("/api/v1/billing/usage"); }
  async listInvoices(): Promise<Record<string, unknown>[]> { return this.arrayResponse("/api/v1/billing/invoices"); }
  async createBillingCheckout(): Promise<{ url: string }> { return this.checkoutResponse("/api/v1/billing/checkout"); }
  async createBillingPortal(): Promise<{ url: string }> { return this.checkoutResponse("/api/v1/billing/portal"); }
  async cancelRun(runId: string): Promise<RemoteSkillRunContract> { return this.controlRun(runId, "cancel"); }
  async resumeRun(runId: string): Promise<RemoteSkillRunContract> { return this.controlRun(runId, "resume"); }

  private async controlRun(runId: string, action: "cancel" | "resume") {
    const response = await this.requestNewRoute(`/api/v1/runs/${encodeURIComponent(runId)}/${action}`, { method: "POST", body: "{}" });
    return normalizeRemoteSkillRunContract(await response.json());
  }

  private async checkoutResponse(path: string) {
    return parseRemoteCheckout(await (await this.requestNewRoute(path, { method: "POST", body: "{}" })).json());
  }

  private async arrayResponse(path: string): Promise<Record<string, unknown>[]> {
    const rows: unknown = await (await this.requestNewRoute(path)).json();
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("Invalid Skills server list response");
    return rows;
  }

  async getRun(runId: string): Promise<RemoteSkillRunContract | null> {
    const path = `/api/v1/runs/${encodeURIComponent(runId)}`;
    const res = await this.request(path);
    if (res.status === 404) return null;
    if (!res.ok) throw new RemoteRequestError(path, res.status, res.statusText);
    return normalizeRemoteSkillRunContract(await res.json());
  }

  async getRunLogs(runId: string): Promise<any[]> {
    return this.arrayResponse(`/api/v1/runs/${encodeURIComponent(runId)}/logs`);
  }

  async listRuns(limit = 20): Promise<any[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Run limit must be an integer from 1 to 100");
    return this.arrayResponse(`/api/v1/runs?limit=${limit}`);
  }

  async getRunArtifacts(runId: string): Promise<any[]> {
    return this.arrayResponse(`/api/v1/runs/${encodeURIComponent(runId)}/artifacts`);
  }

  async downloadRunArtifact(runId: string, artifactId: string): Promise<Response> {
    return this.request(`/api/v1/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}/download`, {
      method: "GET",
    });
  }

  async getVerifiedRunArtifact(runId: string, artifactId: string, maximumBytes = MAX_REMOTE_FILE_BYTES) {
    const artifacts = await this.getRunArtifacts(runId);
    const artifact = artifacts.find(row => row.id === artifactId);
    if (!artifact) throw new Error("Run artifact not found");
    if (!Number.isSafeInteger(artifact.byteSize) || artifact.byteSize < 0 || artifact.byteSize > maximumBytes ||
        typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error("The server does not provide valid artifact integrity metadata");
    const response = await this.downloadRunArtifact(runId, artifactId);
    if (!response.ok) throw new RemoteRequestError("artifact download", response.status, response.statusText);
    const bytes = await readBoundedResponse(response, artifact.byteSize);
    if (bytes.byteLength !== artifact.byteSize || sha256(bytes) !== artifact.sha256) throw new Error("Artifact integrity verification failed");
    return { id: artifactId, fileName: String(artifact.fileName ?? artifactId), bytes, byteSize: bytes.byteLength, sha256: artifact.sha256 };
  }

  async submitQuotedRunWithFiles(slug: string, input: Record<string, unknown>, args: string[], files: RemoteInputFile[], approval: RemoteRunApproval = {}) {
    runQuoteReceipt(approval.quoteReceipt);
    ({ input, args, approval } = JSON.parse(JSON.stringify({ input, args, approval })));
    // Bound the caller's buffers before copying, then derive both the quote and
    // admission descriptors from the owned bytes that will actually be PUT.
    describeRemoteFiles(files);
    files = files.map(file => ({ name: file.name, contentType: file.contentType, bytes: new Uint8Array(file.bytes) }));
    const inputFiles = describeRemoteFiles(files);
    if (files.length && !(await this.getCapabilities()).capabilities.includes("runs.uploads")) throw new Error("The configured server does not support input uploads");
    const run = await this.submitQuotedRun(slug, input, args, { ...approval, inputFiles });
    if (run.error || !run.id || !files.length) return run;
    // A replay may already have advanced beyond the upload phase. Never upload
    // again or cancel completed work just because its upload route now refuses.
    const pastUploads = (status: unknown) => typeof status === "string" && [
      "running", "completed", "failed", "cancelled", "expired", "pending_approval", "approved", "waiting",
    ].includes(status);
    if (pastUploads(run.status)) return run;
    try { await this.uploadRunFiles(run.id, files); }
    catch {
      // Another retry can finish uploads and start the worker after admission
      // returned queued. Re-read before requesting cancellation of that run.
      try {
        const current = await this.getRun(run.id);
        if (current && pastUploads(current.status)) return current;
      } catch {}
      let cancellationRequested = false;
      try { await this.cancelRun(run.id); cancellationRequested = true; } catch {}
      throw new Error(`Input upload failed for run ${run.id}; ${cancellationRequested ? "cancellation requested" : "check its status and cancel the run"}`);
    }
    return run;
  }

  async uploadRunFiles(runId: string, files: RemoteInputFile[]): Promise<void> {
    const descriptors = describeRemoteFiles(files);
    const response = await this.requestNewRoute(`/api/v1/runs/${encodeURIComponent(runId)}/uploads`, { method: "POST", body: JSON.stringify({ files: descriptors }) });
    const payload = await response.json() as { files?: Array<{ name: string; uploadUrl: string; uploadHeaders?: unknown }> };
    if (!Array.isArray(payload.files) || payload.files.length !== files.length || new Set(payload.files.map(file => file.name)).size !== files.length) throw new Error("Invalid input upload response");
    for (const file of files) {
      const upload = payload.files.find(row => row.name === file.name);
      if (!upload) throw new Error("Missing input upload URL");
      const url = new URL(upload.uploadUrl);
      if (url.username || url.password || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("Unsafe input upload URL");
      const headers = new Headers({ "Content-Type": file.contentType ?? "application/octet-stream" });
      if (upload.uploadHeaders !== undefined) {
        if (upload.uploadHeaders === null || typeof upload.uploadHeaders !== "object" || Array.isArray(upload.uploadHeaders)) throw new Error("Invalid input upload headers");
        const seen = new Set<string>();
        for (const [name, value] of Object.entries(upload.uploadHeaders)) {
          const lowerName = name.toLowerCase();
          // The upload response is not allowed to add credentials or override
          // the descriptor's signed content type. Only the conditional-write
          // and retention-tag headers in the upload protocol are accepted.
          if (seen.has(lowerName) || !["if-none-match", "x-amz-tagging"].includes(lowerName) ||
              typeof value !== "string" || value.length === 0 || value.length > 2048 ||
              !/^[\x20-\x7e]+$/.test(value) || value.trim() !== value ||
              (lowerName === "if-none-match" && value !== "*")) throw new Error("Invalid input upload headers");
          seen.add(lowerName);
          headers.set(name, value);
        }
      }
      // Storage receives only file bytes, their type, and declared signed
      // upload headers, never the account credential.
      const uploaded = await fetch(url, { method: "PUT", body: file.bytes as BodyInit, headers, redirect: "error", signal: AbortSignal.timeout(60_000) });
      if (!uploaded.ok) throw new Error("Input upload failed");
      await uploaded.body?.cancel();
    }
  }

  /**
   * Publish a skill to the configured instance.
   *
   * Sent as multipart rather than as JSON with a base64 field. A base64 body would inflate
   * the bundle by a third and would have to pass through the server's JSON reader, whose
   * 1 MB cap exists to keep JSON bodies sane; multipart keeps the tarball on its own path
   * with its own, larger limit.
   *
   * Note the deliberate absence of `request()`: that helper pins
   * `Content-Type: application/json`, and a multipart body whose Content-Type does not
   * carry the generated boundary is unparseable at the other end.
   *
   * Optimistic concurrency (todos d061fcda): pass the revision id this client last read
   * for the slug (from getSkill().revisionId) as `ifMatch`. The instance refuses a
   * publish against a live slug that does not name its current revision with 409 — this
   * is how a push never silently overwrites a newer remote revision.
   */
  async publishSkill(manifest: Record<string, unknown>, bundle?: Uint8Array, ifMatch?: string): Promise<Response> {
    try {
      assertSkillsPermission(await this.getCapabilities({ refresh: true }), "publish");
    } catch (error) {
      // Older instances may predate the capabilities route entirely. Preserve
      // their server-authorized publish path; authentication/transport errors
      // and malformed or explicit permission refusals are never bypassed.
      if (!(error instanceof RemoteRouteUnsupportedError)) throw error;
    }
    const form = new FormData();
    form.set("manifest", JSON.stringify(manifest));
    if (bundle) {
      form.set("bundle", new Blob([bundle as BlobPart], { type: "application/gzip" }), `${String(manifest.slug ?? "skill")}.tar.gz`);
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` };
    if (ifMatch) headers["If-Match"] = ifMatch;
    return fetch(skillsApiRequestUrl(this.apiUrl, "/api/v1/skills"), {
      method: "POST",
      headers,
      body: form,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  }

  async deleteSkill(slug: string): Promise<Response> {
    return this.request(`/api/v1/skills/${encodeURIComponent(slug)}`, { method: "DELETE" });
  }

  async setSkillLifecycle(slug: string, lifecycle: "active" | "archived", options: { reason?: string; replacementSlug?: string; expectedRevisionId: string }): Promise<any> {
    const path = `/api/v1/skills/${encodeURIComponent(slug)}/lifecycle`;
    const response = await this.request(path, {
      method: "PATCH",
      headers: { "If-Match": options.expectedRevisionId },
      body: JSON.stringify({ lifecycle, ...(options.reason ? { reason: options.reason } : {}), ...(options.replacementSlug ? { replacementSlug: options.replacementSlug } : {}) }),
    });
    if (!response.ok) {
      const code = await readResponseCode(response);
      throw new RemoteSkillLifecycleError(path, response.status, code);
    }
    return response.json();
  }

  async downloadSkillBundle(slug: string): Promise<Response> {
    return this.request(`/api/v1/skills/${encodeURIComponent(slug)}/bundle`, { method: "GET" });
  }

  /**
   * Bundle fetch for the verified-pull path. Returns the raw Response so the caller can
   * read the X-Skill-Bundle-Sha256 / X-Skill-Bundle-Signature headers, or null when the
   * instance serves no bundle for this skill (the metadata-only fallback path).
   */
  async getBundle(slug: string, version?: string): Promise<Response | null> {
    const path = version
      ? `/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}/bundle`
      : `/api/v1/skills/${encodeURIComponent(slug)}/bundle`;
    const response = await this.request(path, { method: "GET" });
    if (response.status === 404) return null;
    return response;
  }

  /** Every published version of a slug, newest first (hasna/apps#1630). */
  async listSkillVersions(slug: string): Promise<RemoteSkillVersion[]> {
    const response = await this.requestNewRoute(`/api/v1/skills/${encodeURIComponent(slug)}/versions`, undefined, { domainNotFoundCodes: ["SKILL_NOT_FOUND"] });
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`versions request failed: ${response.status}`);
    const body = await readSkillVersionPayload(response);
    if (!isVersionRecord(body) || !Array.isArray(body.versions) ||
      (body.slug !== undefined && body.slug !== slug)) throw new Error(INVALID_SKILL_VERSION_RESPONSE);
    return body.versions.map(entry => normalizeSkillVersion(entry, slug));
  }

  /** One version's manifest, or null when the slug@version was never published. */
  async getSkillVersion(slug: string, version: string): Promise<RemoteSkillVersion | null> {
    const response = await this.requestNewRoute(`/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`, undefined, { domainNotFoundCodes: ["SKILL_NOT_FOUND", "SKILL_VERSION_NOT_FOUND"] });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`version request failed: ${response.status}`);
    return normalizeSkillVersion(await readSkillVersionPayload(response), slug, version);
  }

  /** List the pins the instance holds for this principal. */
  async listPins(): Promise<RemotePin[]> {
    const response = await this.requestNewRoute("/api/v1/pins");
    return normalizePinList(await response.json());
  }

  /**
   * Pin a skill on the instance (upsert — pinning again refreshes it). The
   * wire contract matches the hosted-pins routes: a PUT with an optional
   * `{ metadata }` body, answered with the stored pin (`slug`, `pinnedAt`,
   * `metadata`).
   */
  async pin(slug: string, metadata?: Record<string, unknown>): Promise<RemotePin> {
    const path = `/api/v1/pins/${encodeURIComponent(slug)}`;
    const response = await this.requestNewRoute(path, {
      method: "PUT",
      body: JSON.stringify({ ...(metadata ? { metadata } : {}) }),
    });
    return normalizePin(await response.json());
  }

  /**
   * Unpin a skill on the instance. Resolves true when a pin existed and was
   * deleted; false when the instance has no pin for this slug (its 404
   * carries `code: "PIN_NOT_FOUND"` — a domain answer, not version skew). A
   * bare 404 (route not deployed) still throws `RemoteRouteUnsupportedError`.
   */
  async unpin(slug: string): Promise<boolean> {
    const path = `/api/v1/pins/${encodeURIComponent(slug)}`;
    const response = await this.requestNewRoute(path, { method: "DELETE" }, { domainNotFoundCodes: ["PIN_NOT_FOUND"] });
    return response.status !== 404;
  }

  /** List the tag names the instance serves. */
  async listTags(): Promise<string[]> {
    const response = await this.requestNewRoute("/api/v1/tags");
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("Remote tags payload did not match the expected contract (expected an array of tag names)");
    }
    // Instances expose either names or counted tag records. Accept one whole
    // contract at a time; filtering malformed or mixed rows would hide drift.
    const isName = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
    if (payload.every(isName)) return payload;
    if (payload.every(tag => tag !== null && typeof tag === "object" && !Array.isArray(tag)
      && isName(tag.name) && Number.isSafeInteger(tag.count) && tag.count >= 0)) {
      return payload.map(tag => tag.name as string);
    }
    throw new Error("Remote tags payload did not match the expected contract (every element must be a non-empty tag name, or every element must be a counted tag record)");
  }

  /** List the skills carrying a tag on the instance. */
  async skillsByTag(tag: string): Promise<RemoteSkillSummary[]> {
    const path = `/api/v1/tags/${encodeURIComponent(tag)}/skills`;
    const response = await this.requestNewRoute(path);
    return normalizeSkillSummaryList(await response.json());
  }

  /**
   * Cursor-based incremental listing of skills updated after `since` (ISO 8601).
   * Each page carries an opaque `nextCursor`; null means the listing is complete.
   * This is the feed T9's sync reconciliation verb consumes.
   */
  async listUpdatedSince(since: string, options: { cursor?: string; limit?: number } = {}): Promise<UpdatedSincePage> {
    const params = new URLSearchParams({ since });
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const response = await this.requestNewRoute(`/api/v1/skills/updated?${params.toString()}`);
    return normalizeUpdatedSincePage(await response.json());
  }
}

/** Present-but-wrong-typed optional fields fail the contract instead of being dropped. */
function requireOptionalString(record: Record<string, unknown>, field: string): string | undefined {
  if (record[field] === undefined) return undefined;
  if (typeof record[field] !== "string") {
    throw new Error(`Remote payload did not match the expected contract (${field} must be a string when present)`);
  }
  return record[field] as string;
}

const INVALID_SKILL_VERSION_RESPONSE = "Remote skill version payload did not match the expected contract.";

function isVersionRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readSkillVersionPayload(response: Response): Promise<unknown> {
  try { return await response.json(); }
  catch { throw new Error(INVALID_SKILL_VERSION_RESPONSE); }
}

/** Validate the shared row without rewriting timestamps or dropping additive server fields. */
function normalizeSkillVersion(entry: unknown, slug: string, version?: string): RemoteSkillVersion {
  if (!isVersionRecord(entry) || typeof entry.slug !== "string" || !entry.slug.trim() || entry.slug !== slug ||
    typeof entry.version !== "string" || !entry.version.trim() || (version !== undefined && entry.version !== version) ||
    typeof entry.bundleSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(entry.bundleSha256) ||
    typeof entry.bundleByteSize !== "number" || !Number.isSafeInteger(entry.bundleByteSize) || entry.bundleByteSize < 0 ||
    typeof entry.createdAt !== "string" || !entry.createdAt.trim() ||
    (entry.current !== undefined && typeof entry.current !== "boolean") ||
    (entry.storageKind !== undefined && typeof entry.storageKind !== "string") ||
    (entry.manifest !== undefined && !isVersionRecord(entry.manifest))) {
    throw new Error(INVALID_SKILL_VERSION_RESPONSE);
  }
  return entry as unknown as RemoteSkillVersion;
}

function normalizePin(entry: unknown): RemotePin {
  if (!entry || typeof entry !== "object") {
    throw new Error("Remote pin payload did not match the expected contract (expected an object)");
  }
  const record = entry as Record<string, unknown>;
  const slug = typeof record.slug === "string" && record.slug.trim() ? record.slug.trim() : undefined;
  if (!slug) {
    throw new Error("Remote pin payload did not match the expected contract (missing slug)");
  }
  let metadata: Record<string, unknown> | undefined;
  if (record.metadata !== undefined) {
    if (!record.metadata || typeof record.metadata !== "object" || Array.isArray(record.metadata)) {
      throw new Error("Remote pin payload did not match the expected contract (metadata must be a JSON object when present)");
    }
    metadata = record.metadata as Record<string, unknown>;
  }
  const pinnedAt = requireOptionalString(record, "pinnedAt");
  return {
    slug,
    ...(pinnedAt !== undefined ? { pinnedAt } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function normalizePinList(payload: unknown): RemotePin[] {
  if (!Array.isArray(payload)) {
    throw new Error("Remote pins payload did not match the expected contract (expected an array of pins)");
  }
  return payload.map(normalizePin);
}

function normalizeSkillSummary(entry: unknown): RemoteSkillSummary {
  if (!entry || typeof entry !== "object") {
    throw new Error("Remote skill payload did not match the expected contract (expected an object)");
  }
  const record = entry as Record<string, unknown>;
  const slug = typeof record.slug === "string" && record.slug.trim() ? record.slug.trim() : undefined;
  if (!slug) {
    throw new Error("Remote skill payload did not match the expected contract (missing slug)");
  }
  return {
    slug,
    ...(requireOptionalString(record, "name") !== undefined ? { name: requireOptionalString(record, "name") } : {}),
    ...(requireOptionalString(record, "version") !== undefined ? { version: requireOptionalString(record, "version") } : {}),
    ...(requireOptionalString(record, "updatedAt") !== undefined ? { updatedAt: requireOptionalString(record, "updatedAt") } : {}),
  };
}

function normalizeSkillSummaryList(payload: unknown): RemoteSkillSummary[] {
  if (!Array.isArray(payload)) {
    throw new Error("Remote skills payload did not match the expected contract (expected an array of skills)");
  }
  return payload.map(normalizeSkillSummary);
}

/** True when a 404's JSON body carries one of the given `code` values. */
async function responseBodyCarriesCode(response: Response, codes: string[]): Promise<boolean> {
  const code = await readResponseCode(response);
  return code !== undefined && codes.includes(code);
}

/** Read only a bounded string `code`; never retain or render a server message/body. */
async function readResponseCode(response: Response): Promise<string | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const maximum = 8 * 1024;
  let deadline: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    deadline = setTimeout(() => reject(new Error("Error response read deadline exceeded")), 1_000);
  });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const next = await Promise.race([reader.read(), expired]);
      if (next.done) break;
      size += next.value.byteLength;
      // Never retain or parse an oversized chunk, even without Content-Length.
      if (size > maximum) return undefined;
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Object.hasOwn(payload, "code")) return undefined;
    const code = (payload as Record<string, unknown>).code;
    return typeof code === "string" && /^[A-Z][A-Z0-9_:-]{0,127}$/.test(code) ? code : undefined;
  } catch {
    // Malformed, oversized, or stalled bodies cannot establish a known code.
    return undefined;
  } finally {
    clearTimeout(deadline!);
    // A broken stream's cancel hook may never settle: do not await it.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function normalizeUpdatedSincePage(payload: unknown): UpdatedSincePage {
  if (!payload || typeof payload !== "object") {
    throw new Error("Updated-since payload did not match the expected contract (expected an object)");
  }
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.skills)) {
    throw new Error("Updated-since payload did not match the expected contract (missing skills array)");
  }
  const skills = record.skills.map(normalizeSkillSummary);
  const nextCursor = record.nextCursor === undefined || record.nextCursor === null ? null : record.nextCursor;
  if (nextCursor !== null && typeof nextCursor !== "string") {
    throw new Error("Updated-since payload did not match the expected contract (nextCursor must be a string or absent)");
  }
  return { skills, nextCursor };
}

/**
 * The client for the configured instance, or null when this install runs on
 * this machine — which is now the explicit local opt-in only
 * (`HASNA_SKILLS_LOCAL=1`); with no credential, no authority and no opt-in the
 * shared ladder throws (fail-closed ruling), so the caller fails loudly instead
 * of quietly reading the bundled corpus while authentication is unconfigured.
 *
 * A configured authority with no credential also throws for the same reason.
 *
 * ASYNC because the credential ladder is: a vault pointer
 * (`HASNA_SKILLS_API_KEY_REF`) is completed through the secrets vault before a
 * client is built, so this never hands `RemoteSkillsClient` an empty key to put
 * behind `Authorization: Bearer `.
 */
export async function createRemoteSkillsClient(
  env: Record<string, string | undefined> = process.env,
): Promise<RemoteSkillsClient | null> {
  const connection = await resolveSkillsConnection(env);
  return connection ? new RemoteSkillsClient(connection.apiKey, connection.apiOrigin) : null;
}

/**
 * Write-free client resolution for read-only paths (e.g. `sync --dry-run`).
 *
 * Identical to createRemoteSkillsClient() now that resolution is the shared
 * ladder, which reads the Keychain and the credentials file per call and writes
 * nothing. Kept as a separate name so read-only callers keep reading as
 * read-only, and so the distinction survives if a write ever creeps back in.
 */
export function createRemoteSkillsClientReadOnly(
  env: Record<string, string | undefined> = process.env,
): Promise<RemoteSkillsClient | null> {
  return createRemoteSkillsClient(env);
}
