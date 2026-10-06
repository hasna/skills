/**
 * Hasna Skills - Open source skill library for AI coding agents
 *
 * Pin AI agent skills with a single command:
 *   skills pin logo-design market-research-report
 *
 * Or use the interactive CLI:
 *   skills
 */

export {
  SKILLS,
  BASIC_SKILL_NAMES,
  CATEGORIES,
  getSkill,
  getSkillsByCategory,
  searchSkills,
  getSkillsByTag,
  getAllTags,
  findSimilarSkills,
  isBasicSkillName,
  loadRegistry,
  loadBasicRegistry,
  loadRegistryProfile,
  clearRegistryCache,
  type SkillMeta,
  type Category,
  type SkillRegistryProfile,
} from "./lib/registry.js";

export {
  installSkill,
  pinSkill,
  unpinSkill,
  getPinnedSkills,
  installSkillSource,
  installSkillManifest,
  installSkills,
  createLocalSkillManifest,
  installSkillForAgent,
  removeSkillForAgent,
  getInstalledSkills,
  removeSkill,
  skillExists,
  getSkillPath,
  getAgentSkillsDir,
  getAgentSkillPath,
  AGENT_TARGETS,
  type InstallResult,
  type InstallOptions,
  type InstallMode,
  type InstallSource,
  type SkillInstallManifest,
  type ManifestInstallOptions,
  type AgentTarget,
  type AgentScope,
  type AgentInstallOptions,
  getInstallMeta,
  disableSkill,
  enableSkill,
  getDisabledSkills,
} from "./lib/installer.js";

export {
  DEFAULT_EXPORT_DIR,
  PROJECT_CONFIG_FILE,
  SKILLS_PROJECT_DIR,
  ensureProjectConfig,
  getDisabledProjectSkills,
  getProjectConfigPath,
  getProjectStateDir,
  listPinnedSkills,
  loadProjectConfig,
  pinProjectSkill,
  saveProjectConfig,
  setSkillDisabled,
  unpinProjectSkill,
  type ProjectSkillPin,
  type SkillsProjectConfig,
} from "./lib/project-state.js";

export {
  appendRunEvent,
  completeSkillRun,
  createSkillRun,
  findSkillRun,
  getRunExportDir,
  listSkillRuns,
  updateSkillRun,
  writeRunLogs,
  type SkillRunArtifact,
  type SkillRunContext,
  type SkillRunRecord,
  type SkillRunStatus,
} from "./lib/run-state.js";

export {
  getSkillDocs,
  getSkillBestDoc,
  getSkillRequirements,
  runSkill,
  generateEnvExample,
  generateSkillMd,
  type SkillDocs,
  type SkillRequirements,
} from "./lib/skillinfo.js";

export {
  loadConfig,
  saveConfig,
  unsetConfig,
  getConfigPath,
  type SkillsConfig,
  type ConfigScope,
} from "./lib/config.js";

export {
  buildSkillsApiUrl,
  getConfiguredApiUrl,
  loadRemoteRegistry,
  loadRemoteSkill,
  parseRemoteSkillPayload,
  parseRemoteRegistryPayload,
  type RemoteRegistryOptions,
} from "./lib/remote-registry.js";

export {
  ARTICLE_GENERATION_SLUG,
  validateBlogArticleRunOptions,
  type BlogArticleRunOptions,
  type BlogArticleValidationResult,
} from "./lib/blog-article.js";

export {
  getCompactSkillDiscovery,
  getPublicSkillDiscovery,
  publicDiscoveryDependencies,
  publicDiscoveryDocumentation,
  publicDiscoveryEnvVars,
  sanitizePublicDiscoveryText,
  type CompactSkillDiscovery,
  type PublicSkillDiscovery,
} from "./lib/discovery.js";

export {
  TOOL_PRIMITIVE_SCHEMA_VERSION,
  TOOL_PRIMITIVES,
  createSkillToolDependencies,
  getSkillToolDependencies,
  getToolPrimitive,
  isGatewayBackedSkill,
  listToolPrimitives,
  validateToolPrimitiveCoverage,
  type SkillToolDependencies,
  type SkillToolDependency,
  type ToolPrimitive,
  type ToolPrimitiveCoverageIssue,
  type ToolPrimitiveCoverageResult,
  type ToolPrimitiveRuntime,
  type ToolPrimitiveSummary,
} from "./lib/tool-primitives.js";

