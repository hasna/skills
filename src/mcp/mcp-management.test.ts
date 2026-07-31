import { describe, test, expect } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
import {
  EXPECTED_BASIC_SKILL_COUNT,
  McpClient,
} from "./mcp-test-client.js";

useDefaultTestTimeout();

describe("MCP Server management and resources", () => {
  test("calls pin_skill tool for nonexistent skill", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "pin_skill",
        arguments: { name: "nonexistent-xyz-999" },
      }, 16);
      expect(response).not.toBeNull();
      expect(response.result.isError).toBe(true);
    } finally {
      await client.close();
    }
  }, 15000);

  test("calls unpin_skill tool for non-pinned skill", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "unpin_skill",
        arguments: { name: "nonexistent-xyz-999" },
      }, 17);
      expect(response).not.toBeNull();
      const result = JSON.parse(response.result.content[0].text);
      expect(result.removed).toBe(false);
    } finally {
      await client.close();
    }
  }, 15000);

  test("calls list_tags tool", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "list_tags",
        arguments: {},
      }, 20);
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      const tags = JSON.parse(response.result.content[0].text);
      expect(Array.isArray(tags)).toBe(true);
      expect(tags.length).toBeGreaterThan(0);
      expect(tags[0]).toHaveProperty("name");
      expect(tags[0]).toHaveProperty("count");
      // Tags should be sorted alphabetically
      for (let i = 1; i < tags.length; i++) {
        expect(tags[i].name.localeCompare(tags[i - 1].name)).toBeGreaterThanOrEqual(0);
      }
    } finally {
      await client.close();
    }
  }, 15000);

  test("list_tags is included in tools list", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/list");
      const toolNames = response.result.tools.map((t: any) => t.name);
      expect(toolNames).toContain("list_tags");
    } finally {
      await client.close();
    }
  }, 15000);

  test("pin_category is included in tools list", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/list");
      const toolNames = response.result.tools.map((t: any) => t.name);
      expect(toolNames).toContain("pin_category");
    } finally {
      await client.close();
    }
  }, 15000);

  test("pin_category returns error for unknown category", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "pin_category",
        arguments: { category: "Fake Category" },
      }, 30);
      expect(response).not.toBeNull();
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0].text).toContain("Unknown category");
    } finally {
      await client.close();
    }
  }, 15000);

  test("pin_category pins all skills in a category", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "pin_category",
        arguments: { category: "Development Tools" },
      }, 31);
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      const result = JSON.parse(response.result.content[0].text);
      expect(result.category).toBe("Development Tools");
      // 5 instruction + 23 restored credential-free executable skills.
      expect(result.count).toBe(28);
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.results.length).toBe(28);
    } finally {
      await client.close();
    }
  }, 15000);

  test("reads skills://registry resource", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("resources/read", {
        uri: "skills://registry",
      }, 18);
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      const skills = JSON.parse(response.result.contents[0].text);
      expect(Array.isArray(skills)).toBe(true);
      expect(skills.length).toBe(EXPECTED_BASIC_SKILL_COUNT);
      expect(skills.map((s: any) => s.name)).not.toContain("brand-kit");
      expect(skills[0]).not.toHaveProperty("pricing");
      for (const s of skills) {
        expect(typeof s.description).toBe("string");
        expect(s.description.length).toBeGreaterThan(0);
      }
    } finally {
      await client.close();
    }
  }, 15000);

  test("reads skills://mcp/contracts resource", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("resources/read", {
        uri: "skills://mcp/contracts",
      }, 82);
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      const manifest = JSON.parse(response.result.contents[0].text);
      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.tools.map((tool: any) => tool.name)).toContain("run_skill");
      const runSkill = manifest.tools.find((tool: any) => tool.name === "run_skill");
      expect(runSkill.inputSchema.properties).toHaveProperty("args");
      expect(manifest.resources.map((resource: any) => resource.uri)).toContain("skills://{name}");
    } finally {
      await client.close();
    }
  }, 15000);

  test("reads public skill resource with sanitized metadata", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("resources/read", {
        uri: "skills://brand-kit",
      }, 33);
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      const info = JSON.parse(response.result.contents[0].text);
      expect(info.name).toBe("brand-kit");
      expect(info).not.toHaveProperty("pricing");
                  expect(info.requirements.envVars).not.toContain("SKILL_API_KEY");
      expect(info.requirements.envVars).not.toContain("OPENAI_API_KEY");
      expect(info.mcp).toMatchObject({
        schemaVersion: 1,
        name: "brand-kit",
        schemas: {
          install: {
            inputSchema: {
              properties: {
                name: { const: "brand-kit" },
              },
            },
          },
          run: {
            inputSchema: {
              properties: {
                name: { const: "brand-kit" },
                args: { type: "array" },
              },
            },
          },
        },
      });
      expect(JSON.stringify(info).toLowerCase()).not.toContain("openai");
      expect(JSON.stringify(info).toLowerCase()).not.toContain("gemini");
      expect(JSON.stringify(info).toLowerCase()).not.toContain("minimax");
    } finally {
      await client.close();
    }
  }, 15000);

  test("export_skills is included in tools list", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/list");
      const toolNames = response.result.tools.map((t: any) => t.name);
      expect(toolNames).toContain("export_skills");
    } finally {
      await client.close();
    }
  }, 15000);

  test("import_skills is included in tools list", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/list");
      const toolNames = response.result.tools.map((t: any) => t.name);
      expect(toolNames).toContain("import_skills");
    } finally {
      await client.close();
    }
  }, 15000);

  test("calls export_skills tool and returns valid payload", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "export_skills",
        arguments: {},
      }, 40);
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      const payload = JSON.parse(response.result.content[0].text);
      expect(payload).toHaveProperty("version", 1);
      expect(payload).toHaveProperty("skills");
      expect(payload).toHaveProperty("timestamp");
      expect(Array.isArray(payload.skills)).toBe(true);
      // timestamp should be a valid ISO date
      expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);
    } finally {
      await client.close();
    }
  }, 15000);

  test("calls import_skills with empty list returns 0 imported", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "import_skills",
        arguments: { skills: [] },
      }, 41);
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      const result = JSON.parse(response.result.content[0].text);
      expect(result.imported).toBe(0);
      expect(Array.isArray(result.results)).toBe(true);
    } finally {
      await client.close();
    }
  }, 15000);

  test("import_skills nonexistent skill returns isError", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "import_skills",
        arguments: { skills: ["nonexistent-xyz-999"] },
      }, 42);
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      expect(response.result.isError).toBe(true);
      const result = JSON.parse(response.result.content[0].text);
      expect(result.imported).toBe(0);
      expect(result.total).toBe(1);
      expect(result.results[0].success).toBe(false);
    } finally {
      await client.close();
    }
  }, 15000);

  test("import_skills with invalid agent returns isError", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "import_skills",
        arguments: { skills: ["brand-kit"], for: "invalid-agent" },
      }, 43);
      expect(response).not.toBeNull();
      expect(response.result.isError).toBe(true);
    } finally {
      await client.close();
    }
  }, 15000);

  test("validate_skill uses structured validation result", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const validResponse = await client.request("tools/call", {
        name: "validate_skill",
        arguments: { name: "brand-kit" },
      }, 44);
      expect(validResponse).not.toBeNull();
      const validResult = JSON.parse(validResponse.result.content[0].text);
      expect(validResult.valid).toBe(true);
      expect(validResult.metadata.runtime).toBe("none");
      expect(validResult.metadata.binCommands).toEqual([]);

      const missingResponse = await client.request("tools/call", {
        name: "validate_skill",
        arguments: { name: "not-a-skill" },
      }, 45);
      expect(missingResponse).not.toBeNull();
      expect(missingResponse.result.isError).toBe(true);
      const missingResult = JSON.parse(missingResponse.result.content[0].text);
      expect(missingResult.valid).toBe(false);
      expect(missingResult.issues[0].code).toBe("skill.dir_missing");
    } finally {
      await client.close();
    }
  }, 15000);

  test("storage tools return on-box status and no-network sync plan", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const statusResponse = await client.request("tools/call", {
        name: "storage_status",
        arguments: {},
      }, 85);
      expect(statusResponse).not.toBeNull();
      const status = JSON.parse(statusResponse.result.content[0].text);
      expect(status).toMatchObject({
        package: "open-skills",
        tables: ["skills_sync_records", "skills_sync_cursors"],
        remote: {
          databaseConfigured: false,
          s3Configured: false,
          databaseEnv: "HASNA_SKILLS_DATABASE_URL",
          activeDatabaseEnv: "HASNA_SKILLS_DATABASE_URL",
          s3BucketEnv: "HASNA_SKILLS_S3_BUCKET",
        },
      });
      expect(status.local.projectStateDir).toContain(".skills");
      expect(status).not.toHaveProperty("mode");

      const planResponse = await client.request("tools/call", {
        name: "storage_sync_plan",
        arguments: { includeSchemaSql: true },
      }, 86);
      expect(planResponse).not.toBeNull();
      const plan = JSON.parse(planResponse.result.content[0].text);
      expect(plan).toMatchObject({
        package: "open-skills",
        noNetwork: true,
        databaseConfigured: false,
        s3Configured: false,
      });
      expect(plan).not.toHaveProperty("mode");
      expect(plan.env.databaseUrl).toBe("HASNA_SKILLS_DATABASE_URL");
      expect(plan.schemaSql).toContain("CREATE TABLE IF NOT EXISTS skills_sync_records");
    } finally {
      await client.close();
    }
  }, 15000);

  test("meta tools return structured tool contracts", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const searchResponse = await client.request("tools/call", {
        name: "search_tools",
        arguments: { query: "skill" },
      }, 46);
      expect(searchResponse).not.toBeNull();
      const searchResult = JSON.parse(searchResponse.result.content[0].text);
      expect(searchResult.schemaVersion).toBe(1);
      expect(searchResult.tools).toContain("validate_skill");
      expect(searchResult.tools).not.toContain("quote_skill");
      expect(searchResult.tools).toContain("run_skill");

      const storageSearchResponse = await client.request("tools/call", {
        name: "search_tools",
        arguments: { query: "storage" },
      }, 87);
      expect(storageSearchResponse).not.toBeNull();
      const storageSearch = JSON.parse(storageSearchResponse.result.content[0].text);
      expect(storageSearch.tools).toEqual(["storage_status", "storage_sync_plan"]);

      const detailedSearchResponse = await client.request("tools/call", {
        name: "search_tools",
        arguments: { query: "run", detail: true },
      }, 83);
      expect(detailedSearchResponse).not.toBeNull();
      const detailedSearchResult = JSON.parse(detailedSearchResponse.result.content[0].text);
      const runSummary = detailedSearchResult.tools.find((tool: any) => tool.name === "run_skill");
      expect(runSummary).toMatchObject({
        category: "execution",
        sideEffects: "local-process-or-remote-run",
      });

      const describeResponse = await client.request("tools/call", {
        name: "describe_tools",
        arguments: { names: ["validate_skill", "send_feedback", "get_run_status", "storage_sync_plan"] },
      }, 47);
      expect(describeResponse).not.toBeNull();
      const describeResult = JSON.parse(describeResponse.result.content[0].text);
      expect(describeResult.schemaVersion).toBe(1);
      expect(describeResult.tools[0]).toMatchObject({
        name: "validate_skill",
        known: true,
        description: "Validate a skill directory using the shared skill validator.",
        params: ["name"],
        inputSchema: {
          type: "object",
          required: ["name"],
        },
      });
      expect(describeResult.tools[1].params).toContain("category?");
      expect(describeResult.tools[2]).toMatchObject({
        name: "get_run_status",
        known: true,
        params: ["run_id", "detail?"],
      });
      expect(describeResult.tools[2].description).toContain("compact status summary");
      expect(describeResult.tools[3]).toMatchObject({
        name: "storage_sync_plan",
        known: true,
        category: "storage",
        sideEffects: "none",
      });

      const contractsResponse = await client.request("tools/call", {
        name: "get_mcp_contracts",
        arguments: { names: ["pin_skill", "run_skill", "storage_status"], includeResources: true },
      }, 84);
      expect(contractsResponse).not.toBeNull();
      const contractsResult = JSON.parse(contractsResponse.result.content[0].text);
      expect(contractsResult.schemaVersion).toBe(1);
      expect(contractsResult.tools.map((tool: any) => tool.name)).toEqual(["pin_skill", "run_skill", "storage_status"]);
      expect(contractsResult.resources.map((resource: any) => resource.uri)).toContain("skills://mcp/contracts");
    } finally {
      await client.close();
    }
  }, 15000);

  test("agent registration tools return JSON contracts", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const registerResponse = await client.request("tools/call", {
        name: "register_agent",
        arguments: { name: "McpTestAgent", session_id: "test-session" },
      }, 48);
      expect(registerResponse).not.toBeNull();
      const agent = JSON.parse(registerResponse.result.content[0].text);
      expect(agent.name).toBe("McpTestAgent");
      expect(agent.registered).toBe(true);
      expect(typeof agent.id).toBe("string");

      const heartbeatResponse = await client.request("tools/call", {
        name: "heartbeat",
        arguments: { agent_id: agent.id },
      }, 49);
      const heartbeat = JSON.parse(heartbeatResponse.result.content[0].text);
      expect(heartbeat).toMatchObject({ agent_id: agent.id, name: "McpTestAgent", active: true });

      const focusResponse = await client.request("tools/call", {
        name: "set_focus",
        arguments: { agent_id: agent.id, project_id: "platform-skills" },
      }, 50);
      const focus = JSON.parse(focusResponse.result.content[0].text);
      expect(focus).toEqual({ agent_id: agent.id, project_id: "platform-skills" });

      const listResponse = await client.request("tools/call", {
        name: "list_agents",
        arguments: {},
      }, 51);
      const list = JSON.parse(listResponse.result.content[0].text);
      expect(list.total).toBe(1);
      expect(list.agents[0].name).toBe("McpTestAgent");
    } finally {
      await client.close();
    }
  }, 15000);

});

