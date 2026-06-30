export type SkillsCliMcpParityDomain =
  | "discovery"
  | "portable-skills"
  | "runtime"
  | "tool-primitives"
  | "validation";

export interface SkillsCliMcpParityEntry {
  domain: SkillsCliMcpParityDomain;
  operation: string;
  cliCommands: string[];
  mcpTools: string[];
  jsonContracts: string[];
  status: "matched" | "intentional-gap";
  notes?: string;
}

export const SKILLS_CLI_MCP_PARITY: SkillsCliMcpParityEntry[] = [
  {
    domain: "portable-skills",
    operation: "scaffold",
    cliCommands: ["skills new", "skills scaffold"],
    mcpTools: ["scaffold_skill"],
    jsonContracts: ["portable_skill_write_result", "structured_error"],
    status: "matched",
  },
  {
    domain: "portable-skills",
    operation: "port",
    cliCommands: ["skills port", "skills add"],
    mcpTools: ["port_skill"],
    jsonContracts: ["portable_skill_write_result", "skill_validation_result", "structured_error"],
    status: "matched",
  },
  {
    domain: "portable-skills",
    operation: "list",
    cliCommands: ["skills list"],
    mcpTools: ["list_skills"],
    jsonContracts: ["public_skill_discovery"],
    status: "matched",
    notes: "Portable skills under ~/.hasna/skills/<name> are merged into the custom registry.",
  },
  {
    domain: "portable-skills",
    operation: "show",
    cliCommands: ["skills show", "skills info"],
    mcpTools: ["get_skill_info", "get_skill_docs"],
    jsonContracts: ["public_skill_discovery", "skill_docs"],
    status: "matched",
  },
  {
    domain: "portable-skills",
    operation: "run",
    cliCommands: ["skills run"],
    mcpTools: ["run_skill"],
    jsonContracts: ["skill_run_result", "structured_error"],
    status: "matched",
  },
  {
    domain: "portable-skills",
    operation: "validate",
    cliCommands: ["skills validate"],
    mcpTools: ["validate_skill"],
    jsonContracts: ["skill_validation_result", "structured_error"],
    status: "matched",
  },
  {
    domain: "tool-primitives",
    operation: "list",
    cliCommands: ["skills tools list"],
    mcpTools: ["list_tool_primitives"],
    jsonContracts: ["tool_primitive_summary"],
    status: "matched",
  },
  {
    domain: "tool-primitives",
    operation: "deps",
    cliCommands: ["skills tools deps"],
    mcpTools: ["get_skill_tool_dependencies"],
    jsonContracts: ["skill_tool_dependencies"],
    status: "matched",
  },
  {
    domain: "tool-primitives",
    operation: "validate",
    cliCommands: ["skills tools validate"],
    mcpTools: ["validate_tool_primitives"],
    jsonContracts: ["tool_primitive_coverage_result"],
    status: "matched",
  },
];

export function validateSkillsCliMcpParity(): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const entry of SKILLS_CLI_MCP_PARITY) {
    const key = `${entry.domain}:${entry.operation}`;
    if (seen.has(key)) issues.push(`Duplicate parity entry: ${key}`);
    seen.add(key);
    if (!entry.cliCommands.length) issues.push(`Parity entry ${key} has no CLI commands`);
    if (!entry.mcpTools.length) issues.push(`Parity entry ${key} has no MCP tools`);
    if (!entry.jsonContracts.length) issues.push(`Parity entry ${key} has no JSON contracts`);
    for (const command of entry.cliCommands) {
      if (!command.startsWith("skills ")) issues.push(`CLI command '${command}' must start with 'skills '`);
    }
  }
  return issues;
}

export function findSkillsParityForCliCommand(command: string): SkillsCliMcpParityEntry | undefined {
  return SKILLS_CLI_MCP_PARITY.find((entry) => entry.cliCommands.includes(command));
}

export function findSkillsParityForMcpTool(tool: string): SkillsCliMcpParityEntry | undefined {
  return SKILLS_CLI_MCP_PARITY.find((entry) => entry.mcpTools.includes(tool));
}
