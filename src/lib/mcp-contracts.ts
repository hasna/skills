import type { SkillMeta } from "./registry.js";

export const MCP_CONTRACT_SCHEMA_VERSION = 1 as const;

export interface JsonSchemaObject {
  type?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  format?: string;
  minimum?: number;
  items?: JsonSchemaObject;
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  additionalProperties?: boolean | JsonSchemaObject;
  oneOf?: JsonSchemaObject[];
}

export type McpToolCategory =
  | "agent-session"
  | "discovery"
  | "execution"
  | "feedback"
  | "metadata"
  | "pinning"
  | "scaffolding"
  | "scheduling"
  | "storage"
  | "validation";

export type McpToolSideEffect =
  | "filesystem"
  | "local-process-or-remote-run"
  | "none"
  | "schedule-state";

export interface McpToolContract {
  name: string;
  title: string;
  description: string;
  params: string[];
  category: McpToolCategory;
  sideEffects: McpToolSideEffect;
  stable: true;
  inputSchema: JsonSchemaObject;
  outputSchema: JsonSchemaObject;
}

export interface UnknownMcpToolContract {
  name: string;
  known: false;
  description: "Unknown tool";
  params: [];
}

export type DescribedMcpToolContract =
  | (McpToolContract & { known: true })
  | UnknownMcpToolContract;

export interface McpResourceContract {
  uri: string;
  name: string;
  description: string;
  mimeType: "application/json";
  schema: JsonSchemaObject;
}

export interface McpContractManifest {
  schemaVersion: typeof MCP_CONTRACT_SCHEMA_VERSION;
  tools: McpToolContract[];
  resources: McpResourceContract[];
}

export interface SkillMcpSchemaContract {
  tool: string;
  inputSchema: JsonSchemaObject;
  outputSchema: JsonSchemaObject;
}

export interface SkillMcpMetadata {
  schemaVersion: typeof MCP_CONTRACT_SCHEMA_VERSION;
  name: string;
  slug: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  source: SkillMeta["source"] | "official";
  cliCommand: string;
  schemas: {
    install: SkillMcpSchemaContract;
    run: SkillMcpSchemaContract;
    validate: SkillMcpSchemaContract;
  };
}

const stringSchema = (description: string): JsonSchemaObject => ({
  type: "string",
  description,
});

const stringArraySchema = (description: string): JsonSchemaObject => ({
  type: "array",
  items: { type: "string" },
  description,
});

const objectSchema = (
  properties: Record<string, JsonSchemaObject> = {},
  required: string[] = [],
  description?: string,
  additionalProperties: boolean | JsonSchemaObject = false,
): JsonSchemaObject => ({
  type: "object",
  ...(description ? { description } : {}),
  properties,
  required,
  additionalProperties,
});

const arraySchema = (
  items: JsonSchemaObject,
  description?: string,
): JsonSchemaObject => ({
  type: "array",
  items,
  ...(description ? { description } : {}),
});

const skillNameInput = stringSchema("skill name or alias.");
const optionalAgentInput = stringSchema("Optional target agent slug. Use MCP registration instead of direct skill-folder installs.");
const scopeInput: JsonSchemaObject = {
  type: "string",
  enum: ["global", "project"],
  description: "Optional pin scope.",
};
const runInputSchema: JsonSchemaObject = {
  type: "object",
  description: "Structured skill input object.",
  additionalProperties: true,
};
const runArgsSchema: JsonSchemaObject = {
  type: "array",
  items: { type: "string" },
  default: [],
  description: "CLI-style string arguments passed to the skill.",
};
const paidRunApprovalSchema: JsonSchemaObject = {
  type: "boolean",
  description: "Set true only after the user has approved the quoted cost for a paid hosted run.",
};

const errorSchema = objectSchema({
  code: stringSchema("Stable error code."),
  message: stringSchema("Human-readable error message."),
  suggestions: stringArraySchema("Suggested next actions."),
}, ["code", "message"], "Structured MCP error payload.");

const pricingSchema = objectSchema({
  tier: stringSchema("Pricing tier."),
  billingUnit: stringSchema("Billing unit."),
  costCents: { type: "number", description: "Estimated or fixed cost in cents." },
  formattedCost: stringSchema("Display-ready cost."),
  estimated: { type: "boolean", description: "Whether the final cost can vary by input." },
  quoteDependsOnInput: { type: "boolean", description: "Whether input affects the quote." },
  quoteRequired: { type: "boolean", description: "Whether callers should quote before running." },
}, [], "Public pricing metadata.");

