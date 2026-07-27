import { describe, expect, test } from "bun:test";

import {
  SKILLS_CLI_MCP_PARITY,
  findSkillsParityForCliCommand,
  findSkillsParityForMcpTool,
  validateSkillsCliMcpParity,
} from "./cli-mcp-parity";
import { listMcpToolContracts } from "./mcp-contracts";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

describe("skills CLI/MCP parity", () => {
  test("documents portable skill workflow parity", () => {
    expect(validateSkillsCliMcpParity()).toEqual([]);
    expect(findSkillsParityForCliCommand("skills new")).toMatchObject({
      domain: "portable-skills",
      mcpTools: ["scaffold_skill"],
    });
    expect(findSkillsParityForCliCommand("skills scaffold")).toMatchObject({
      mcpTools: ["scaffold_skill"],
    });
    expect(findSkillsParityForCliCommand("skills port")).toMatchObject({
      mcpTools: ["port_skill"],
    });
    expect(findSkillsParityForMcpTool("run_skill")?.cliCommands).toContain("skills run");
  });

  test("portable parity MCP tools exist in the shared contract manifest", () => {
    const knownTools = new Set(listMcpToolContracts().map((tool) => tool.name));
    const portable = SKILLS_CLI_MCP_PARITY.filter((entry) => entry.domain === "portable-skills");
    expect(portable.length).toBeGreaterThanOrEqual(6);

    for (const entry of portable) {
      for (const tool of entry.mcpTools) {
        expect(knownTools.has(tool)).toBe(true);
      }
    }
  });
});
