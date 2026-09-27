/**
 * @hasna/skills/sdk — the import surface for embedding the skills service.
 *
 * Server/router, registry + version service, run protocol + atomic run services,
 * dispatcher adapters, executor, storage/object-store seams, the cloud-run
 * execution lane (admission, CAS leases, ECS reconciliation), and the run
 * governance controls (privacy, retention, tenancy, cancellation, events,
 * spend ceilings, offline fail-closed). Every module re-exports the shipped
 * implementation with the interface as the contract; nothing here duplicates
 * business logic. The SaaS control plane imports this package directly and
 * never spawns the server binaries.
 *
 * The client credential seam is re-exported too, so an SDK consumer resolves the
 * Skills authority and credential exactly the way the CLI and the MCP server do
 * — the shared @hasna/contracts ladder — instead of reading an environment
 * variable of its own. See lib/fleet-credentials.ts.
 */
export { CloudExecutionClient, type CloudExecution, type CloudEligibility } from "../lib/cloud-executions.js";
export { readExecutionGrantPolicy, saveExecutionGrantPolicy, resolveExecutionGrant } from "../lib/execution-grant-client.js";
export type { ExecutionGrant, ExecutionGrantPolicy, ExecutionGrantRequest, ResolvedExecutionGrant } from "../lib/execution-grants.js";
export { HttpProfileClient, createProfileClient, type ProfileClient, type AuthenticatedProfilePrincipal, type AuthenticatedProfileRole } from "../lib/profile-client.js";
export { inspectSkillSession, reconcileSkillSession, type SessionReconciliationInput, type SessionReconciliationOptions } from "../lib/session-reconciliation.js";
export { resolveSelectedRun, executeSelectedLocal, prepareSelectedSecretBindings, type ResolvedSelectedRun, type SelectedLocalRunOptions } from "../lib/selected-run.js";
export { readSelectedSecretBindings, type SelectedSecretBindings, type SelectedSecretsClient } from "../lib/execution-secrets.js";
export type { SkillSelection, SkillProfile, ResolvedSkillSelection, ResolvedSkillProfile, StationSkillStateInput, StationSkillState } from "../types/skill-selection.js";
export {
  MissingSkillsFleetError,
  SkillsFleetCredentialError,
  SKILLS_API_KEY_ENV,
  SKILLS_API_URL_ENV,
  SKILLS_APP,
  SKILLS_LOCAL_OPT_IN_ENV_KEYS,
  configuredSkillsApiUrl,
  isSkillsLocalOptIn,
  noticeLocalSkillsMode,
  normalizeSkillsApiOrigin,
  requireSkillsApiOrigin,
  requireSkillsFleet,
  resolveSkillsApiOrigin,
  resolveSkillsFleet,
  selectsSkillsLocalMode,
  skillsCredentialFilePath,
  skillsCredentialFiles,
  skillsCredentialOrReason,
  type HostedSkillsFleet,
  type LocalSkillsFleet,
  type SkillsFleet,
  type SkillsFleetErrorCode,
  type SkillsFleetOptions,
} from "../lib/fleet-credentials.js";
export * from "./server.js";
export * from "./registry.js";
export * from "./runs.js";
export * from "./dispatcher.js";
export * from "./executor.js";
export * from "./storage.js";
export * from "./governance.js";
export * from "./governance-store.js";
export * from "./outputs.js";
export * from "./cancel.js";
export * from "./events.js";
export * from "./spend.js";
export * from "./offline.js";
export * from "./execution/index.js";
export { RemoteSkillsClient, createRemoteSkillsClient, RemoteRequestError, RemoteCreditCheckoutError, RemoteRouteUnsupportedError, RemoteCapabilityUnavailableError, RemoteQuoteUnavailableError, RemoteWorkspaceMemberError } from "../lib/remote-client.js";
export { RemoteSkillsPermissionError, type RemoteSkillsAccess, type RemoteSkillsPermissions } from "../lib/remote-permissions.js";
export * from "../lib/remote-recurring-contract.js";
export { RecurringInputError, RemoteRecurringError, RemoteRecurringUnavailableError, RemoteRecurringReadError, RemoteRecurringUnconfirmedError } from "../lib/remote-recurring.js";
export type { RecurringCapability, RecurringListOptions, RemoteRecurringErrorCode } from "../lib/remote-recurring.js";
export { canonicalJson, canonicalJsonSha256 } from "../lib/canonical-json.js";
export type { RemoteQuoteUnavailableCode } from "../lib/remote-client.js";
export { RemoteCreditApprovalError, type RemoteRunApproval, type RemoteRunQuote, type RemoteCreditPack } from "../lib/remote-account.js";
export { type RemoteInputFile, type RemoteInputFileDescriptor } from "../lib/remote-files.js";