const skillAvailabilitySchema = objectSchema({
  status: {
    type: "string",
    enum: ["available", "unavailable"],
    description: "Whether hosted execution is currently available for this skill.",
  },
  code: stringSchema("Optional stable unavailability code."),
  message: stringSchema("Optional human-readable availability message."),
  details: stringArraySchema("Optional availability details."),
}, ["status"], "Hosted skill availability metadata.");

const skillSummarySchema = objectSchema({
  name: stringSchema("Canonical skill slug."),
  category: stringSchema("Skill category."),
  pricing: pricingSchema,
}, ["name", "category"], "Compact skill summary.");

const toolPrimitiveSummarySchema = objectSchema({
  name: stringSchema("Primitive tool name."),
  title: stringSchema("Display name."),
  family: stringSchema("Primitive family."),
  runtime: stringSchema("Runtime type: local, hosted, gateway, connector, or mixed."),
  description: stringSchema("Primitive description."),
}, ["name", "title", "family", "runtime", "description"], "Primitive tool summary.");

const skillToolDependencySchema = objectSchema({
  skill: stringSchema("Skill slug."),
  primitive: stringSchema("Primitive tool name."),
  family: stringSchema("Primitive family."),
  required: { type: "boolean" },
  reason: stringSchema("Why this skill depends on the primitive."),
}, ["skill", "primitive", "family", "required", "reason"], "Primitive dependency for a skill.");

const validationMessageSchema = objectSchema({
  code: stringSchema("Stable validation code."),
  message: stringSchema("Validation message."),
  path: stringSchema("Optional relative file path."),
});

const validationOutputSchema = objectSchema({
  name: stringSchema("Skill slug."),
  path: stringSchema("Skill directory path."),
  valid: { type: "boolean", description: "Whether validation passed." },
  issues: arraySchema(validationMessageSchema, "Blocking validation issues."),
  warnings: arraySchema(validationMessageSchema, "Non-blocking validation warnings."),
  metadata: objectSchema({}, [], "Validation metadata.", true),
}, ["name", "valid", "issues", "warnings"], "Skill validation result.");

const installOutputSchema = objectSchema({
  skill: stringSchema("Pinned skill slug."),
  success: { type: "boolean", description: "Whether the pin was written." },
  source: stringSchema("Pin source."),
  error: stringSchema("Optional error message."),
}, ["skill", "success"], "Skill pin result.");

const runOutputSchema = objectSchema({
  contractVersion: { type: "number", description: "Remote run payload contract version for hosted runs." },
  exitCode: { type: "number", description: "Process exit code for local runs." },
  skill: stringSchema("Canonical skill slug."),
  remote: { type: "boolean", description: "Whether the skill was submitted to the hosted runtime." },
  stdoutPreview: objectSchema({
    text: stringSchema("Truncated stdout preview."),
    length: { type: "number" },
    truncated: { type: "boolean" },
  }, [], "Default compact stdout preview."),
  stderrPreview: objectSchema({
    text: stringSchema("Truncated stderr preview."),
    length: { type: "number" },
    truncated: { type: "boolean" },
  }, [], "Default compact stderr preview."),
  stdout: stringSchema("Captured stdout for local runs when detail:true is requested."),
  stderr: stringSchema("Captured stderr for local runs when detail:true is requested."),
  id: stringSchema("Remote run id when submitted remotely."),
  localRunId: stringSchema("Local run metadata id."),
  status: stringSchema("Run lifecycle status."),
  pricing: pricingSchema,
  remoteRun: objectSchema({}, [], "Compact hosted remote run summary by default; full contract when detail:true is requested.", true),
  run: objectSchema({}, [], "Compact local run metadata by default; full metadata when detail:true is requested.", true),
  nextActions: objectSchema({
    poll: stringSchema("Command to poll run status."),
    download: stringSchema("Command to download artifacts."),
  }),
  detailHint: stringSchema("How to request the complete payload."),
}, [], "Skill run result.");

