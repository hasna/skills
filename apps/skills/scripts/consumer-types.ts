#!/usr/bin/env bun
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// Check the public distribution against its declared dependencies, independently
// of workspace overrides and skipLibCheck. npm's lifecycle is disabled in the
// inner pack so this can safely run from prepack without recursive builds.
const root = resolve(import.meta.dir, "..");
const workspace = await mkdtemp(join(tmpdir(), "skills-consumer-types-"));
const env = { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
  HOME: workspace, TMPDIR: workspace, NO_COLOR: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  NPM_CONFIG_USERCONFIG: join(workspace, "user.npmrc"), NPM_CONFIG_GLOBALCONFIG: join(workspace, "global.npmrc") };

async function run(command: string[], cwd: string, extraEnv: Record<string, string> = {}) {
  const child = Bun.spawn(command, { cwd, env: { ...env, ...extraEnv }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 120_000);
  try {
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (status !== 0) throw new Error(`Consumer type check command failed (${command[0]}, exit ${status}):\n${stdout.slice(-16_000)}${stderr.slice(-16_000)}`);
    return stdout;
  } finally { clearTimeout(timeout); }
}

try {
  const packed = JSON.parse(await run(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", workspace], root));
  const filename = packed[0]?.filename;
  if (typeof filename !== "string" || filename !== "hasna-skills-" + packed[0]?.version + ".tgz") throw new Error("Unexpected Skills package archive");
  const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const checkedExports = [".", "./storage", "./sdk", "./admin-contract"];
  if (JSON.stringify(Object.keys(metadata.exports).sort()) !== JSON.stringify(checkedExports.sort())) {
    throw new Error("Update the installed consumer fixture to check every public package export.");
  }
  // Deterministic type environment (BUG-0042). `@types/bun` depends on
  // `bun-types`, and bun-types declares `"@types/node": "*"` — a floating range
  // that a cold-cache install inside this throwaway workspace resolves to
  // whatever @types/node the registry offers at that instant. Measured
  // 2026-09-10: bun-types 1.3.14 fails with exactly the publish-guard error
  // (`node_modules/bun-types/globals.d.ts(232,74) TS2694: Namespace
  // '"node:util"' has no exported member 'TextEncoderEncodeIntoResult'`, plus
  // the overrides.d.ts TS2552/TS2304 cluster) whenever @types/node resolves
  // BELOW 25, and passes from 25 up — so a floating resolution turns a
  // type-harness detail into a red publish guard on branches that touch nothing
  // here. Pin every type package explicitly, in devDependencies (a direct
  // install) AND in overrides (no nested `*` copy can shadow it), to the
  // versions this monorepo already builds with (root `overrides`), falling back
  // to the member's declared devDependencies.
  const repoMetadata = JSON.parse(await readFile(join(root, "..", "..", "package.json"), "utf8"));
  const typeOverrides: Record<string, string> = repoMetadata.overrides ?? {};
  const pinnedType = (name: string) => typeOverrides[name] ?? metadata.devDependencies?.[name];
  const typePins: Record<string, string> = {
    "@types/bun": pinnedType("@types/bun"), "bun-types": pinnedType("bun-types"), "@types/node": pinnedType("@types/node"),
  };
  for (const [name, version] of Object.entries(typePins)) {
    if (typeof version !== "string") {
      throw new Error(`Cannot pin the consumer fixture's ${name}: neither the root overrides nor apps/skills devDependencies declare it.`);
    }
  }
  await writeFile(join(workspace, "package.json"), JSON.stringify({ private: true, type: "module",
    dependencies: { "@hasna/skills": `file:${join(workspace, filename)}` },
    devDependencies: { typescript: "5.9.3", ...typePins },
    overrides: typePins,
  }));
  await writeFile(join(workspace, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true,
    skipLibCheck: false, noEmit: true, types: ["bun"], allowSyntheticDefaultImports: true,
  }, files: ["consumer.ts"] }));
  await writeFile(join(workspace, "consumer.ts"), `
import { createRunService, runAdmissionSchema, runTerminalSchema, type SkillsProductStore, RemoteCapabilityUnavailableError, RemoteRequestError } from "@hasna/skills/sdk";
import { RemoteSkillsClient as CheckoutClient, RemoteCreditCheckoutError, type RemoteCreditCheckoutOptions, type RemoteCreditCheckout } from "@hasna/skills/sdk";
import { RemoteCreditCheckoutError as RootCheckoutError, type RemoteCreditCheckoutOptions as RootCheckoutOptions } from "@hasna/skills";
import { planClaudeHookEventsUpdate, planClaudePreToolUseHookUpdate, CLAUDE_COORDINATED_HOOK_EVENTS,
  type ClaudeCoordinatedHookEvent } from "@hasna/skills";
const coordinatedEvents: readonly ClaudeCoordinatedHookEvent[] = CLAUDE_COORDINATED_HOOK_EVENTS;
const coordinatedPlan = planClaudeHookEventsUpdate({ events: coordinatedEvents, expectedSettingsSha256: "absent", replacement: "{}" });
const preToolPlan: typeof coordinatedPlan = planClaudePreToolUseHookUpdate({ expectedSettingsSha256: "absent", replacement: "{}" });
// @ts-expect-error Only supported Claude hook events can be selected.
planClaudeHookEventsUpdate({ events: ["UnknownEvent"], expectedSettingsSha256: "absent", replacement: "{}" });
// @ts-expect-error An exact preimage is required for coordinated settings writes.
planClaudeHookEventsUpdate({ events: ["Stop"], replacement: "{}" });
declare const checkoutClient: CheckoutClient;
const checkoutOptions: RemoteCreditCheckoutOptions = { idempotencyKey: "caller-checkout-001" };
const rootCheckoutOptions: RootCheckoutOptions = checkoutOptions;
const checkout: Promise<RemoteCreditCheckout> = checkoutClient.createCreditCheckout("credits_100", checkoutOptions);
const legacyCheckoutCall: Promise<{ url: string }> = checkoutClient.createCreditCheckout("credits_100");
declare const checkoutError: RemoteCreditCheckoutError;
const sameCheckoutError: RootCheckoutError = checkoutError;
const checkoutRecoveryKey: string = checkoutError.requestIdempotencyKey;
// @ts-expect-error Request keys must be strings.
checkoutClient.createCreditCheckout("credits_100", { idempotencyKey: 123 });
import { inspectSkillSession, reconcileSkillSession, type SessionReconciliationInput, type SessionReconciliationOptions } from "@hasna/skills/sdk";
import { reconcileSkillSession as reconcileFromRoot } from "@hasna/skills";
declare const sessionReconciliation: SessionReconciliationInput;
declare const sessionOptions: SessionReconciliationOptions;
const sessionMetadata: { receiptSha256: string; generation: number; profileId: string } = inspectSkillSession("session", sessionOptions);
const sessionReconciliationResult = reconcileSkillSession(sessionReconciliation, sessionOptions);
const sessionReconciliationFromRoot: typeof reconcileSkillSession = reconcileFromRoot;
import { resolveSelectedRun, executeSelectedLocal, prepareSelectedSecretBindings, readSelectedSecretBindings,
  type ResolvedSelectedRun, type SelectedLocalRunOptions, type SelectedSecretBindings, type SelectedSecretsClient } from "@hasna/skills/sdk";
declare const selectedExecution: ResolvedSelectedRun;
declare const executionBindings: SelectedSecretBindings;
declare const executionVaultClient: SelectedSecretsClient;
const selectedResolution: Promise<ResolvedSelectedRun> = resolveSelectedRun("example@1.0.0", "default");
const bindingTemplate: Promise<SelectedSecretBindings> = prepareSelectedSecretBindings(selectedExecution);
const bindingFile: SelectedSecretBindings = readSelectedSecretBindings("bindings.json");
const localRunOptions: SelectedLocalRunOptions = { secretBindings: executionBindings, createSecretsClient: () => executionVaultClient };
const selectedExecutionResult = executeSelectedLocal(selectedExecution, localRunOptions);
import { readExecutionGrantPolicy, saveExecutionGrantPolicy, resolveExecutionGrant,
  type ExecutionGrant, type ExecutionGrantPolicy, type ExecutionGrantRequest, type ResolvedExecutionGrant } from "@hasna/skills/sdk";
declare const reviewedGrant: ExecutionGrant;
declare const grantRequest: ExecutionGrantRequest;
const policyRead: Promise<ExecutionGrantPolicy> = readExecutionGrantPolicy("default");
const policyUpdate: Promise<ExecutionGrantPolicy> = saveExecutionGrantPolicy("default", [reviewedGrant], "reviewed-revision");
const grantDecision: Promise<ResolvedExecutionGrant> = resolveExecutionGrant(grantRequest);
const sharedRunOptions: SelectedLocalRunOptions = { resolveExecutionGrant, sharedExecutionGrants: true };
// @ts-expect-error Shared local grants do not authorize a cloud execution target.
const unsupportedSharedTarget: ExecutionGrant = { ...reviewedGrant, target: "cloud" };
// @ts-expect-error Shared authorization carries the selected revision and exact digest.
const incompleteSharedRequest: ExecutionGrantRequest = { consumer: executionBindings.consumer };
// @ts-expect-error Only the versioned reference binding contract is accepted.
const unsupportedBinding: SelectedSecretBindings = { ...executionBindings, schema: "unversioned" };
import { RemoteSkillsClient, RemoteSkillsAuthClient, RemoteCapabilityUnavailableError as RootCapabilityError, runSkill } from "@hasna/skills";
import { RemoteSkillsClient as SdkQuoteClient, type RemoteRunQuote, type RemoteRunApproval } from "@hasna/skills/sdk";
import { type RecurringRequest, type RecurringActivation, type RecurringPreview, type RecurringConsentView,
  type RecurringPage, type RecurringOccurrenceView, type RecurringRevocation, type RecurringActivationResult,
  RemoteRecurringUnconfirmedError, canonicalJsonSha256 } from "@hasna/skills/sdk";
declare const recurringRequest: RecurringRequest;
declare const recurringApproval: RecurringActivation;
const recurringClient = new SdkQuoteClient("fixture", "https://skills.example.test");
const recurringPreview: Promise<RecurringPreview> = recurringClient.previewRecurringConsent(recurringRequest);
const recurringDraft: Promise<RecurringPreview | null> = recurringClient.getRecurringDraft("00000000-0000-4000-8000-000000000001");
const recurringActivated: Promise<RecurringActivationResult> = recurringClient.activateRecurringConsent("00000000-0000-4000-8000-000000000001", recurringApproval);
const recurringPage: Promise<RecurringPage<RecurringConsentView>> = recurringClient.listRecurringConsents({ limit: 10 });
const recurringConsent: Promise<RecurringConsentView | null> = recurringClient.getRecurringConsent("00000000-0000-4000-8000-000000000001");
const recurringHistory: Promise<RecurringPage<RecurringOccurrenceView>> = recurringClient.listRecurringOccurrences("00000000-0000-4000-8000-000000000001");
const recurringRevoked: Promise<RecurringRevocation> = recurringClient.revokeRecurringConsent("00000000-0000-4000-8000-000000000001");
const recurringUnknown: true = new RemoteRecurringUnconfirmedError().outcomeUnknown;
const portableHash: string = canonicalJsonSha256({ nested: [1, true] });
// @ts-expect-error Original caller-owned idempotency identity is mandatory.
const recurringMissingKey: RecurringActivation = { contractVersion: 1, acceptedTermsSha256: "a".repeat(64), acceptance: "authorize-recurring-credit-use" };
// @ts-expect-error A client boolean is not fresh human authority.
const recurringForgedAuthority: RecurringActivation = { ...recurringApproval, human: true };

import type { RemoteRunQuote as RootRunQuote, RemoteRunApproval as RootRunApproval } from "@hasna/skills";
declare const receiptQuote: RemoteRunQuote;
const opaqueReceipt: string | undefined = receiptQuote.quoteReceipt;
const rootReceiptQuote: RootRunQuote = receiptQuote;
const receiptApproval: RemoteRunApproval = { maxCredits: 3, quoteReceipt: opaqueReceipt };
const rootReceiptApproval: RootRunApproval = receiptApproval;
const fileQuote: Promise<RemoteRunQuote> = new SdkQuoteClient("fixture", "https://skills.example.com").quoteRun("fixture", {}, [], [{ name: "input.txt", sizeBytes: 1, sha256: "a".repeat(64), contentType: "text/plain" }]);
// @ts-expect-error Receipts remain opaque strings, never numbers or untyped values.
const invalidReceipt: RemoteRunApproval = { quoteReceipt: 3 };
// @ts-expect-error Optional receipt presence does not make it a required string.
const missingReceiptGuard: string = receiptQuote.quoteReceipt;
import type { PrivatePublishingCapability as SdkPublicationCapability } from "@hasna/skills/sdk";
import type { PrivatePublishingCapability as RootPublicationCapability } from "@hasna/skills";
declare const observedPublicationCapability: SdkPublicationCapability;
const enabledPublicationCapability: SdkPublicationCapability = { ...observedPublicationCapability, executionEnabled: true };
const disabledPublicationCapability: RootPublicationCapability = { ...enabledPublicationCapability, executionEnabled: false };
const serverExecutionEnabled: boolean = disabledPublicationCapability.executionEnabled;
import type { PrivatePublicationResult as SdkPublicationResult } from "@hasna/skills/sdk";
import type { PrivatePublicationResult as RootPublicationResult } from "@hasna/skills";
declare const publicationResult: SdkPublicationResult;
const unknownPublicationExecution: RootPublicationResult = { ...publicationResult, executionEnabled: null };
const observedPublicationExecution: SdkPublicationResult = { ...publicationResult, executionEnabled: true };
const recoveryExecution: boolean | null = publicationResult.executionEnabled;
// @ts-expect-error Recovery capability requires a null guard before treating it as boolean.
const unguardedRecoveryExecution: boolean = publicationResult.executionEnabled;
// @ts-expect-error Execution capability must be a boolean, not a truthy string.
const malformedPublicationCapability: SdkPublicationCapability = { ...observedPublicationCapability, executionEnabled: "true" };
// @ts-expect-error Server execution capability is no longer fixed to false.
const falseOnlyPublicationCapability: false = observedPublicationCapability.executionEnabled;
import { RemoteQuoteUnavailableError, type RemoteQuoteUnavailableCode } from "@hasna/skills/sdk";
import { RemoteQuoteUnavailableError as RootQuoteUnavailableError, type RemoteQuoteUnavailableCode as RootQuoteCode } from "@hasna/skills";
import { SKILLS_NATIVE_STORAGE_ENV, type SkillsNativeStorageConfig } from "@hasna/skills/storage";
import { SkillsAdminSetUserRoleRequestSchema, SkillsAdminSuspendOrganizationRequestSchema,
  SkillsAdminResumeOrganizationRequestSchema, SkillsAdminListUsersResponseSchema,
  SkillsAdminShowOrganizationResponseSchema, SkillsAdminSetUserRoleResponseSchema } from "@hasna/skills/admin-contract";
import { inspectSkillBundle, packSkillBundle, SKILL_BUNDLE_INSPECTION_LIMITS, SkillBundleInspectionError,
  type InspectSkillBundleOptions, type InspectedSkillBundle, type SkillBundleEntry, type OwnedBytes } from "@hasna/skills/sdk";
const inspectionOptions: InspectSkillBundleOptions = { limits: { entries: 1, timeoutMs: 1000 }, signal: new AbortController().signal };
const inspection: Promise<InspectedSkillBundle> = inspectSkillBundle(new Uint8Array(), inspectionOptions);
const packedBundle = packSkillBundle("fixture", { maxUnpackedBytes: 1024 });
const packedBody: OwnedBytes = packedBundle.bytes;
declare const inspected: InspectedSkillBundle;
const inspectedEntry: SkillBundleEntry | undefined = inspected.entries[0];
const ownedBody: ArrayBuffer | undefined = inspectedEntry?.bytes.buffer;
const inspectionCode: "BUNDLE_INVALID" | "BUNDLE_LIMIT" | "BUNDLE_ABORTED" | "BUNDLE_TIMEOUT" = new SkillBundleInspectionError("BUNDLE_INVALID", "fixture").code;
// @ts-expect-error Inspection is asynchronous; partial entries never escape.
const partialInspection: InspectedSkillBundle = inspection;
// @ts-expect-error Finite limits are numeric, never an off switch.
const disabledInspection: InspectSkillBundleOptions = { limits: { decompressedBytes: false } };
// @ts-expect-error Hard ceilings are immutable.
SKILL_BUNDLE_INSPECTION_LIMITS.entries = 0;
import { computeContentHashFromEntries, verifyContentHashFromEntries, CONTENT_HASH_LIMITS, ContentHashInputError,
  revisionIdOf, type ContentHashOptions, type ContentHashVerification, type RevisionContent } from "@hasna/skills/sdk";
import { computeContentHashFromEntries as rootEntryHash, verifyContentHashFromEntries as rootEntryVerify,
  ContentHashInputError as RootHashError, revisionIdOf as rootRevision, type RevisionContent as RootRevisionContent } from "@hasna/skills";
const hashOptions: ContentHashOptions = { limits: { rawBytes: 1024, normalizedBytes: 1024, manifestDepth: 8 }, signal: new AbortController().signal };
const entryDigest: Promise<string> = computeContentHashFromEntries(inspected.entries, hashOptions);
const rootDigest: Promise<string> = rootEntryHash(inspected.entries, hashOptions);
const entryVerification: Promise<ContentHashVerification> = verifyContentHashFromEntries(inspected.entries);
const rootVerification: Promise<ContentHashVerification> = rootEntryVerify(inspected.entries);
const revisionContent: RevisionContent = { slug: "fixture", displayName: "Fixture", description: "Fixture", category: "Development", tags: [], source: "private", kind: "instruction" };
const rootRevisionContent: RootRevisionContent = revisionContent;
const revision: string = revisionIdOf(revisionContent);
const rootRevisionIdentity: string = rootRevision(rootRevisionContent);
const contentCode: "CONTENT_HASH_INVALID" | "CONTENT_HASH_LIMIT" | "CONTENT_HASH_ABORTED" | "CONTENT_HASH_TIMEOUT" = new ContentHashInputError("CONTENT_HASH_LIMIT", "fixture").code;
const rootContentCode: typeof contentCode = new RootHashError("CONTENT_HASH_LIMIT", "fixture").code;
// @ts-expect-error Hashing yields a promise, never a synchronous digest or any.
const synchronousHash: string = entryDigest;
// @ts-expect-error Root inference must retain the digest type.
const numericHash: Promise<number> = rootEntryHash(inspected.entries);
// @ts-expect-error Verification is a typed result, not a digest or any.
const wrongVerification: Promise<string> = entryVerification;
// @ts-expect-error Hard ceilings cannot be disabled.
const disabledContentHash: ContentHashOptions = { limits: { rawBytes: false } };
// @ts-expect-error Caller-supplied manifests cannot substitute for the captured entry.
verifyContentHashFromEntries(inspected.entries, { manifest: {} });
// @ts-expect-error Hard ceilings are immutable.
CONTENT_HASH_LIMITS.entries = 0;
// @ts-expect-error Revision tags retain their declared ordered array type.
revisionIdOf({ ...revisionContent, tags: "unordered" });
// @ts-expect-error Root revision declarations cannot silently lose required fields.
rootRevision({ slug: "fixture" });
declare const store: SkillsProductStore;
// Only compiled, never executed: preserve the existing modes and check the
// additive streaming option through actual installed declarations.
const streamOptions: Parameters<typeof runSkill>[2] = { stdio: "stderr" };
const inheritedOptions: Parameters<typeof runSkill>[2] = { stdio: "inherit" };
const capturedOptions: Parameters<typeof runSkill>[2] = { stdio: "pipe" };
// @ts-expect-error A misspelled mode must not silently become any.
const invalidStreamOptions: Parameters<typeof runSkill>[2] = { stdio: "stderr-buffered" };
const service = createRunService({ store });
const admission = runAdmissionSchema.parse({});
const version: 1 = admission.contractVersion;
const status: "admitted" = admission.status;
const terminal = runTerminalSchema.parse({});
const terminalStatus: "succeeded" | "failed" | "cancelled" | "expired" = terminal.status;
// These directives also catch accidental loss of inference to any.
// @ts-expect-error A validated run cannot have a different protocol version.
const wrongVersion: 2 = admission.contractVersion;
// @ts-expect-error Admission does not produce a terminal state.
const wrongStatus: "succeeded" = admission.status;
const client = new RemoteSkillsClient("fixture", "https://skills.example.com/api/v1");
const auth = new RemoteSkillsAuthClient("https://skills.example.com/api/v1");
const workspaceContext: import("@hasna/skills/sdk").RemoteWorkspaceContext = { userId: "observed-user", membershipId: "observed-membership" };
const rootWorkspaceContext: import("@hasna/skills").RemoteWorkspaceContext = workspaceContext;
client.listAccountWorkspaces();
client.switchWorkspace(workspaceContext);
auth.listAccountWorkspaces("reader@example.test", "000000", workspaceContext.userId);
auth.switchWorkspace("reader@example.test", "000000", workspaceContext);
auth.updateCurrentWorkspace("reader@example.test", "000000", { name: "Selected" }, workspaceContext);
auth.listWorkspaceMembers("reader@example.test", "000000", { limit: 1 }, workspaceContext);
auth.createApiKey("reader@example.test", "000000", "selected", ["skills:read"], workspaceContext);
import * as InvRoot from "@hasna/skills";
const invitationListRoot: InvRoot.ListRemoteWorkspaceInvitations = { after: "observed-cursor" };
const invitationIssueRoot: InvRoot.IssueRemoteWorkspaceInvitation = { email: "recipient@example.test", role: "viewer", idempotencyKey: "stable-key", confirm: true };
const invitationResendRoot: InvRoot.ResendRemoteWorkspaceInvitation = { expectedGeneration: 1, idempotencyKey: "stable-key", confirm: true };
const invitationRevokeRoot: InvRoot.RevokeRemoteWorkspaceInvitation = { expectedGeneration: 1, confirm: true };
const invitationAcceptRoot: InvRoot.AcceptRemoteWorkspaceInvitation = { token: "secret-input-only", confirm: true };
declare const invitationRoot: InvRoot.RemoteWorkspaceInvitation;
declare const invitationPageRoot: InvRoot.RemoteWorkspaceInvitationsPage;
declare const invitationResultRoot: InvRoot.RemoteWorkspaceInvitationResult;
declare const invitationAcceptedRoot: InvRoot.RemoteWorkspaceInvitationAcceptance;
const invitationErrorCodeRoot: InvRoot.RemoteWorkspaceInvitationErrorCode = "INVITATION_FORBIDDEN";
new InvRoot.RemoteWorkspaceInvitationError(invitationErrorCodeRoot);
new InvRoot.WorkspaceInvitationInputError(); new InvRoot.RemoteWorkspaceInvitationReadError(); new InvRoot.RemoteWorkspaceInvitationUnconfirmedError();
const invitationClientRoot = new InvRoot.RemoteSkillsClient("fixture", "https://skills.example.com/api/v1");
const invitationAuthRoot = new InvRoot.RemoteSkillsAuthClient("https://skills.example.com/api/v1");
invitationClientRoot.listWorkspaceInvitations(workspaceContext, invitationListRoot);
invitationClientRoot.getWorkspaceInvitation(workspaceContext, "observed-invitation");
invitationClientRoot.issueWorkspaceInvitation(workspaceContext, invitationIssueRoot);
invitationClientRoot.resendWorkspaceInvitation(workspaceContext, "observed-invitation", invitationResendRoot);
invitationClientRoot.revokeWorkspaceInvitation(workspaceContext, "observed-invitation", invitationRevokeRoot);
invitationClientRoot.acceptWorkspaceInvitation(workspaceContext, "observed-invitation", invitationAcceptRoot);
invitationAuthRoot.listWorkspaceInvitations("reader@example.test", "000000", workspaceContext, invitationListRoot);
invitationAuthRoot.getWorkspaceInvitation("reader@example.test", "000000", workspaceContext, "observed-invitation");
invitationAuthRoot.issueWorkspaceInvitation("reader@example.test", "000000", workspaceContext, invitationIssueRoot);
invitationAuthRoot.resendWorkspaceInvitation("reader@example.test", "000000", workspaceContext, "observed-invitation", invitationResendRoot);
invitationAuthRoot.revokeWorkspaceInvitation("reader@example.test", "000000", workspaceContext, "observed-invitation", invitationRevokeRoot);
invitationAuthRoot.acceptWorkspaceInvitation("reader@example.test", "000000", workspaceContext, "observed-invitation", invitationAcceptRoot);
const invitationRoleRoot: "owner" | "admin" | "member" | "viewer" = invitationRoot.role;
const invitationStatusRoot: "queued" | "sending" | "uncertain" | "provider_accepted" | "failed" | "cancelled" = invitationRoot.delivery.state;
const invitationChangedRoot: boolean = invitationResultRoot.changed;
const invitationAcceptedFlagRoot: true = invitationAcceptedRoot.accepted;
// @ts-expect-error Confirmation cannot degrade to optional or any.
invitationClientRoot.issueWorkspaceInvitation(workspaceContext, { email: "recipient@example.test", role: "member", idempotencyKey: "stable-key" });
// @ts-expect-error Expected generation is numeric.
const wrongInvitationGenerationRoot: string = invitationRoot.generation;
// @ts-expect-error A projection never returns the acceptance secret.
const exposedInvitationTokenRoot: string = invitationRoot.token;
// @ts-expect-error Pagination retains useful item types.
const wrongInvitationIdRoot: number = invitationPageRoot.invitations[0]!.id;
// @ts-expect-error Accepted flag is a literal true.
const wrongInvitationAcceptedRoot: false = invitationAcceptedRoot.accepted;
// @ts-expect-error Error codes are closed.
const wrongInvitationCodeRoot: InvRoot.RemoteWorkspaceInvitationErrorCode = "UNKNOWN";

import * as InvSdk from "@hasna/skills/sdk";
const invitationListSdk: InvSdk.ListRemoteWorkspaceInvitations = { after: "observed-cursor" };
const invitationIssueSdk: InvSdk.IssueRemoteWorkspaceInvitation = { email: "recipient@example.test", role: "viewer", idempotencyKey: "stable-key", confirm: true };
const invitationResendSdk: InvSdk.ResendRemoteWorkspaceInvitation = { expectedGeneration: 1, idempotencyKey: "stable-key", confirm: true };
const invitationRevokeSdk: InvSdk.RevokeRemoteWorkspaceInvitation = { expectedGeneration: 1, confirm: true };
const invitationAcceptSdk: InvSdk.AcceptRemoteWorkspaceInvitation = { token: "secret-input-only", confirm: true };
declare const invitationSdk: InvSdk.RemoteWorkspaceInvitation;
declare const invitationPageSdk: InvSdk.RemoteWorkspaceInvitationsPage;
declare const invitationResultSdk: InvSdk.RemoteWorkspaceInvitationResult;
declare const invitationAcceptedSdk: InvSdk.RemoteWorkspaceInvitationAcceptance;
const invitationErrorCodeSdk: InvSdk.RemoteWorkspaceInvitationErrorCode = "INVITATION_FORBIDDEN";
new InvSdk.RemoteWorkspaceInvitationError(invitationErrorCodeSdk);
new InvSdk.WorkspaceInvitationInputError(); new InvSdk.RemoteWorkspaceInvitationReadError(); new InvSdk.RemoteWorkspaceInvitationUnconfirmedError();
const invitationClientSdk = new InvSdk.RemoteSkillsClient("fixture", "https://skills.example.com/api/v1");
const invitationAuthSdk = new InvSdk.RemoteSkillsAuthClient("https://skills.example.com/api/v1");
invitationClientSdk.listWorkspaceInvitations(workspaceContext, invitationListSdk);
invitationClientSdk.getWorkspaceInvitation(workspaceContext, "observed-invitation");
invitationClientSdk.issueWorkspaceInvitation(workspaceContext, invitationIssueSdk);
invitationClientSdk.resendWorkspaceInvitation(workspaceContext, "observed-invitation", invitationResendSdk);
invitationClientSdk.revokeWorkspaceInvitation(workspaceContext, "observed-invitation", invitationRevokeSdk);
invitationClientSdk.acceptWorkspaceInvitation(workspaceContext, "observed-invitation", invitationAcceptSdk);
invitationAuthSdk.listWorkspaceInvitations("reader@example.test", "000000", workspaceContext, invitationListSdk);
invitationAuthSdk.getWorkspaceInvitation("reader@example.test", "000000", workspaceContext, "observed-invitation");
invitationAuthSdk.issueWorkspaceInvitation("reader@example.test", "000000", workspaceContext, invitationIssueSdk);
invitationAuthSdk.resendWorkspaceInvitation("reader@example.test", "000000", workspaceContext, "observed-invitation", invitationResendSdk);
invitationAuthSdk.revokeWorkspaceInvitation("reader@example.test", "000000", workspaceContext, "observed-invitation", invitationRevokeSdk);
invitationAuthSdk.acceptWorkspaceInvitation("reader@example.test", "000000", workspaceContext, "observed-invitation", invitationAcceptSdk);
const invitationRoleSdk: "owner" | "admin" | "member" | "viewer" = invitationSdk.role;
const invitationStatusSdk: "queued" | "sending" | "uncertain" | "provider_accepted" | "failed" | "cancelled" = invitationSdk.delivery.state;
const invitationChangedSdk: boolean = invitationResultSdk.changed;
const invitationAcceptedFlagSdk: true = invitationAcceptedSdk.accepted;
// @ts-expect-error Confirmation cannot degrade to optional or any.
invitationClientSdk.issueWorkspaceInvitation(workspaceContext, { email: "recipient@example.test", role: "member", idempotencyKey: "stable-key" });
// @ts-expect-error Expected generation is numeric.
const wrongInvitationGenerationSdk: string = invitationSdk.generation;
// @ts-expect-error A projection never returns the acceptance secret.
const exposedInvitationTokenSdk: string = invitationSdk.token;
// @ts-expect-error Pagination retains useful item types.
const wrongInvitationIdSdk: number = invitationPageSdk.invitations[0]!.id;
// @ts-expect-error Accepted flag is a literal true.
const wrongInvitationAcceptedSdk: false = invitationAcceptedSdk.accepted;
// @ts-expect-error Error codes are closed.
const wrongInvitationCodeSdk: InvSdk.RemoteWorkspaceInvitationErrorCode = "UNKNOWN";

import * as RecoveryRoot from "@hasna/skills";
const recoveryChallengeRoot: RecoveryRoot.RequestInvitationEmailChallenge = { invitationId: "observed-invitation", challengeId: "retained-challenge", token: "secret-input-only", confirm: true };
const recoveryAcceptRoot: RecoveryRoot.AcceptInvitationEmailChallenge = { ...recoveryChallengeRoot, code: "000000" };
const recoveryClientRoot = new RecoveryRoot.RemoteSkillsAuthClient("https://skills.example.com/api/v1");
const recoveryRequestedRoot: Promise<RecoveryRoot.RemoteInvitationEmailChallenge> = recoveryClientRoot.requestInvitationEmailChallenge(recoveryChallengeRoot);
const recoveryAcceptedRoot: Promise<RecoveryRoot.RemoteInvitationEmailAcceptance> = recoveryClientRoot.acceptInvitationEmailChallenge(recoveryAcceptRoot);
declare const recoveryChallengeResultRoot: Awaited<typeof recoveryRequestedRoot>;
declare const recoveryAcceptResultRoot: Awaited<typeof recoveryAcceptedRoot>;
const recoveryTtlRoot: 600 = recoveryChallengeResultRoot.expiresIn;
const recoverySignInRoot: true = recoveryAcceptResultRoot.signInRequired;
const recoveryErrorCodeRoot: RecoveryRoot.RemoteInvitationEmailErrorCode = "INVITATION_PROOF_UNAVAILABLE";
new RecoveryRoot.RemoteInvitationEmailError(recoveryErrorCodeRoot);
new RecoveryRoot.InvitationEmailInputError(); new RecoveryRoot.RemoteInvitationEmailUnconfirmedError("accept");
// @ts-expect-error Recovery confirmation is mandatory, not any.
recoveryClientRoot.requestInvitationEmailChallenge({ invitationId: "id", challengeId: "id", token: "secret" });
// @ts-expect-error Accept needs fresh code proof, not only challenge possession.
recoveryClientRoot.acceptInvitationEmailChallenge(recoveryChallengeRoot);
// @ts-expect-error The safe challenge projection never exposes an OTP.
const recoveryCodeLeakRoot: string = recoveryChallengeResultRoot.code;
// @ts-expect-error The accepted result never creates a session token.
const recoveryTokenLeakRoot: string = recoveryAcceptResultRoot.token;
// @ts-expect-error TTL remains a concrete literal, not any.
const recoveryWrongTtlRoot: 1 = recoveryChallengeResultRoot.expiresIn;
// @ts-expect-error Accepted sign-in requirement is literal true.
const recoveryWrongSignInRoot: false = recoveryAcceptResultRoot.signInRequired;
// @ts-expect-error Error codes are a closed union.
const recoveryWrongCodeRoot: RecoveryRoot.RemoteInvitationEmailErrorCode = "UNKNOWN";
// @ts-expect-error A membership ID must retain string inference.
const recoveryWrongMembershipRoot: number = recoveryAcceptResultRoot.membershipId;

import * as RecoverySdk from "@hasna/skills/sdk";
const recoveryChallengeSdk: RecoverySdk.RequestInvitationEmailChallenge = { invitationId: "observed-invitation", challengeId: "retained-challenge", token: "secret-input-only", confirm: true };
const recoveryAcceptSdk: RecoverySdk.AcceptInvitationEmailChallenge = { ...recoveryChallengeSdk, code: "000000" };
const recoveryClientSdk = new RecoverySdk.RemoteSkillsAuthClient("https://skills.example.com/api/v1");
const recoveryRequestedSdk: Promise<RecoverySdk.RemoteInvitationEmailChallenge> = recoveryClientSdk.requestInvitationEmailChallenge(recoveryChallengeSdk);
const recoveryAcceptedSdk: Promise<RecoverySdk.RemoteInvitationEmailAcceptance> = recoveryClientSdk.acceptInvitationEmailChallenge(recoveryAcceptSdk);
declare const recoveryChallengeResultSdk: Awaited<typeof recoveryRequestedSdk>;
declare const recoveryAcceptResultSdk: Awaited<typeof recoveryAcceptedSdk>;
const recoveryTtlSdk: 600 = recoveryChallengeResultSdk.expiresIn;
const recoverySignInSdk: true = recoveryAcceptResultSdk.signInRequired;
const recoveryErrorCodeSdk: RecoverySdk.RemoteInvitationEmailErrorCode = "INVITATION_PROOF_UNAVAILABLE";
new RecoverySdk.RemoteInvitationEmailError(recoveryErrorCodeSdk);
new RecoverySdk.InvitationEmailInputError(); new RecoverySdk.RemoteInvitationEmailUnconfirmedError("accept");
// @ts-expect-error Recovery confirmation is mandatory, not any.
recoveryClientSdk.requestInvitationEmailChallenge({ invitationId: "id", challengeId: "id", token: "secret" });
// @ts-expect-error Accept needs fresh code proof, not only challenge possession.
recoveryClientSdk.acceptInvitationEmailChallenge(recoveryChallengeSdk);
// @ts-expect-error The safe challenge projection never exposes an OTP.
const recoveryCodeLeakSdk: string = recoveryChallengeResultSdk.code;
// @ts-expect-error The accepted result never creates a session token.
const recoveryTokenLeakSdk: string = recoveryAcceptResultSdk.token;
// @ts-expect-error TTL remains a concrete literal, not any.
const recoveryWrongTtlSdk: 1 = recoveryChallengeResultSdk.expiresIn;
// @ts-expect-error Accepted sign-in requirement is literal true.
const recoveryWrongSignInSdk: false = recoveryAcceptResultSdk.signInRequired;
// @ts-expect-error Error codes are a closed union.
const recoveryWrongCodeSdk: RecoverySdk.RemoteInvitationEmailErrorCode = "UNKNOWN";
// @ts-expect-error A membership ID must retain string inference.
const recoveryWrongMembershipSdk: number = recoveryAcceptResultSdk.membershipId;

declare const selectedSession: Awaited<ReturnType<typeof auth.switchWorkspace>>;
const sessionContract: import("@hasna/skills/sdk").RemoteWorkspaceSession = selectedSession;
const rootSessionContract: import("@hasna/skills").RemoteWorkspaceSession = sessionContract;
const selectedMembership: string = selectedSession.user.membershipId;
const selectedRole: "owner" | "admin" | "member" | "viewer" = selectedSession.user.role;
declare const discoveredWorkspaces: Awaited<ReturnType<typeof auth.listAccountWorkspaces>>;
const discoveredUser: string = discoveredWorkspaces.userId;
const currentWorkspace: boolean = discoveredWorkspaces.workspaces[0]!.current;
// @ts-expect-error Workspace selection binds the expected user too.
client.switchWorkspace({ membershipId: "observed-membership" });
// @ts-expect-error Slugs cannot select a membership incarnation.
auth.switchWorkspace("reader@example.test", "000000", { userId: "observed-user", slug: "workspace" });
// @ts-expect-error Captured context is immutable.
workspaceContext.membershipId = "changed";
// @ts-expect-error Session roles retain concrete inference, not any.
const inventedSelectionRole: "superuser" = selectedSession.user.role;
// @ts-expect-error Safe discovery never exposes session credentials.
const listedToken: string = discoveredWorkspaces.token;
// @ts-expect-error A boolean current flag cannot lose inference to any.
const wrongCurrentFlag: string = discoveredWorkspaces.workspaces[0]!.current;
declare const profile: Awaited<ReturnType<typeof client.updateProfile>>;
const displayName: string | null = profile.user.displayName;
const customerRole: "owner" | "admin" | "member" | "viewer" = profile.user.role;
// @ts-expect-error Name updates do not accept a role assignment.
client.updateProfile({ displayName: "Example", role: "owner" });
// @ts-expect-error Name responses retain a concrete role, not any.
const wrongCustomerRole: "superuser" = profile.user.role;
declare const workspace: Awaited<ReturnType<typeof auth.updateCurrentWorkspace>>;
const workspaceName: string = workspace.organization.name;
// @ts-expect-error Workspace identity cannot be changed through this method.
auth.updateCurrentWorkspace("reader@example.test", "000000", { name: "Example", id: "other" });
declare const roster: Awaited<ReturnType<typeof client.listWorkspaceMembers>>;
declare const freshRoster: Awaited<ReturnType<typeof auth.listWorkspaceMembers>>;
const rosterIdentity: string = roster.organizationId;
const rosterMember: import("@hasna/skills/sdk").RemoteWorkspaceMember = roster.members[0]!;
const rosterRootMember: import("@hasna/skills").RemoteWorkspaceMember = rosterMember;
const rosterPage: import("@hasna/skills/sdk").RemoteWorkspaceMembersPage = freshRoster;
const rosterRole: "owner" | "admin" | "member" | "viewer" = rosterMember.role;
const rosterDisplayName: string | null = rosterMember.displayName;
const rosterCursor: string | null = roster.nextCursor;
const rosterTimestamp: string = rosterMember.createdAt;
client.listWorkspaceMembers({ limit: 1, cursor: "opaque_cursor" });
auth.listWorkspaceMembers("reader@example.test", "000000", { limit: 100 });
// @ts-expect-error The current roster does not select a different workspace.
client.listWorkspaceMembers({ organizationId: "other" });
// @ts-expect-error Pagination limit stays numeric.
auth.listWorkspaceMembers("reader@example.test", "000000", { limit: "1" });
// @ts-expect-error A roster role must retain concrete inference, not any.
const inventedRosterRole: "superuser" = rosterMember.role;
// @ts-expect-error Exact timestamps remain strings; Date would lose precision.
const roundedRosterTimestamp: Date = rosterMember.createdAt;
// @ts-expect-error Complete pages require handling a null continuation.
const alwaysRosterCursor: string = roster.nextCursor;
// @ts-expect-error Auth metadata is not part of the safe member projection.
rosterMember.otpCodeHash;
client.setWorkspaceMemberRole(rosterMember.membershipId, { role: "viewer", expectedRole: "member" });
auth.setWorkspaceMemberRole("owner@example.test", "000000", rosterMember.membershipId, { role: "admin", expectedRole: "member" });
client.removeWorkspaceMember(rosterMember.membershipId, { expectedRole: "viewer" });
auth.removeWorkspaceMember("owner@example.test", "000000", rosterMember.membershipId, { expectedRole: "member" });
declare const roleResult: Awaited<ReturnType<typeof client.setWorkspaceMemberRole>>;
declare const removeResult: Awaited<ReturnType<typeof auth.removeWorkspaceMember>>;
const typedRoleResult: import("@hasna/skills/sdk").RemoteWorkspaceMemberRoleResult = roleResult;
const typedRemoval: import("@hasna/skills").RemoteWorkspaceMemberRemovalResult = removeResult;
const changedMember: import("@hasna/skills").RemoteWorkspaceMember = roleResult.member;
const roleChanged: boolean = roleResult.changed;
const removedMembership: true = removeResult.removed;
const alreadyRemoved: boolean = removeResult.alreadyRemoved;
declare const memberError: import("@hasna/skills/sdk").RemoteWorkspaceMemberError;
const memberRequestError: RemoteRequestError = memberError;
const memberErrorCode: import("@hasna/skills").RemoteWorkspaceMemberErrorCode = memberError.code;
// @ts-expect-error A role change requires the observed concurrency precondition.
client.setWorkspaceMemberRole(rosterMember.membershipId, { role: "viewer" });
// @ts-expect-error Removal requires the observed role.
auth.removeWorkspaceMember("owner@example.test", "000000", rosterMember.membershipId, {});
// @ts-expect-error A caller cannot select another workspace through this mutation.
client.removeWorkspaceMember(rosterMember.membershipId, { expectedRole: "member", organizationId: "other" });
// @ts-expect-error Roles remain the documented union, not arbitrary strings.
auth.setWorkspaceMemberRole("owner@example.test", "000000", rosterMember.membershipId, { role: "superuser", expectedRole: "member" });
// @ts-expect-error Results preserve concrete booleans and cannot degrade to any.
const numericChanged: number = roleResult.changed;
// @ts-expect-error Removal is a positive literal, never an assumed false success.
const removalFalse: false = removeResult.removed;
// @ts-expect-error Exact server timestamps remain strings.
const roundedMemberTimestamp: Date = roleResult.member.createdAt;
// @ts-expect-error Membership refusal codes do not contain arbitrary server strings.
const arbitraryMemberCode: "ARBITRARY_SERVER_CODE" = memberError.code;
const unavailable = new RemoteCapabilityUnavailableError();
const rootError: RemoteCapabilityUnavailableError = new RootCapabilityError();
const requestError: RemoteRequestError = unavailable;
const unavailableCode: "SUBSCRIPTION_CHECKOUT_UNAVAILABLE" = unavailable.code;
const quoteCode: RemoteQuoteUnavailableCode = "RUNTIME_SKILL_NOT_ALLOWED";
const rootQuoteCode: RootQuoteCode = quoteCode;
const quoteError: RemoteQuoteUnavailableError = new RootQuoteUnavailableError("/api/v1/skills/fixture/quote", rootQuoteCode);
const quoteBaseError: RemoteRequestError = quoteError;
// @ts-expect-error Arbitrary server codes cannot enter the quote error vocabulary.
new RemoteQuoteUnavailableError("/api/v1/skills/fixture/quote", "UNTRUSTED_SERVER_CODE");
// @ts-expect-error Arbitrary server error codes are not part of this safe contract.
const arbitraryCode: "ARBITRARY_SERVER_CODE" = unavailable.code;
const storageEnv: "HASNA_SKILLS_DATABASE_URL" = SKILLS_NATIVE_STORAGE_ENV.databaseUrl;
const storage: SkillsNativeStorageConfig = { syncBatchSize: 10, dryRun: true };
// @ts-expect-error Storage configuration retains its numeric batch size.
const invalidStorage: SkillsNativeStorageConfig = { syncBatchSize: "ten", dryRun: true };
const role = SkillsAdminSetUserRoleRequestSchema.parse({ role: "admin" }).role;
const validRole: "owner" | "admin" | "member" | "viewer" = role;
// @ts-expect-error Administrative roles cannot widen to arbitrary strings or any.
const invalidRole: "superuser" = role;
type ListRole = ReturnType<typeof SkillsAdminListUsersResponseSchema.parse>["users"][number]["role"];
const noDefaultMembership: ListRole = null;
const activeDefaultMembership: ListRole = "viewer";
// @ts-expect-error The list role is required; absent and null differ.
const absentListRole: ListRole = undefined;
// @ts-expect-error List roles must not lose inference to arbitrary strings/any.
const inventedListRole: ListRole = "superuser";
// @ts-expect-error Active organization rosters still require a concrete role.
const nullOrganizationRole: ReturnType<typeof SkillsAdminShowOrganizationResponseSchema.parse>["users"][number]["role"] = null;
// @ts-expect-error Role assignment input does not allow null.
const nullMutationInput: typeof SkillsAdminSetUserRoleRequestSchema._input["role"] = null;
// @ts-expect-error Successful role mutation responses remain nonnullable.
const nullMutationOutput: ReturnType<typeof SkillsAdminSetUserRoleResponseSchema.parse>["user"]["role"] = null;
const suspended = SkillsAdminSuspendOrganizationRequestSchema.parse({ suspended: true, reason: "fixture" }).suspended;
const resumed = SkillsAdminResumeOrganizationRequestSchema.parse({ suspended: false, reason: "fixture" }).suspended;
const suspendLiteral: true = suspended;
const resumeLiteral: false = resumed;
// @ts-expect-error Suspend and resume retain opposite literal contracts.
const wrongSuspend: false = suspended;
// @ts-expect-error Resume cannot be widened to boolean or any.
const wrongResume: true = resumed;
void [service, version, status, terminalStatus, wrongVersion, wrongStatus, client, auth,
  rootError, requestError, unavailableCode, arbitraryCode, storageEnv, storage, invalidStorage,
  validRole, invalidRole, suspendLiteral, resumeLiteral, wrongSuspend, wrongResume];
`);
  await writeFile(join(workspace, "admin-list-runtime.ts"), `
import { strict as assert } from "node:assert";
import { SkillsAdminListUsersResponseSchema as List, SkillsAdminShowOrganizationResponseSchema as Show,
  SkillsAdminSetUserRoleRequestSchema as Input, SkillsAdminSetUserRoleResponseSchema as Output } from "@hasna/skills/admin-contract";
const user = { id: "owned-user", email: "owned@example.test", organizationId: "owned-org", role: null, metadata: {}, createdAt: "2026-09-06T00:00:00Z" };
const list = (row: unknown) => List.safeParse({ users: [row], limit: 1, offset: 0 }).success;
assert.equal(list(user), true);
assert.equal(list({ ...user, role: "viewer" }), true);
assert.equal(list({ ...user, role: undefined }), false);
const { role, ...missing } = user; assert.equal(list(missing), false);
assert.equal(list({ ...user, role: "superuser" }), false);
const organization = { id: "owned-org", slug: "owned", name: "Owned", metadata: {}, createdAt: user.createdAt };
const show = (row: unknown) => Show.safeParse({ organization, users: [row], balance: null, subscription: null }).success;
assert.equal(show(user), false); assert.equal(show({ ...user, role: "viewer" }), true);
assert.equal(Input.safeParse({ role: null }).success, false);
assert.equal(Output.safeParse({ ok: true, user }).success, false);
assert.equal(Output.safeParse({ ok: true, user: { ...user, role: "viewer" } }).success, true);
console.log("Installed admin list runtime: 10 assertions passed.");
`);
  await writeFile(join(workspace, "bundle-runtime.ts"), `
import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { getEventListeners } from "node:events";
import { inspectSkillBundle, packSkillBundle, SkillBundleInspectionError } from "@hasna/skills/sdk";
mkdirSync("bundle-fixture"); writeFileSync("bundle-fixture/SKILL.md", "# Installed fixture");
const packed = packSkillBundle("bundle-fixture");
const inspected = await inspectSkillBundle(packed.bytes);
assert.equal(inspected.sha256, packed.sha256);
assert.equal(inspected.fileCount, 1);
assert.equal(inspected.entries[0].path, "SKILL.md");
assert.equal(new TextDecoder().decode(inspected.entries[0].bytes), "# Installed fixture");
assert.equal(inspected.entries[0].bytes.byteLength, inspected.entries[0].bytes.buffer.byteLength);
assert.notEqual(inspected.entries[0].bytes.buffer, packed.bytes.buffer);
await assert.rejects(inspectSkillBundle(gzipSync(new Uint8Array(1024 * 1024)), { limits: { decompressedBytes: 512 } }),
  error => error instanceof SkillBundleInspectionError && error.code === "BUNDLE_LIMIT");
const controller = new AbortController(); controller.abort();
await assert.rejects(inspectSkillBundle(packed.bytes, { signal: controller.signal }),
  error => error instanceof SkillBundleInspectionError && error.code === "BUNDLE_ABORTED");
const expansion = gzipSync(new Uint8Array(64 * 1024 * 1024));
const midstream = new AbortController();
const pending = inspectSkillBundle(expansion, { signal: midstream.signal });
const abortTimer = setTimeout(() => midstream.abort(), 1);
try { await assert.rejects(pending, error => error instanceof SkillBundleInspectionError && error.code === "BUNDLE_ABORTED"); }
finally { clearTimeout(abortTimer); }
assert.equal(getEventListeners(midstream.signal, "abort").length, 0);
let timerTurns = 0;
const heartbeat = setInterval(() => { timerTurns++; }, 1);
try {
  assert.equal((await inspectSkillBundle(gzipSync(new Uint8Array(4 * 1024 * 1024)))).fileCount, 0);
  assert.ok(timerTurns > 1);
} finally { clearInterval(heartbeat); }
const prescheduled = new AbortController();
const preAbortTimer = setTimeout(() => prescheduled.abort(), 1);
try { await assert.rejects(inspectSkillBundle(expansion, { signal: prescheduled.signal }),
  error => error instanceof SkillBundleInspectionError && error.code === "BUNDLE_ABORTED"); }
finally { clearTimeout(preAbortTimer); }
assert.equal(getEventListeners(prescheduled.signal, "abort").length, 0);
const timed = new AbortController();
await assert.rejects(inspectSkillBundle(expansion, { signal: timed.signal, limits: { timeoutMs: 1 } }),
  error => error instanceof SkillBundleInspectionError && error.code === "BUNDLE_TIMEOUT");
assert.equal(getEventListeners(timed.signal, "abort").length, 0);
assert.equal((await inspectSkillBundle(packed.bytes)).sha256, packed.sha256);
console.log("Installed bundle SDK runtime: 17 assertions passed.");
`);
  const installConfig = join(workspace, "install.bunfig.toml");
  await writeFile(installConfig, `[install]\nregistry = "https://registry.npmjs.org"\nminimumReleaseAge = 604800\nminimumReleaseAgeExcludes = ["@hasna/skills", "@hasna/events", "@hasna/secrets"]\n`, { mode: 0o600 });
  await run([process.execPath, "--no-env-file", "install", "--ignore-scripts", `--config=${installConfig}`], workspace);
  // Prove the pins held before tsc runs: a floating resolution must fail here
  // with a resolution message, never as a TS2694 inside node_modules/bun-types
  // that reads like a Skills distribution defect (BUG-0042).
  for (const [name, expected] of Object.entries(typePins)) {
    const installed = JSON.parse(await readFile(join(workspace, "node_modules", ...name.split("/"), "package.json"), "utf8")).version;
    if (installed !== expected) {
      throw new Error(`Consumer fixture resolved ${name}@${installed}, expected the pinned ${expected} — a floating dependency resolution (bun-types declares "@types/node": "*"), not a Skills distribution failure. Re-run the fixture; if it persists, update the pin.`);
    }
  }
  await run([process.execPath, "node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], workspace);
  console.log((await run([process.execPath, "--no-env-file", "admin-list-runtime.ts"], workspace)).trim());
  console.log((await run([process.execPath, "--no-env-file", "bundle-runtime.ts"], workspace)).trim());
  await writeFile(join(workspace, "content-hash-runtime.ts"), `
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { computeContentHash, computeContentHashFromEntries as rootHash, revisionIdOf as rootRevision } from "@hasna/skills";
import { inspectSkillBundle, packSkillBundle, computeContentHashFromEntries, verifyContentHashFromEntries, ContentHashInputError, revisionIdOf } from "@hasna/skills/sdk";
const dir = join(import.meta.dir, "owned-content-fixture"); mkdirSync(dir);
const manifest = { name: "fixture", version: "1.0.0", provenance: { source_commit: "fixture", content_hash: "" } };
writeFileSync(join(dir, "SKILL.md"), "Body.\\r\\n"); writeFileSync(join(dir, "skill.json"), JSON.stringify(manifest));
const first = await inspectSkillBundle(packSkillBundle(dir).bytes);
const expected = computeContentHash(dir);
assert.equal(await computeContentHashFromEntries(first.entries), expected);
assert.equal(await rootHash(first.entries), expected);
manifest.provenance.content_hash = expected; writeFileSync(join(dir, "skill.json"), JSON.stringify(manifest));
const second = await inspectSkillBundle(packSkillBundle(dir).bytes);
const before = second.entries.map(entry => Array.from(entry.bytes));
assert.deepEqual(await verifyContentHashFromEntries(second.entries), { declared: true, valid: true, declaredHash: expected, computedHash: expected });
assert.deepEqual(second.entries.map(entry => Array.from(entry.bytes)), before);
assert.equal(readFileSync(join(dir, "SKILL.md"), "utf8"), "Body.\\r\\n");
await assert.rejects(computeContentHashFromEntries([...second.entries, { path: "../outside", mode: 420, bytes: new Uint8Array() }]), error => error instanceof ContentHashInputError && error.code === "CONTENT_HASH_INVALID");
await assert.rejects(computeContentHashFromEntries(second.entries, { limits: { rawBytes: 1 } }), error => error instanceof ContentHashInputError && error.code === "CONTENT_HASH_LIMIT");
const controller = new AbortController(), pending = computeContentHashFromEntries(second.entries, { signal: controller.signal }); controller.abort();
await assert.rejects(pending, error => error instanceof ContentHashInputError && error.code === "CONTENT_HASH_ABORTED");
const revision = { slug: "hash-fixture", displayName: "Hash Fixture", description: "Fixture.", category: "Development", tags: ["one", "two"], source: "private", kind: "instruction" as const };
assert.equal(revisionIdOf(revision), "5187855fb5088247a5551ee18ee8e27cfe47466b019b4443b992f0e233c79248");
assert.equal(rootRevision(revision), revisionIdOf(revision));
console.log("Installed content hash/revision runtime: 10 assertions passed.");
`);
  console.log((await run([process.execPath, "--no-env-file", "content-hash-runtime.ts"], workspace)).trim());
  await writeFile(join(workspace, "quote-error-runtime.ts"), `
import assert from "node:assert/strict";
import * as root from "@hasna/skills";
import * as sdk from "@hasna/skills/sdk";
const original = globalThis.fetch;
try {
  for (const api of [root, sdk]) {
    let requests = 0;
    globalThis.fetch = async () => { requests++; return Response.json({ code: "RUNTIME_SKILL_NOT_ALLOWED", error: "untrusted-response-canary" }, { status: 503 }); };
    const error = await new api.RemoteSkillsClient("consumer-owned-token", "https://skills.example.test").quoteRun("fixture").then(() => null, error => error);
    assert.equal(requests, 1);
    assert(error instanceof api.RemoteQuoteUnavailableError);
    assert(error instanceof api.RemoteRequestError);
    assert.equal(error.code, "RUNTIME_SKILL_NOT_ALLOWED");
    assert.equal(error.status, 503);
    assert.equal(error.message, "This skill is not enabled for hosted execution on this Skills instance.");
    assert(!JSON.stringify(error).includes("untrusted-response-canary"));
  }
} finally { globalThis.fetch = original; }
console.log("Installed quote error root/SDK runtime: 14 assertions passed.");
`);
  console.log((await run([process.execPath, "--no-env-file", "quote-error-runtime.ts"], workspace)).trim());
  // Exercise the installed CLI archive too: malformed polling values must not
  // cross the quote/credit boundary; the maximum accepted delay must not overflow
  // into rapid status requests after an owned loopback run is submitted.
  await run([process.execPath, "--no-env-file", "test", resolve(root, "src/cli/cli.run-polling.test.ts")], workspace, {
    SKILLS_RUN_POLLING_TEST_PACKAGE: join(workspace, "node_modules/@hasna/skills"),
  });
  console.log("Installed CLI polling: invalid inputs refused before HTTP or local run writes; valid quote and maximum-delay wait controls passed.");
  await run([process.execPath, "--no-env-file", "test", resolve(root, "src/cli/cli.remote-routing.test.ts")], workspace, {
    SKILLS_REMOTE_ROUTING_TEST_PACKAGE: join(workspace, "node_modules/@hasna/skills"),
  });
  console.log("Installed CLI routing: explicit remote approval, isolated profiles, target conflicts and managed defaults passed.");
  console.log(`Consumer types: @hasna/skills@${metadata.version} passed strict installed-package checking for all four exports (skipLibCheck=false).`);
} finally { await rm(workspace, { recursive: true, force: true }); }
