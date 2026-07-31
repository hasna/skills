import { describe, test, expect } from "bun:test";
import { join } from "path";
import { useDefaultTestTimeout } from "../test-preload.js";
import {
  EXPECTED_ALL_SKILL_COUNT,
  EXPECTED_BASIC_SKILL_COUNT,
  McpClient,
} from "./mcp-test-client.js";

useDefaultTestTimeout();

describe("MCP Server discovery", () => {
  test("lists tools", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/list");
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      const tools = response.result.tools;
      expect(Array.isArray(tools)).toBe(true);

      const toolNames = tools.map((t: any) => t.name);
      expect(toolNames).toContain("list_skills");
      expect(toolNames).toContain("search_skills");
      expect(toolNames).toContain("get_skill_info");
      expect(toolNames).toContain("get_skill_docs");
      expect(toolNames).toContain("list_tool_primitives");
      expect(toolNames).toContain("get_skill_tool_dependencies");
      expect(toolNames).toContain("validate_tool_primitives");
      expect(toolNames).toContain("pin_skill");
      expect(toolNames).toContain("unpin_skill");
      expect(toolNames).toContain("list_categories");
      expect(toolNames).toContain("get_requirements");
      expect(toolNames).not.toContain("quote_skill");
      expect(toolNames).toContain("run_skill");
      expect(toolNames).toContain("get_run_status");
      expect(toolNames).toContain("get_mcp_contracts");
      expect(toolNames).toContain("scaffold_skill");
      expect(toolNames).toContain("port_skill");
      expect(toolNames).toContain("storage_status");
      expect(toolNames).toContain("storage_sync_plan");
    } finally {
      await client.close();
    }
  }, 15000);

  test("reports primitive tool dependencies for a skill", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "get_skill_tool_dependencies",
        arguments: { name: "brand-kit" },
      }, 14);
      expect(response).not.toBeNull();
      const payload = JSON.parse(response.result.content[0].text);
      expect(payload).toMatchObject({
        skill: "brand-kit",
        hostedRuntime: false,
      });
      expect(payload.dependencies.map((dependency: { primitive: string }) => dependency.primitive)).toContain("media-image");
    } finally {
      await client.close();
    }
  }, 15000);

  test("portable skill tools scaffold, validate, inspect, run, and port local skills", async () => {
    const { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("fs");
    const { tmpdir } = require("os");
    const sourceRoot = mkdtempSync(join(tmpdir(), "mcp-portable-source-"));
    const home = mkdtempSync(join(tmpdir(), "mcp-portable-home-"));
    const client = new McpClient({ HOME: home });
    try {
      await client.initialize();
      const scaffoldResponse = await client.request("tools/call", {
        name: "scaffold_skill",
        arguments: {
          name: "mcp-skill",
          description: "MCP-created portable skill.",
        },
      }, 20);
      expect(scaffoldResponse).not.toBeNull();
      const scaffolded = JSON.parse(scaffoldResponse.result.content[0].text);
      expect(scaffolded).toMatchObject({ name: "mcp-skill", created: true });
      expect(existsSync(join(home, ".hasna", "skills", "installed", "mcp-skill", "AGENTS.md"))).toBe(true);

      const infoResponse = await client.request("tools/call", {
        name: "get_skill_info",
        arguments: { name: "mcp-skill" },
      }, 21);
      expect(infoResponse).not.toBeNull();
      expect(JSON.parse(infoResponse.result.content[0].text)).toMatchObject({
        name: "mcp-skill",
        source: "custom",
        cliCommand: "skills run mcp-skill",
      });

      const validationResponse = await client.request("tools/call", {
        name: "validate_skill",
        arguments: { name: "mcp-skill" },
      }, 22);
      expect(validationResponse).not.toBeNull();
      const validation = JSON.parse(validationResponse.result.content[0].text);
      expect(validation.valid).toBe(true);
      expect(validation.metadata.portableManifest.commands[0].entry).toBe("src/index.ts");

      const runResponse = await client.request("tools/call", {
        name: "run_skill",
        arguments: { name: "mcp-skill", args: ["via-mcp"] },
      }, 23);
      expect(runResponse).not.toBeNull();
      const run = JSON.parse(runResponse.result.content[0].text);
      expect(run).toMatchObject({ exitCode: 0, skill: "mcp-skill" });
      expect(run.stdout).toBeUndefined();
      expect(run.stdoutPreview.text).toContain("via-mcp");
      expect(run.detailHint).toContain("detail:true");

      const detailedRunResponse = await client.request("tools/call", {
        name: "run_skill",
        arguments: { name: "mcp-skill", args: ["via-mcp"], detail: true },
      }, 25);
      expect(detailedRunResponse).not.toBeNull();
      const detailedRun = JSON.parse(detailedRunResponse.result.content[0].text);
      expect(detailedRun.stdout).toContain("via-mcp");

      const source = join(sourceRoot, "ported-mcp");
      mkdirSync(join(source, "src"), { recursive: true });
      writeFileSync(join(source, "SKILL.md"), `---
name: ported-mcp
description: Ported through MCP.
version: 0.3.0
---

# Ported MCP
`);
      writeFileSync(join(source, "package.json"), JSON.stringify({
        name: "ported-mcp",
        version: "0.3.0",
        bin: { "ported-mcp": "src/index.ts" },
      }, null, 2));
      writeFileSync(join(source, "src", "index.ts"), "#!/usr/bin/env bun\nconsole.log('ported through mcp');\n");

      const portResponse = await client.request("tools/call", {
        name: "port_skill",
        arguments: { path: source },
      }, 24);
      expect(portResponse).not.toBeNull();
      expect(JSON.parse(portResponse.result.content[0].text)).toMatchObject({
        name: "ported-mcp",
        created: true,
      });
      expect(existsSync(join(home, ".hasna", "skills", "installed", "ported-mcp", "skill.json"))).toBe(true);
    } finally {
      await client.close();
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }, 15000);






  test("run_skill keeps free local skills local even when hosted auth is configured", async () => {
    const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("fs");
    const { tmpdir } = require("os");
    const tmpDir = mkdtempSync(join(tmpdir(), "mcp-local-with-auth-"));
    // The declarative-only catalog ships no bundled executable to run, so scaffold
    // a local executable skill in the server's corpus (resolved from $HOME=tmpDir).
    const skillDir = join(tmpDir, ".hasna", "skills", "custom", "lorem-generator");
    mkdirSync(join(skillDir, "src"), { recursive: true });
    writeFileSync(join(skillDir, "package.json"), JSON.stringify({ name: "lorem-generator", version: "0.1.0", bin: { "lorem-generator": "src/index.ts" } }));
    writeFileSync(join(skillDir, "src", "index.ts"), 'console.log("lorem-generator " + process.argv.slice(2).join(" "));');
    let remoteCalls = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        remoteCalls += 1;
        return Response.json({ error: "local skills should not use hosted API" }, { status: 500 });
      },
    });
    const client = new McpClient({
      HOME: tmpDir,
      SKILLS_API_KEY: "sk_test_local_should_stay_local",
      SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
      SKILLS_TEST_MODE: "1",
    });
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "run_skill",
        arguments: {
          name: "lorem-generator",
          args: ["--help"],
        },
      }, 86);
      expect(response).not.toBeNull();
      expect(response.result.isError).toBeUndefined();
      const payload = JSON.parse(response.result.content[0].text);
      expect(payload).toMatchObject({
        exitCode: 0,
        skill: "lorem-generator",
      });
      expect(payload.stdout).toBeUndefined();
      expect(payload.stdoutPreview.text).toContain("lorem-generator");
      expect(payload.remote).toBeUndefined();
      expect(remoteCalls).toBe(0);
    } finally {
      await client.close();
      server.stop(true);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  test("lists resources", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("resources/list");
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      const resources = response.result.resources;
      expect(Array.isArray(resources)).toBe(true);

      const uris = resources.map((r: any) => r.uri);
      expect(uris).toContain("skills://registry");
      expect(uris).toContain("skills://mcp/contracts");
    } finally {
      await client.close();
    }
  }, 15000);

  test("calls list_categories tool", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "list_categories",
        arguments: {},
      });
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      const content = response.result.content;
      expect(Array.isArray(content)).toBe(true);
      const categories = JSON.parse(content[0].text);
      expect(Array.isArray(categories)).toBe(true);
      expect(categories.length).toBe(17);
      expect(categories[0]).toHaveProperty("name");
      expect(categories[0]).toHaveProperty("count");
    } finally {
      await client.close();
    }
  }, 15000);

  test("calls search_skills tool", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "search_skills",
        arguments: { query: "pdf" },
      });
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      const results = JSON.parse(response.result.content[0].text);
      expect(Array.isArray(results.skills)).toBe(true);
      expect(results.skills.length).toBeGreaterThan(0);
      expect(results.total).toBeGreaterThan(0);
      expect(results.limit).toBe(25);
    } finally {
      await client.close();
    }
  }, 15000);

  test("calls get_skill_info tool", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "get_skill_info",
        arguments: { name: "brand-kit" },
      });
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      const info = JSON.parse(response.result.content[0].text);
      expect(info.name).toBe("brand-kit");
      expect(info.displayName).toBeDefined();
      expect(info.category).toBeDefined();
      expect(info).not.toHaveProperty("pricing");
      expect(info.envVars ?? []).not.toContain("SKILL_API_KEY");
      expect(info.envVars ?? []).not.toContain("OPENAI_API_KEY");
      expect(info.mcp.schemas.run.inputSchema.properties.name).toMatchObject({
        const: "brand-kit",
      });
      expect(info.mcp.schemas.install.inputSchema.properties.name).toMatchObject({
        const: "brand-kit",
      });
      expect(JSON.stringify(info).toLowerCase()).not.toContain("openai");
      expect(JSON.stringify(info).toLowerCase()).not.toContain("gemini");
      expect(JSON.stringify(info).toLowerCase()).not.toContain("minimax");
    } finally {
      await client.close();
    }
  }, 15000);

  test("returns error for nonexistent skill", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "get_skill_info",
        arguments: { name: "nonexistent-xyz" },
      });
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      expect(response.result.isError).toBe(true);
    } finally {
      await client.close();
    }
  }, 15000);

  test("calls get_skill_docs tool", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "get_skill_docs",
        arguments: { name: "brand-kit" },
      }, 10);
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      const text = response.result.content[0].text;
      expect(text).toContain("Brand Kit");
    } finally {
      await client.close();
    }
  }, 15000);

  test("get_skill_docs returns error for nonexistent skill", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "get_skill_docs",
        arguments: { name: "nonexistent-xyz" },
      }, 11);
      expect(response).not.toBeNull();
      expect(response.result.isError).toBe(true);
    } finally {
      await client.close();
    }
  }, 15000);

  test("calls get_requirements tool", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "get_requirements",
        arguments: { name: "brand-kit" },
      }, 12);
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      const reqs = JSON.parse(response.result.content[0].text);
      expect(Array.isArray(reqs.envVars)).toBe(true);
            expect(reqs.envVars).not.toContain("SKILL_API_KEY");
      expect(reqs.envVars).not.toContain("OPENAI_API_KEY");
      expect(reqs.cliCommand).toBe("skills run brand-kit");
    } finally {
      await client.close();
    }
  }, 15000);

  test("get_requirements returns error for nonexistent skill", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "get_requirements",
        arguments: { name: "nonexistent-xyz" },
      }, 13);
      expect(response).not.toBeNull();
      expect(response.result.isError).toBe(true);
    } finally {
      await client.close();
    }
  }, 15000);

  test("calls list_skills tool with no filter", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "list_skills",
        arguments: {},
      }, 14);
      expect(response).not.toBeNull();
      const result = JSON.parse(response.result.content[0].text);
      const skills = result.skills;
      expect(Array.isArray(skills)).toBe(true);
      expect(result.total).toBe(EXPECTED_BASIC_SKILL_COUNT);
      expect(skills.length).toBe(EXPECTED_BASIC_SKILL_COUNT);
      expect(result.hasMore).toBe(false);
      expect(skills.map((s: any) => s.name)).not.toContain("brand-kit");
      expect(skills[0]).not.toHaveProperty("pricing");
      // Compact list must surface descriptions so agents can discover
      // without a per-skill get_skill_docs / get_skill_info round-trip.
      for (const s of skills) {
        expect(typeof s.description).toBe("string");
        expect(s.description.length).toBeGreaterThan(0);
      }
    } finally {
      await client.close();
    }
  }, 15000);

  test("calls list_skills tool with full profile", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "list_skills",
        arguments: { profile: "all", limit: 10 },
      }, 19);
      expect(response).not.toBeNull();
      const result = JSON.parse(response.result.content[0].text);
      expect(Array.isArray(result.skills)).toBe(true);
      expect(result.skills.length).toBe(10);
      expect(result.total).toBe(EXPECTED_ALL_SKILL_COUNT);
      expect(result.hasMore).toBe(true);
      expect(result.nextArguments).toMatchObject({ profile: "all", limit: 10, offset: 10 });
    } finally {
      await client.close();
    }
  }, 15000);

  test("calls list_skills tool with category filter", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "list_skills",
        // limit past the 25-item default page so all Development Tools skills return.
        arguments: { category: "Development Tools", profile: "all", limit: 100 },
      }, 15);
      expect(response).not.toBeNull();
      const result = JSON.parse(response.result.content[0].text);
      const skills = result.skills;
      expect(Array.isArray(skills)).toBe(true);
      // 5 instruction + 23 restored credential-free executable skills.
      expect(skills.length).toBe(28);
      expect(result.total).toBe(28);
      for (const s of skills) {
        expect(s.category).toBe("Development Tools");
      }
    } finally {
      await client.close();
    }
  }, 15000);

});