const toolContracts: McpToolContract[] = [
  {
    name: "scaffold_skill",
    title: "Scaffold Skill",
    description: "Create a portable skill folder under ~/.hasna/skills/<name> from the standard template.",
    params: ["name", "description?", "overwrite?"],
    category: "scaffolding",
    sideEffects: "filesystem",
    stable: true,
    inputSchema: objectSchema({
      name: skillNameInput,
      description: stringSchema("Short description for the new skill."),
      overwrite: { type: "boolean", default: false },
    }, ["name"]),
    outputSchema: objectSchema({
      name: stringSchema("Normalized skill name."),
      path: stringSchema("Created skill directory."),
      created: { type: "boolean" },
      manifest: objectSchema({}, [], "Portable skill manifest.", true),
    }, ["name", "path", "created", "manifest"]),
  },
  {
    name: "port_skill",
    title: "Port Skill",
    description: "Import an existing skill folder into the portable ~/.hasna/skills/<name> standard.",
    params: ["path", "name?", "overwrite?"],
    category: "scaffolding",
    sideEffects: "filesystem",
    stable: true,
    inputSchema: objectSchema({
      path: stringSchema("Existing skill folder to import."),
      name: skillNameInput,
      overwrite: { type: "boolean", default: false },
    }, ["path"]),
    outputSchema: objectSchema({
      name: stringSchema("Normalized skill name."),
      path: stringSchema("Imported skill directory."),
      created: { type: "boolean" },
      valid: { type: "boolean" },
      issues: arraySchema(validationMessageSchema),
      warnings: arraySchema(validationMessageSchema),
    }, ["name", "path", "created", "valid"]),
  },
  {
    name: "list_skills",
    title: "List Skills",
    description: "List skills from the basic or full registry profile. Returns a compact paged envelope by default.",
    params: ["category?", "profile?", "detail?", "limit?", "offset?"],
    category: "discovery",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({
      category: stringSchema("Optional exact category filter."),
      profile: { type: "string", enum: ["basic", "all"], default: "basic" },
      detail: { type: "boolean", default: false },
      limit: { type: "number", minimum: 0 },
      offset: { type: "number", minimum: 0 },
    }),
    outputSchema: objectSchema({
      skills: arraySchema(skillSummarySchema),
      total: { type: "number" },
      offset: { type: "number" },
      limit: { type: "number" },
      nextOffset: { type: "number" },
      hasMore: { type: "boolean" },
      nextArguments: objectSchema({}, [], "Arguments for the next page.", true),
      detailHint: stringSchema("How to request fuller skill objects."),
    }),
  },
  {
    name: "list_pinned_skills",
    title: "List Pinned Skills",
    description: "List project-pinned skills from .skills/project.json.",
    params: ["directory?"],
    category: "pinning",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({ directory: stringSchema("Project directory.") }),
    outputSchema: objectSchema({
      directory: stringSchema("Project directory."),
      count: { type: "number" },
      skills: stringArraySchema("Pinned skill slugs."),
    }, ["directory", "count", "skills"]),
  },
  {
    name: "search_skills",
    title: "Search Skills",
    description: "Search skills by name, description, or tags. Returns a compact paged envelope by default.",
    params: ["query", "profile?", "detail?", "limit?", "offset?"],
    category: "discovery",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({
      query: stringSchema("Search query."),
      profile: { type: "string", enum: ["basic", "all"], default: "basic" },
      detail: { type: "boolean", default: false },
      limit: { type: "number", minimum: 0 },
      offset: { type: "number", minimum: 0 },
    }, ["query"]),
    outputSchema: objectSchema({
      skills: arraySchema(skillSummarySchema),
      total: { type: "number" },
      offset: { type: "number" },
      limit: { type: "number" },
      nextOffset: { type: "number" },
      hasMore: { type: "boolean" },
      nextArguments: objectSchema({}, [], "Arguments for the next page.", true),
      detailHint: stringSchema("How to request fuller skill objects."),
    }),
  },
  {
    name: "get_skill_info",
    title: "Get Skill Info",
    description: "Get skill metadata, env vars, dependencies, and MCP schemas.",
    params: ["name"],
    category: "metadata",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({ name: skillNameInput }, ["name"]),
    outputSchema: objectSchema({}, [], "Public skill metadata.", true),
  },
  {
    name: "get_skill_docs",
    title: "Get Skill Docs",
    description: "Get skill documentation.",
    params: ["name"],
    category: "metadata",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({ name: skillNameInput }, ["name"]),
    outputSchema: { type: "string", description: "Best available skill documentation." },
  },
  {
    name: "list_tool_primitives",
    title: "List Tool Primitives",
    description: "List primitive tools used by skills across CLI, MCP, API, and hosted worker execution.",
    params: ["query?"],
    category: "discovery",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({ query: stringSchema("Optional primitive search query.") }),
    outputSchema: objectSchema({
      schemaVersion: { type: "number" },
      primitives: arraySchema(toolPrimitiveSummarySchema),
      total: { type: "number" },
    }, ["schemaVersion", "primitives", "total"]),
  },
  {
    name: "get_tool_primitive",
    title: "Get Tool Primitive",
    description: "Get one primitive tool definition by name.",
    params: ["name"],
    category: "metadata",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({ name: stringSchema("Primitive tool name.") }, ["name"]),
    outputSchema: objectSchema({}, [], "Primitive tool definition.", true),
  },
  {
    name: "get_skill_tool_dependencies",
    title: "Get Skill Tool Dependencies",
    description: "Get primitive tool dependencies for one skill.",
    params: ["name"],
    category: "metadata",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({ name: skillNameInput }, ["name"]),
    outputSchema: objectSchema({
      schemaVersion: { type: "number" },
      skill: skillNameInput,
      category: stringSchema("Skill category."),
      source: stringSchema("Skill source."),
      dependencies: arraySchema(skillToolDependencySchema),
      gatewayBacked: { type: "boolean" },
      hostedRuntime: { type: "boolean" },
    }, ["schemaVersion", "skill", "category", "dependencies", "gatewayBacked", "hostedRuntime"]),
  },
  {
    name: "validate_tool_primitives",
    title: "Validate Tool Primitives",
    description: "Validate primitive tool coverage for the bundled skill catalog.",
    params: ["profile?"],
    category: "validation",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({
      profile: { type: "string", enum: ["basic", "all"], default: "all" },
    }),
    outputSchema: objectSchema({
      schemaVersion: { type: "number" },
      valid: { type: "boolean" },
      profile: stringSchema("Registry profile."),
      skillCount: { type: "number" },
      primitiveCount: { type: "number" },
      mappedSkillCount: { type: "number" },
      gatewayBackedSkillCount: { type: "number" },
      hostedRuntimeSkillCount: { type: "number" },
      issues: arraySchema(objectSchema({}, [], "Coverage issue.", true)),
    }, ["schemaVersion", "valid", "profile", "skillCount", "primitiveCount", "mappedSkillCount", "issues"]),
  },
  {
    name: "pin_skill",
    title: "Pin Skill",
    description: "Pin a skill in project state.",
    params: ["name", "for?", "scope?"],
    category: "pinning",
    sideEffects: "filesystem",
    stable: true,
    inputSchema: objectSchema({
      name: skillNameInput,
      for: optionalAgentInput,
      scope: scopeInput,
    }, ["name"]),
    outputSchema: installOutputSchema,
  },
  {
    name: "pin_category",
    title: "Pin Category",
    description: "Pin all skills in a category.",
    params: ["category", "for?", "scope?"],
    category: "pinning",
    sideEffects: "filesystem",
    stable: true,
    inputSchema: objectSchema({
      category: stringSchema("Category name."),
      for: optionalAgentInput,
      scope: scopeInput,
    }, ["category"]),
    outputSchema: objectSchema({ category: stringSchema("Category name."), count: { type: "number" }, results: arraySchema(installOutputSchema) }),
  },
  {
    name: "unpin_skill",
    title: "Unpin Skill",
    description: "Remove a skill pin from project state.",
    params: ["name", "for?", "scope?"],
    category: "pinning",
    sideEffects: "filesystem",
    stable: true,
    inputSchema: objectSchema({ name: skillNameInput, for: optionalAgentInput, scope: scopeInput }, ["name"]),
    outputSchema: objectSchema({ skill: stringSchema("Skill slug."), removed: { type: "boolean" } }, ["skill", "removed"]),
  },
  {
    name: "list_categories",
    title: "List Categories",
    description: "List skill categories with counts.",
    params: [],
    category: "discovery",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema(),
    outputSchema: arraySchema(objectSchema({ name: stringSchema("Category name."), count: { type: "number" } })),
  },
  {
    name: "list_tags",
    title: "List Tags",
    description: "List all skill tags with counts.",
    params: [],
    category: "discovery",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema(),
    outputSchema: arraySchema(objectSchema({ name: stringSchema("Tag name."), count: { type: "number" } })),
  },
  {
    name: "get_requirements",
    title: "Get Requirements",
    description: "Get env vars, system deps, and package dependencies for a skill.",
    params: ["name"],
    category: "metadata",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({ name: skillNameInput }, ["name"]),
    outputSchema: objectSchema({
      envVars: stringArraySchema("Environment variable names."),
      systemDeps: stringArraySchema("System dependency names."),
      cliCommand: stringSchema("Preferred CLI command."),
      dependencies: objectSchema({}, [], "Package dependencies.", true),
    }),
  },
  {
    name: "quote_skill",
    title: "Quote Skill",
    description: "Quote a skill run before execution.",
    params: ["name", "input?", "args?"],
    category: "execution",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({ name: skillNameInput, input: runInputSchema, args: runArgsSchema }, ["name"]),
    outputSchema: objectSchema({
      skill: stringSchema("Skill slug."),
      pricing: pricingSchema,
      availability: skillAvailabilitySchema,
      error: stringSchema("Optional error message when the quote cannot be used to run."),
      code: stringSchema("Optional stable error code."),
      details: stringArraySchema("Optional error details."),
    }, ["skill", "pricing", "availability"]),
  },
  {
    name: "run_skill",
    title: "Run Skill",
    description: "Run a skill locally or through a configured remote runner. Returns compact stdout/stderr previews and run summaries by default; pass detail:true for full records.",
    params: ["name", "input?", "args?", "approved?", "detail?"],
    category: "execution",
    sideEffects: "local-process-or-remote-run",
    stable: true,
    inputSchema: objectSchema({
      name: skillNameInput,
      input: runInputSchema,
      args: runArgsSchema,
      approved: paidRunApprovalSchema,
      detail: { type: "boolean", default: false, description: "Return full stdout/stderr, remote run, and local run metadata." },
    }, ["name"]),
    outputSchema: runOutputSchema,
  },
  {
    name: "get_run_status",
    title: "Get Run Status",
    description: "Fetch remote run status and next actions. Returns a compact status summary by default; pass detail:true for the complete remote run payload.",
    params: ["run_id", "detail?"],
    category: "execution",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({
      run_id: stringSchema("Remote or local run id."),
      detail: { type: "boolean", default: false, description: "Return the complete remote run payload." },
    }, ["run_id"]),
    outputSchema: objectSchema({
      contractVersion: { type: "number", description: "Remote run payload contract version." },
      runId: stringSchema("Remote run id."),
      localRunId: stringSchema("Local run id."),
      run: objectSchema({}, [], "Compact remote run status by default; full status when detail:true is requested.", true),
      nextActions: objectSchema({
        poll: stringSchema("Command to poll run status."),
        download: stringSchema("Command to download artifacts."),
      }),
      detailHint: stringSchema("How to request the complete payload."),
    }),
  },
  {
    name: "export_skills",
    title: "Export Pinned Skills",
    description: "Export pinned skills as a portable JSON payload.",
    params: [],
    category: "pinning",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema(),
    outputSchema: objectSchema({ version: { type: "number" }, skills: stringArraySchema("Pinned skill slugs."), timestamp: stringSchema("ISO timestamp.") }),
  },
  {
    name: "import_skills",
    title: "Import Pinned Skills",
    description: "Pin skills from an export payload.",
    params: ["skills", "for?", "scope?"],
    category: "pinning",
    sideEffects: "filesystem",
    stable: true,
    inputSchema: objectSchema({ skills: stringArraySchema("Skill slugs."), for: optionalAgentInput, scope: scopeInput }, ["skills"]),
    outputSchema: objectSchema({ imported: { type: "number" }, total: { type: "number" }, results: arraySchema(installOutputSchema) }),
  },
  {
    name: "whoami",
    title: "Skills Whoami",
    description: "Show package, install, and agent setup details.",
    params: [],
    category: "metadata",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema(),
    outputSchema: objectSchema({}, [], "Setup summary.", true),
  },
  {
    name: "storage_status",
    title: "Storage Status",
    description: "Show local-first storage paths and optional repo-owned Postgres/S3 readiness.",
    params: ["directory?"],
    category: "storage",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({ directory: stringSchema("Project directory.") }),
    outputSchema: objectSchema({
      package: stringSchema("Package name."),
      mode: { type: "string", enum: ["local", "remote", "hybrid"] },
      local: objectSchema({}, [], "Local storage paths.", true),
      remote: objectSchema({}, [], "Remote storage readiness.", true),
    }, ["package", "mode", "local", "remote"]),
  },
  {
    name: "storage_sync_plan",
    title: "Storage Sync Plan",
    description: "Plan .skills snapshot sync for optional Postgres/S3 storage without network access.",
    params: ["directory?", "includeSchemaSql?"],
    category: "storage",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({
      directory: stringSchema("Project directory."),
      includeSchemaSql: { type: "boolean", default: false },
    }),
    outputSchema: objectSchema({
      package: stringSchema("Package name."),
      noNetwork: { type: "boolean", const: true },
      mode: { type: "string", enum: ["local", "remote", "hybrid"] },
      databaseConfigured: { type: "boolean" },
      s3Configured: { type: "boolean" },
      snapshotFileCount: { type: "number" },
      s3ObjectCount: { type: "number" },
      env: objectSchema({}, [], "Storage env var names.", true),
      schemaSql: stringSchema("Optional Postgres schema SQL."),
    }, ["package", "noNetwork", "mode", "databaseConfigured", "s3Configured"]),
  },
  {
    name: "schedule_skill",
    title: "Schedule Skill",
    description: "Create a cron schedule for a skill.",
    params: ["skill", "cron", "name?", "args?"],
    category: "scheduling",
    sideEffects: "schedule-state",
    stable: true,
    inputSchema: objectSchema({
      skill: skillNameInput,
      cron: stringSchema("Five-field cron expression."),
      name: stringSchema("Optional schedule name."),
      args: runArgsSchema,
    }, ["skill", "cron"]),
    outputSchema: objectSchema({}, [], "Schedule record.", true),
  },
  {
    name: "list_schedules",
    title: "List Schedules",
    description: "List scheduled skill runs as a compact paged envelope.",
    params: ["limit?", "offset?"],
    category: "scheduling",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({
      limit: { type: "number", minimum: 0 },
      offset: { type: "number", minimum: 0 },
    }),
    outputSchema: objectSchema({
      schedules: arraySchema(objectSchema({}, [], "Compact schedule record.", true)),
      total: { type: "number" },
      offset: { type: "number" },
      limit: { type: "number" },
      nextOffset: { type: "number" },
      hasMore: { type: "boolean" },
      nextArguments: objectSchema({}, [], "Arguments for the next page.", true),
      detailHint: stringSchema("How to request complete schedule details."),
    }),
  },
  {
    name: "remove_schedule",
    title: "Remove Schedule",
    description: "Remove a schedule by id or name.",
    params: ["id_or_name"],
    category: "scheduling",
    sideEffects: "schedule-state",
    stable: true,
    inputSchema: objectSchema({ id_or_name: stringSchema("Schedule id or name.") }, ["id_or_name"]),
    outputSchema: objectSchema({ removed: { type: "boolean" }, id_or_name: stringSchema("Requested id or name.") }),
  },
  {
    name: "detect_project_skills",
    title: "Detect Project Skills",
    description: "Detect project type and recommended skills.",
    params: ["directory?"],
    category: "discovery",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({ directory: stringSchema("Project directory.") }),
    outputSchema: objectSchema({ directory: stringSchema("Project directory."), detected: stringArraySchema("Detected project signals."), recommended: arraySchema(skillSummarySchema) }),
  },
  {
    name: "validate_skill",
    title: "Validate Skill",
    description: "Validate a skill directory using the shared skill validator.",
    params: ["name"],
    category: "validation",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({ name: skillNameInput }, ["name"]),
    outputSchema: validationOutputSchema,
  },
  {
    name: "search_tools",
    title: "Search Tools",
    description: "List tool names or summaries, optionally filtered by keyword.",
    params: ["query?", "detail?"],
    category: "metadata",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({ query: stringSchema("Tool search query."), detail: { type: "boolean", default: false } }),
    outputSchema: objectSchema({ schemaVersion: { type: "number" }, tools: arraySchema(objectSchema({}, [], "Tool name or summary.", true)), total: { type: "number" } }),
  },
  {
    name: "describe_tools",
    title: "Describe Tools",
    description: "Return structured descriptions for named tools.",
    params: ["names"],
    category: "metadata",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({ names: stringArraySchema("Tool names.") }, ["names"]),
    outputSchema: objectSchema({ schemaVersion: { type: "number" }, tools: arraySchema(objectSchema({}, [], "Tool contract.", true)) }),
  },
  {
    name: "get_mcp_contracts",
    title: "Get MCP Contracts",
    description: "Return the machine-readable MCP tool and resource contract manifest.",
    params: ["names?", "includeResources?"],
    category: "metadata",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({
      names: stringArraySchema("Optional tool names to include."),
      includeResources: { type: "boolean", default: false },
    }),
    outputSchema: objectSchema({ schemaVersion: { type: "number" }, tools: arraySchema(objectSchema({}, [], "Tool contract.", true)), resources: arraySchema(objectSchema({}, [], "Resource contract.", true)) }),
  },
  {
    name: "register_agent",
    title: "Register Agent",
    description: "Register an agent session and return an agent id.",
    params: ["name", "session_id?"],
    category: "agent-session",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({ name: stringSchema("Agent name."), session_id: stringSchema("Optional session id.") }, ["name"]),
    outputSchema: objectSchema({ id: stringSchema("Agent id."), name: stringSchema("Agent name."), last_seen_at: stringSchema("ISO timestamp."), registered: { type: "boolean" } }),
  },
  {
    name: "heartbeat",
    title: "Heartbeat",
    description: "Update agent last_seen_at.",
    params: ["agent_id"],
    category: "agent-session",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({ agent_id: stringSchema("Agent id.") }, ["agent_id"]),
    outputSchema: objectSchema({ agent_id: stringSchema("Agent id."), active: { type: "boolean" }, last_seen_at: stringSchema("ISO timestamp.") }),
  },
  {
    name: "set_focus",
    title: "Set Focus",
    description: "Set or clear active project context for an agent.",
    params: ["agent_id", "project_id?"],
    category: "agent-session",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({ agent_id: stringSchema("Agent id."), project_id: stringSchema("Optional project id.") }, ["agent_id"]),
    outputSchema: objectSchema({ agent_id: stringSchema("Agent id."), project_id: stringSchema("Current project id.") }),
  },
  {
    name: "list_agents",
    title: "List Agents",
    description: "List registered in-memory agent sessions.",
    params: [],
    category: "agent-session",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema(),
    outputSchema: objectSchema({ agents: arraySchema(objectSchema({}, [], "Agent record.", true)), total: { type: "number" } }),
  },
  {
    name: "send_feedback",
    title: "Send Feedback",
    description: "Store local feedback for this service.",
    params: ["message", "email?", "category?"],
    category: "feedback",
    sideEffects: "filesystem",
    stable: true,
    inputSchema: objectSchema({
      message: stringSchema("Feedback message."),
      email: stringSchema("Optional contact email."),
      category: { type: "string", enum: ["bug", "feature", "general"] },
    }, ["message"]),
    outputSchema: objectSchema({}, [], "Feedback save result.", true),
  },
];