export {
  MissingSkillsFleetError,
  SkillsFleetCredentialError,
  SKILLS_API_KEY_ENV,
  SKILLS_API_KEY_ENV_KEYS,
  SKILLS_API_URL_ENV,
  SKILLS_API_URL_ENV_KEYS,
  SKILLS_APP,
  SKILLS_LOCAL_OPT_IN_ENV_KEYS,
  configuredSkillsApiUrl,
  isSkillsLocalOptIn,
  noticeLocalSkillsMode,
  normalizeSkillsApiOrigin,
  requireSkillsApiKey,
  requireSkillsApiOrigin,
  requireSkillsFleet,
  resolveSkillsApiKey,
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
} from "./lib/fleet-credentials.js";

export {
  RemoteSkillsClient,
  createRemoteSkillsClient,
  RemoteRouteUnsupportedError,
  RemoteRequestError,
  RemoteCreditCheckoutError,
  RemoteQuoteUnavailableError,
  type RemoteQuoteUnavailableCode,
  RemoteWorkspaceMemberError,
  RemoteCapabilityUnavailableError,
  type RemotePin,
  type RemoteSkillSummary,
  type UpdatedSincePage,
} from "./lib/remote-client.js";
export { RemoteSkillsPermissionError, type RemoteSkillsAccess, type RemoteSkillsPermissions } from "./lib/remote-permissions.js";

export {
  REMOTE_SKILL_RUN_CONTRACT_VERSION,
  normalizeRemoteSkillRunContract,
  type RemoteSkillRunContract,
} from "./lib/remote-run-contract.js";

export {
  addSchedule,
  listSchedules,
  removeSchedule,
  setScheduleEnabled,
  getDueSchedules,
  recordScheduleRun,
  validateCron,
  getNextRun,
  type SkillSchedule,
} from "./lib/scheduler.js";

export {
  parseSkillFrontmatter,
  validateRegistryConsistency,
  validateSkillDirectory,
  type RegistryConsistencyResult,
  type SkillFrontmatter,
  type SkillValidationMessage,
  type SkillValidationResult,
} from "./lib/skill-validation.js";

export {
  PORTABLE_SKILL_DEFAULT_VERSION,
  PORTABLE_SKILL_SCHEMA,
  PORTABLE_SKILL_STANDARD,
  findPortableSkill,
  getPortableSkillPath,
  getPortableSkillsRoot,
  listPortableSkillMetas,
  listPortableSkills,
  normalizePortableSkillName,
  portPortableSkill,
  portPortableSkillDirectory,
  readPortableSkillManifest,
  runPortableSkill,
  scaffoldPortableSkill,
  validatePortableSkillDirectory,
  writeCorpusSkill,
  type BulkPortImportedEntry,
  type BulkPortPortableSkillOptions,
  type BulkPortResult,
  type BulkPortSkippedEntry,
  type CorpusSkillMeta,
  type PortableSkillCommand,
  type PortableSkillInput,
  type PortableSkillManifest,
  type PortableSkillProvenance,
  type PortableSkillRunOptions,
  type PortableSkillRunResult,
  type PortableSkillRuntimeContract,
  type PortableSkillSummary,
  type SkillKind,
  type SkillRuntimeName,
  type SkillSandboxMode,
  type SkillSystemDep,
  type WriteCorpusSkillInput,
} from "./lib/portable-skills.js";

export {
  SKILL_RUNTIMES,
  SKILL_SANDBOX_MODES,
  SKILL_SYSTEM_DEPS_ALLOWLIST,
} from "./lib/portable-skills-types.js";

export {
  canonicalizeManifest,
  computeContentHash,
  computeContentHashFromEntries,
  verifyContentHashFromEntries,
  CONTENT_HASH_LIMITS,
  ContentHashInputError,
  type ContentHashLimits,
  type ContentHashOptions,
  type ContentHashInputErrorCode,
  normalizeLineEndings,
  verifyContentHash,
  type ContentHashVerification,
} from "./lib/skill-hash.js";

export { revisionIdOf, type RevisionContent } from "./lib/revision.js";

export {
  validatePortableManifestContract,
  type PortableContractOptions,
} from "./lib/skill-contract.js";

