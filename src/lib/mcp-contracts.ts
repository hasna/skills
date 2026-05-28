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
  | "scheduling"
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

const skillSummarySchema = objectSchema({
  name: stringSchema("Canonical skill slug."),
  category: stringSchema("Skill category."),
  pricing: pricingSchema,
}, ["name", "category"], "Compact skill summary.");

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
  stdout: stringSchema("Captured stdout for local runs."),
  stderr: stringSchema("Captured stderr for local runs."),
  id: stringSchema("Remote run id when submitted remotely."),
  localRunId: stringSchema("Local run metadata id."),
  status: stringSchema("Run lifecycle status."),
  pricing: pricingSchema,
  remoteRun: objectSchema({}, [], "Normalized hosted remote run contract.", true),
  run: objectSchema({}, [], "Local run metadata.", true),
  nextActions: objectSchema({
    poll: stringSchema("Command to poll run status."),
    download: stringSchema("Command to download artifacts."),
  }),
}, [], "Skill run result.");

const toolContracts: McpToolContract[] = [
  {
    name: "list_skills",
    title: "List Skills",
    description: "List skills from the basic or full registry profile.",
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
    description: "Search skills by name, description, or tags.",
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
    outputSchema: objectSchema({ skills: arraySchema(skillSummarySchema) }),
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
    outputSchema: objectSchema({ skill: stringSchema("Skill slug."), pricing: pricingSchema }, ["skill", "pricing"]),
  },
  {
    name: "run_skill",
    title: "Run Skill",
    description: "Run a skill locally or through a configured remote runner.",
    params: ["name", "input?", "args?"],
    category: "execution",
    sideEffects: "local-process-or-remote-run",
    stable: true,
    inputSchema: objectSchema({ name: skillNameInput, input: runInputSchema, args: runArgsSchema }, ["name"]),
    outputSchema: runOutputSchema,
  },
  {
    name: "get_run_status",
    title: "Get Run Status",
    description: "Fetch remote run status and next actions.",
    params: ["run_id"],
    category: "execution",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema({ run_id: stringSchema("Remote or local run id.") }, ["run_id"]),
    outputSchema: objectSchema({
      contractVersion: { type: "number", description: "Remote run payload contract version." },
      runId: stringSchema("Remote run id."),
      localRunId: stringSchema("Local run id."),
      run: objectSchema({}, [], "Normalized remote run status.", true),
      nextActions: objectSchema({
        poll: stringSchema("Command to poll run status."),
        download: stringSchema("Command to download artifacts."),
      }),
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
    description: "List scheduled skill runs.",
    params: [],
    category: "scheduling",
    sideEffects: "none",
    stable: true,
    inputSchema: objectSchema(),
    outputSchema: arraySchema(objectSchema({}, [], "Schedule record.", true)),
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