const contracts: McpToolContract[] = [...toolContracts].sort((a, b) => a.name.localeCompare(b.name));

const resourceContracts: McpResourceContract[] = [
  {
    uri: "skills://mcp/contracts",
    name: "MCP Contracts",
    description: "Machine-readable MCP tool and resource contract manifest.",
    mimeType: "application/json",
    schema: objectSchema({
      schemaVersion: { type: "number", const: MCP_CONTRACT_SCHEMA_VERSION },
      tools: arraySchema(objectSchema({}, [], "Tool contract.", true)),
      resources: arraySchema(objectSchema({}, [], "Resource contract.", true)),
    }),
  },
  {
    uri: "skills://registry",
    name: "Skills Registry",
    description: "Compact default skill registry.",
    mimeType: "application/json",
    schema: arraySchema(skillSummarySchema),
  },
  {
    uri: "skills://tool-primitives",
    name: "Tool Primitives",
    description: "Primitive tool catalog used by skills across CLI, MCP, API, and hosted workers.",
    mimeType: "application/json",
    schema: arraySchema(toolPrimitiveSummarySchema),
  },
  {
    uri: "skills://{name}",
    name: "Skill Info",
    description: "Individual skill metadata, documentation, requirements, and MCP schemas.",
    mimeType: "application/json",
    schema: objectSchema({}, [], "Skill detail resource.", true),
  },
];