export {
  pullSkills,
  PullSkillError,
  type PullSkillsOptions,
  type PullSkillsResult,
  type PulledSkillResult,
  type SkillPullClient,
} from "./lib/pull.js";

export {
  SYNC_AGENTS,
  SYNC_MARKER_FILE,
  SYNC_MARKER_MANAGED_BY,
  adaptSkillMdForAgent,
  agentGlobalSkillsDir,
  isSyncAgent,
  pointerSkillMd,
  removeManagedAgentSkill,
  resolveSyncAgents,
  syncSkillsToAgents,
  writeManagedAgentSkill,
  writeManagedSkillDir,
  type AgentSyncAction,
  type ManagedDirWriteResult,
  type SyncActionKind,
  type SyncAgent,
  type SyncMarker,
  type SyncSkillsOptions,
  type SyncSkillsResult,
  type WriteManagedAgentSkillParams,
} from "./lib/agent-sync.js";

export {
  SKILLS_CLI_MCP_PARITY,
  findSkillsParityForCliCommand,
  findSkillsParityForMcpTool,
  validateSkillsCliMcpParity,
  type SkillsCliMcpParityDomain,
  type SkillsCliMcpParityEntry,
} from "./lib/cli-mcp-parity.js";

export {
  createRegistrySyncArtifact,
  writeRegistrySyncArtifact,
  type RegistrySyncArtifact,
  type RegistrySyncOptions,
  type RegistrySyncSkill,
} from "./lib/registry-sync.js";

export {
  MCP_CONTRACT_SCHEMA_VERSION,
  createMcpContractManifest,
  createSkillMcpMetadata,
  describeMcpToolContracts,
  getMcpResourceContracts,
  getMcpToolDescriptions,
  listMcpToolContracts,
  summarizeMcpToolContract,
  type DescribedMcpToolContract,
  type JsonSchemaObject,
  type McpContractManifest,
  type McpResourceContract,
  type McpToolCategory,
  type McpToolContract,
  type McpToolSideEffect,
  type SkillMcpMetadata,
  type SkillMcpSchemaContract,
  type UnknownMcpToolContract,
} from "./lib/mcp-contracts.js";

export {
  getFeedbackDbPath,
  saveFeedback,
  type FeedbackCategory,
  type FeedbackInput,
  type FeedbackResult,
} from "./lib/feedback.js";

export {
  SKILLS_NATIVE_STORAGE_ENV,
  SKILLS_NATIVE_STORAGE_FALLBACK_ENV,
  SKILLS_STORAGE_ENV,
  SKILLS_STORAGE_FALLBACK_ENV,
  SKILLS_STORAGE_TABLES,
  STORAGE_TABLES,
  SkillsPostgresSyncStore,
  SkillsS3ObjectStore,
  buildSkillsS3ObjectUrl,
  createSkillsPostgresSyncStore,
  createSkillsS3ObjectStore,
  createSkillsSnapshotSyncRecord,
  exportSkillsLocalSnapshot,
  getSkillsNativeStorageStatus,
  getSkillsStorageDatabaseEnv,
  getSkillsStorageDatabaseUrl,
  getSkillsStorageStatus,
  getStorageDatabaseEnv,
  getStorageDatabaseUrl,
  getStorageStatus,
  importSkillsLocalSnapshot,
  planSkillsS3SnapshotUpload,
  resolveSkillsNativeStorageConfig,
  resolveStorageConfig,
  signSkillsAwsV4Request,
  skillsPostgresSyncSchemaSql,
  storageCapabilities,
  uploadSkillsSnapshotFilesToS3,
  type AwsCredentials,
  type SignSkillsAwsV4RequestOptions,
  type SkillsFetch,
  type SkillsLocalSnapshot,
  type SkillsNativeStorageConfig,
  type SkillsNativeStorageStatus,
  type SkillsPostgresQueryClient,
  type SkillsS3ObjectStoreOptions,
  type SkillsS3PutObjectOptions,
  type SkillsS3SnapshotPlanEntry,
  type SkillsS3StoredObject,
  type SkillsSnapshotFile,
  type SkillsStorageTable,
  type SkillsSyncRecord,
} from "./lib/native-storage.js";

export {
  SKILL_ALIASES,
  normalizeSkillSlug,
  resolveSkillAlias,
  type SkillAlias,
} from "./lib/skill-aliases.js";

