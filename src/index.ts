/**
 * Open Skills - Open source skill library for AI coding agents
 *
 * Pin AI agent skills with a single command:
 *   skills pin image deepresearch
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
  getAllPremiumSlugs,
  getPublicSkillPricing,
  getSkillCatalogBillingFields,
  getSkillPricing,
  getSkillRunCostCents,
  isPremiumSkill,
  validateBlogArticleRunOptions,
  type BlogArticleRunOptions,
  type BlogArticleValidationResult,
  type PublicSkillPricing,
  type SkillPricing,
} from "./lib/pricing.js";

export {
  getCompactSkillDiscovery,
  getPublicSkillDiscovery,
  publicDiscoveryDependencies,
  publicDiscoveryDocumentation,
  publicDiscoveryEnvVars,
  publicDiscoveryPriceLabel,
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
  RemoteSkillsClient,
  createRemoteSkillsClient,
} from "./lib/remote-client.js";

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
  readPortableSkillManifest,
  runPortableSkill,
  scaffoldPortableSkill,
  validatePortableSkillDirectory,
  type PortableSkillCommand,
  type PortableSkillInput,
  type PortableSkillManifest,
  type PortableSkillRunOptions,
  type PortableSkillRunResult,
  type PortableSkillSummary,
} from "./lib/portable-skills.js";

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
  getSkillsStorageMode,
  getSkillsStorageStatus,
  getStorageDatabaseEnv,
  getStorageDatabaseUrl,
  getStorageMode,
  getStorageStatus,
  importSkillsLocalSnapshot,
  planSkillsS3SnapshotUpload,
  resolveSkillsNativeStorageConfig,
  resolveStorageConfig,
  signSkillsAwsV4Request,
  skillsPostgresSyncSchemaSql,
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
  type SkillsStorageMode,
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