export function listMcpToolContracts(query?: string): McpToolContract[] {
  const needle = query?.toLowerCase();
  const filtered = needle
    ? contracts.filter((contract) => {
      const haystack = [
        contract.name,
        contract.title,
        contract.description,
        contract.category,
        ...contract.params,
      ].join(" ").toLowerCase();
      return haystack.includes(needle);
    })
    : contracts;
  return clone(filtered);
}

export function describeMcpToolContracts(names: string[]): DescribedMcpToolContract[] {
  const byName = new Map(contracts.map((contract) => [contract.name, contract]));
  return names.map((name) => {
    const contract = byName.get(name);
    if (!contract) {
      return {
        name,
        known: false,
        description: "Unknown tool",
        params: [],
      };
    }
    return { ...clone(contract), known: true };
  });
}

export function summarizeMcpToolContract(contract: McpToolContract): Pick<McpToolContract, "name" | "title" | "description" | "params" | "category" | "sideEffects"> {
  return {
    name: contract.name,
    title: contract.title,
    description: contract.description,
    params: [...contract.params],
    category: contract.category,
    sideEffects: contract.sideEffects,
  };
}

export function getMcpResourceContracts(): McpResourceContract[] {
  return clone(resourceContracts);
}

export function createMcpContractManifest(options: { names?: string[]; includeResources?: boolean } = {}): McpContractManifest {
  const selectedNames = options.names ? new Set(options.names) : null;
  const tools = selectedNames
    ? contracts.filter((contract) => selectedNames.has(contract.name))
    : contracts;
  return {
    schemaVersion: MCP_CONTRACT_SCHEMA_VERSION,
    tools: clone(tools),
    resources: options.includeResources === false ? [] : getMcpResourceContracts(),
  };
}