export type {
  SkillResponse,
  SkillDetailResponse,
  CategoryResponse,
  TagResponse,
  InstallResponse,
  RemoveResponse,
  VersionResponse,
  ExportResponse,
  ImportResponse,
  SearchResponse,
  CategoryInstallResponse,
  ErrorResponse,
} from "./types/api.js";

export {
  STATION_SYNC_MANIFEST_SCHEMA,
  StationSnapshotError,
  sha256File,
  planStationSnapshot,
  validateStationId,
  writeStationSnapshot,
  type PortableSnapshotFile,
  type ScannedHome,
  type SnapshotPlan,
  type StationSnapshotErrorCode,
  type StationSnapshotManifestFile,
  type StationSnapshotOptions,
  type StationSnapshotResult,
} from "./lib/station-snapshot.js";

export {
  STATION_HYDRATION_MANIFEST_SCHEMA,
  planStationHydration,
  writeStationHydration,
  type HydrationCandidate,
  type HydrationWinnerFile,
  type HydrationWinnerSkill,
  type StationHydrationOptions,
  type StationHydrationResult,
} from "./lib/station-hydrate.js";

export {
  REFUSED_SCANNER_FLAGGED,
  SYNC_HOMES,
  destinationFor,
  homePathFor,
  isExcludedSkillFileName,
  isPortableWithinSkill,
  isRegularFile,
  walkEntries,
  type SyncHomeDefinition,
  type WalkEntry,
} from "./lib/portable-snapshot-filter.js";

export { RemoteCreditApprovalError, type RemoteRunApproval, type RemoteRunQuote, type RemoteCreditPack } from "./lib/remote-account.js";

export { RemoteSkillsAuthClient, HostedApiError } from "./lib/remote-auth.js";
export type { RemoteWorkspaceMember, RemoteWorkspaceMembersPage, RemoteWorkspaceMembersOptions } from "./lib/remote-workspace.js";
export type { SetRemoteWorkspaceMemberRole, RemoveRemoteWorkspaceMember, RemoteWorkspaceMemberRoleResult, RemoteWorkspaceMemberRemovalResult, RemoteWorkspaceMemberErrorCode } from "./lib/remote-workspace.js";
export type { RemoteCustomerRole, RemoteCustomerProfile, RemoteCurrentWorkspace, UpdateRemoteProfile, UpdateRemoteWorkspace } from "./lib/remote-profile.js";

export type { RemoteWorkspaceContext, RemoteAccountWorkspace, RemoteAccountWorkspaces, RemoteWorkspaceIdentity,
  RemoteWorkspaceSession, RemoteAccountWorkspaceDiscovery, RemoteWorkspaceSelectionErrorCode } from "./lib/remote-workspace-selection.js";
export { WorkspaceContextInputError, WorkspaceIdentityMismatchError } from "./lib/remote-workspace-selection.js";
export { RemoteWorkspaceSelectionError } from "./lib/remote-client.js";

export type { LeaveRemoteWorkspace, RemoteWorkspaceLeaveResult, RemoteWorkspaceLeaveErrorCode } from "./lib/remote-workspace-leave.js";
export { WorkspaceLeaveInputError, RemoteWorkspaceLeaveError, RemoteWorkspaceLeaveUnconfirmedError } from "./lib/remote-workspace-leave.js";

export type { RemoteWorkspaceInvitation, RemoteWorkspaceInvitationsPage, RemoteWorkspaceInvitationResult,
  RemoteWorkspaceInvitationAcceptance, ListRemoteWorkspaceInvitations, IssueRemoteWorkspaceInvitation,
  ResendRemoteWorkspaceInvitation, RevokeRemoteWorkspaceInvitation, AcceptRemoteWorkspaceInvitation, RemoteWorkspaceInvitationErrorCode } from "./lib/remote-invitations.js";
export { WorkspaceInvitationInputError, RemoteWorkspaceInvitationError, RemoteWorkspaceInvitationUnconfirmedError,
  RemoteWorkspaceInvitationReadError } from "./lib/remote-invitations.js";