export { RemoteSkillsAuthClient, HostedApiError } from "../lib/remote-auth.js";
export type { RemoteWorkspaceMember, RemoteWorkspaceMembersPage, RemoteWorkspaceMembersOptions } from "../lib/remote-workspace.js";
export type { SetRemoteWorkspaceMemberRole, RemoveRemoteWorkspaceMember, RemoteWorkspaceMemberRoleResult, RemoteWorkspaceMemberRemovalResult, RemoteWorkspaceMemberErrorCode } from "../lib/remote-workspace.js";
export type { RemoteCustomerRole, RemoteCustomerProfile, RemoteCurrentWorkspace, UpdateRemoteProfile, UpdateRemoteWorkspace } from "../lib/remote-profile.js";

export type { RemoteWorkspaceContext, RemoteAccountWorkspace, RemoteAccountWorkspaces, RemoteWorkspaceIdentity,
  RemoteWorkspaceSession, RemoteAccountWorkspaceDiscovery, RemoteWorkspaceSelectionErrorCode } from "../lib/remote-workspace-selection.js";
export { WorkspaceContextInputError, WorkspaceIdentityMismatchError } from "../lib/remote-workspace-selection.js";
export { RemoteWorkspaceSelectionError } from "../lib/remote-client.js";

export type { LeaveRemoteWorkspace, RemoteWorkspaceLeaveResult, RemoteWorkspaceLeaveErrorCode } from "../lib/remote-workspace-leave.js";
export { WorkspaceLeaveInputError, RemoteWorkspaceLeaveError, RemoteWorkspaceLeaveUnconfirmedError } from "../lib/remote-workspace-leave.js";

export type { RemoteWorkspaceInvitation, RemoteWorkspaceInvitationsPage, RemoteWorkspaceInvitationResult,
  RemoteWorkspaceInvitationAcceptance, ListRemoteWorkspaceInvitations, IssueRemoteWorkspaceInvitation,
  ResendRemoteWorkspaceInvitation, RevokeRemoteWorkspaceInvitation, AcceptRemoteWorkspaceInvitation, RemoteWorkspaceInvitationErrorCode } from "../lib/remote-invitations.js";
export { WorkspaceInvitationInputError, RemoteWorkspaceInvitationError, RemoteWorkspaceInvitationUnconfirmedError,
  RemoteWorkspaceInvitationReadError } from "../lib/remote-invitations.js";

export { InvitationEmailInputError, RemoteInvitationEmailError, RemoteInvitationEmailUnconfirmedError,
  type RequestInvitationEmailChallenge, type AcceptInvitationEmailChallenge, type RemoteInvitationEmailChallenge,
  type RemoteInvitationEmailAcceptance, type RemoteInvitationEmailErrorCode } from "../lib/remote-invitation-recovery.js";
export { RemotePrivatePublicationsClient, PrivatePublicationError, PRIVATE_PUBLICATION_MAX_BYTES,
  type PrivatePublicationDeclaration, type PrivatePublicationView, type PrivatePublicationState, type PrivatePublishingCapability } from "../lib/remote-private-publications.js";
export { preparePrivatePublication, readPrivatePublicationRecovery, continuePrivatePublication, inspectPrivatePublication,
  type PrivatePublicationRecovery, type PrivatePublicationResult } from "../lib/private-publication-recovery.js";
export { createSkillOperationClient, SkillOperationClientError, SKILL_OPERATION_LIMITS,
  type SkillOperationClient, type SkillOperationTransport, type SkillOperationRequest, type SkillOperationResult,
  type SkillOperationJson, type SkillOperationRefusal, type SkillOperationClientErrorCode } from "./operations.js";

export type { RemoteCreditCheckoutOptions, RemoteCreditCheckout, RemoteCreditCheckoutErrorCode } from "../lib/remote-credit-checkout.js";