export function createSkillMcpMetadata(skill: SkillMeta): SkillMcpMetadata {
  const installInput = clone(getRequiredContract("pin_skill").inputSchema);
  const runInput = clone(getRequiredContract("run_skill").inputSchema);
  const validateInput = clone(getRequiredContract("validate_skill").inputSchema);

  installInput.properties = {
    ...installInput.properties,
    name: {
      type: "string",
      const: skill.name,
      description: "Skill name or alias to pin.",
    },
  };
  runInput.properties = {
    ...runInput.properties,
    name: {
      type: "string",
      const: skill.name,
      description: "Skill name or alias to run.",
    },
  };
  validateInput.properties = {
    ...validateInput.properties,
    name: {
      type: "string",
      const: skill.name,
      description: "Skill name or alias to validate.",
    },
  };

  return {
    schemaVersion: MCP_CONTRACT_SCHEMA_VERSION,
    name: skill.name,
    slug: skill.name,
    displayName: skill.displayName,
    description: skill.description,
    category: skill.category,
    tags: [...skill.tags].sort(),
    source: skill.source ?? "official",
    cliCommand: `skills run ${skill.name}`,
    schemas: {
      install: {
        tool: "pin_skill",
        inputSchema: installInput,
        outputSchema: clone(getRequiredContract("pin_skill").outputSchema),
      },
      run: {
        tool: "run_skill",
        inputSchema: runInput,
        outputSchema: clone(getRequiredContract("run_skill").outputSchema),
      },
      validate: {
        tool: "validate_skill",
        inputSchema: validateInput,
        outputSchema: clone(getRequiredContract("validate_skill").outputSchema),
      },
    },
  };
}

export function getMcpToolDescriptions(): Record<string, { description: string; params: string[] }> {
  return Object.fromEntries(
    contracts.map((contract) => [
      contract.name,
      { description: contract.description, params: [...contract.params] },
    ]),
  );
}

function getRequiredContract(name: string): McpToolContract {
  const contract = contracts.find((candidate) => candidate.name === name);
  if (!contract) throw new Error(`Missing MCP tool contract: ${name}`);
  return contract;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const MCP_ERROR_RESPONSE_SCHEMA = errorSchema;