export { InvitationEmailInputError, RemoteInvitationEmailError, RemoteInvitationEmailUnconfirmedError,
  type RequestInvitationEmailChallenge, type AcceptInvitationEmailChallenge, type RemoteInvitationEmailChallenge,
  type RemoteInvitationEmailAcceptance, type RemoteInvitationEmailErrorCode } from "./lib/remote-invitation-recovery.js";
export { RemotePrivatePublicationsClient, PrivatePublicationError, PRIVATE_PUBLICATION_MAX_BYTES,
  type PrivatePublicationDeclaration, type PrivatePublicationView, type PrivatePublicationState, type PrivatePublishingCapability } from "./lib/remote-private-publications.js";
export { preparePrivatePublication, readPrivatePublicationRecovery, continuePrivatePublication, inspectPrivatePublication,
  type PrivatePublicationRecovery, type PrivatePublicationResult } from "./lib/private-publication-recovery.js";

export { HttpProfileClient, createProfileClient, type ProfileClient, type AuthenticatedProfilePrincipal, type AuthenticatedProfileRole } from "./lib/profile-client.js";
export type { SkillSelection, SkillProfile, ResolvedSkillSelection, ResolvedSkillProfile, StationSkillStateInput, StationSkillState } from "./types/skill-selection.js";
export { buildSkillContext } from "./lib/skill-context.js";
export { syncSelectionProfile } from "./lib/selection-resolver.js";
export { inspectSkillSession, reconcileSkillSession, type SessionReconciliationInput, type SessionReconciliationOptions } from "./lib/session-reconciliation.js";
export { planAgentIntegration, planClaudeStopHookUpdate, planClaudePreToolUseHookUpdate, planClaudeHookEventsUpdate, planClaudeManagedHookProjection, planAgentSettingsWitnessUpgrade, applyAgentIntegration, inventoryNativeSkills, archiveNativeSkills } from "./lib/agent-integration.js";
export type { ClaudeManagedHookProjection, ClaudeManagedHookProjectionOptions } from "./lib/agent-integration.js";
export { captureDiscoveryDirectories, captureDiscoveryByteSources, captureDiscoveryPathSources, type DiscoveryDirectory, type DiscoverySource } from "./lib/agent-discovery.js";
export { captureClaudeMarketplaceRegistry, captureClaudeMarketplaceRegistryV2 } from "./lib/claude-marketplace-registry.js";
export { captureClaudeSettings, captureClaudeSettingsV2, captureClaudeSettingsV3, upgradeClaudeSettingsWitness } from "./lib/claude-settings-witness.js";
export { buildPluginProjection, pluginTreeDigest, type PluginProjectionManifest, type PluginPayloadMapping, type PluginFileWitness } from "./lib/plugin-projection.js";
export { planPluginAdmission, admitPlugin, resolveAdmittedPlugin, pluginResolverCommand, type PluginAdmissionTarget, type PluginAdmissionBinding, type PluginAdmissionPrincipal, type PluginAdmissionPlan, type PluginAdmissionIdentity, type PluginBundleIdentity, type PluginRoutingIdentity, type PluginAdmissionReceipt } from "./lib/plugin-admission.js";
export { captureManagedPluginRegistry, type ManagedPluginRegistrationWitness } from "./lib/plugin-discovery.js";

export type { RemoteCreditCheckoutOptions, RemoteCreditCheckout, RemoteCreditCheckoutErrorCode } from "./lib/remote-credit-checkout.js";

export { assertPortableAuthoringPath, type PortableAuthoringPathOptions } from "./lib/authoring-path.js";

export { CLAUDE_COORDINATED_HOOK_EVENTS, type ClaudeCoordinatedHookEvent } from "./lib/claude-settings-witness.js";

export { captureCodexSettings, captureCodexSettingsV2, captureCodexSettingsV3, captureCodexSettingsV4, upgradeCodexSettingsWitness, upgradeCodexSettingsWitnessV3, upgradeCodexSettingsWitnessV4 } from "./lib/codex-settings-witness.js";
export { projectCodexNativeSkillCatalog, projectCodexInstalledPlugins, projectCodexInstalledPluginEntries, captureCodexNativeSkillCatalog, isCodexNativeSkillDisabled, type CodexNativeSkillCatalog, type CodexNativeSkill, type CodexInstalledPlugin } from "./lib/codex-native-skill-catalog.js";

export { captureSumiSettings, upgradeSumiSettingsWitness } from "./lib/sumi-settings-witness.js";
