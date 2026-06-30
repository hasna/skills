import { describe, test, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { BASIC_SKILL_NAMES, SKILLS } from "../lib/registry.js";

const MCP_PATH = join(import.meta.dir, "index.ts");
const EXPECTED_ALL_SKILL_COUNT = SKILLS.length;
const EXPECTED_BASIC_SKILL_COUNT = BASIC_SKILL_NAMES.length;
const CLEAN_STORAGE_ENV = {
  HASNA_SKILLS_STORAGE_MODE: "",
  HASNA_SKILLS_DATABASE_URL: "",
  HASNA_SKILLS_DATABASE_SSL: "",
  HASNA_SKILLS_DATABASE_SCHEMA: "",
  HASNA_SKILLS_S3_BUCKET: "",
  HASNA_SKILLS_S3_PREFIX: "",
  HASNA_SKILLS_AWS_REGION: "",
  HASNA_SKILLS_SYNC_DRY_RUN: "",
  SKILLS_STORAGE_MODE: "",
  SKILLS_DATABASE_URL: "",
  SKILLS_DATABASE_SSL: "",
  SKILLS_DATABASE_SCHEMA: "",
  SKILLS_S3_BUCKET: "",
  SKILLS_S3_PREFIX: "",
  SKILLS_AWS_REGION: "",
  SKILLS_S3_ENDPOINT: "",
  SKILLS_S3_FORCE_PATH_STYLE: "",
  SKILLS_S3_ACCESS_KEY_ID: "",
  SKILLS_S3_SECRET_ACCESS_KEY: "",
  SKILLS_S3_SESSION_TOKEN: "",
  SKILLS_SYNC_BATCH_SIZE: "",
  SKILLS_SYNC_DRY_RUN: "",
};

/**
 * Helper class to communicate with the MCP server over stdio.
 */
class McpClient {
  private proc: ReturnType<typeof Bun.spawn>;
  private buffer = "";
  private messages: any[] = [];
  private reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(env: Record<string, string> = {}) {
    const home = env.HOME ?? mkdtempSync(join(tmpdir(), "skills-mcp-home-"));
    this.proc = Bun.spawn(["bun", "run", MCP_PATH], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: home, ...CLEAN_STORAGE_ENV, ...env, MCP_STDIO: "1", NO_COLOR: "1" },
    });
    this.reader = (this.proc.stdout as ReadableStream<Uint8Array>).getReader();
    this._readLoop();
  }

  private async _readLoop() {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await this.reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        // Parse complete lines
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop()!; // Keep incomplete line
        for (const line of lines) {
          if (line.trim()) {
            try {
              this.messages.push(JSON.parse(line));
            } catch {}
          }
        }
      }
    } catch {}
  }

  send(msg: any) {
    (this.proc.stdin as import("bun").FileSink).write(JSON.stringify(msg) + "\n");
  }

  async waitForMessage(id: number, timeout = 8000): Promise<any> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const found = this.messages.find(m => m.id === id);
      if (found) return found;
      await new Promise(r => setTimeout(r, 50));
    }
    return null;
  }

  async initialize(): Promise<void> {
    this.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
    });
    await this.waitForMessage(1);
    this.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    // Give server time to process notification
    await new Promise(r => setTimeout(r, 100));
  }

  async request(method: string, params: Record<string, unknown> = {}, id = 2): Promise<any> {
    this.send({ jsonrpc: "2.0", id, method, params });
    return this.waitForMessage(id);
  }

  async close() {
    try {
      this.reader.cancel();
      (this.proc.stdin as import("bun").FileSink).end();
      this.proc.kill();
      await this.proc.exited;
    } catch {}
  }
}

describe("MCP Server", () => {
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
      expect(toolNames).toContain("quote_skill");
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
        arguments: { name: "image" },
      }, 14);
      expect(response).not.toBeNull();
      const payload = JSON.parse(response.result.content[0].text);
      expect(payload).toMatchObject({
        skill: "image",
        gatewayBacked: true,
        hostedRuntime: true,
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
      expect(existsSync(join(home, ".hasna", "skills", "mcp-skill", "AGENTS.md"))).toBe(true);

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
      expect(existsSync(join(home, ".hasna", "skills", "ported-mcp", "skill.json"))).toBe(true);
    } finally {
      await client.close();
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }, 15000);

  test("quote_skill validates create-blog-article options", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const validResponse = await client.request("tools/call", {
        name: "quote_skill",
        arguments: {
          name: "create-blog-article",
          input: {
            topic: "SaaS onboarding",
            count: 8,
            audience: "founders",
            tone: "technical",
            length: "long",
            seo: true,
            outline: "Problem, workflow, rollout",
          },
        },
      }, 80);
      expect(validResponse).not.toBeNull();
      const valid = JSON.parse(validResponse.result.content[0].text);
      expect(valid).toMatchObject({
        skill: "blog-article",
        pricing: {
          billingUnit: "article",
          unitCount: 8,
          costCents: 200,
          formattedCost: "$2.00 total",
        },
      });

      const invalidResponse = await client.request("tools/call", {
        name: "quote_skill",
        arguments: {
          name: "create-blog-article",
          input: { topic: "SaaS onboarding", count: 13 },
        },
      }, 81);
      expect(invalidResponse).not.toBeNull();
      expect(invalidResponse.result.isError).toBe(true);
      const invalid = JSON.parse(invalidResponse.result.content[0].text);
      expect(invalid).toMatchObject({
        code: "INVALID_BLOG_ARTICLE_OPTIONS",
        message: "Count must be an integer between 1 and 12.",
      });
    } finally {
      await client.close();
    }
  }, 15000);

  test("run_skill rejects unauthenticated premium skills without local fallback", async () => {
    const { mkdtempSync, rmSync } = require("fs");
    const { tmpdir } = require("os");
    const tmpDir = mkdtempSync(join(tmpdir(), "mcp-premium-no-auth-"));
    const client = new McpClient({
      HOME: tmpDir,
      SKILLS_API_KEY: "",
      SKILLS_TEST_MODE: "1",
    });
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "run_skill",
        arguments: {
          name: "image",
          args: ["--help"],
        },
      }, 82);
      expect(response).not.toBeNull();
      expect(response.result.isError).toBe(true);
      const error = JSON.parse(response.result.content[0].text);
      expect(error).toMatchObject({ code: "AUTH_REQUIRED" });
      expect(error.message).toContain("skills auth login");
      expect(error.message).not.toContain("Skill Image CLI");
    } finally {
      await client.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  test("run_skill fails closed for premium skills when hosted access fails", async () => {
    const { mkdtempSync, rmSync } = require("fs");
    const { tmpdir } = require("os");
    const tmpDir = mkdtempSync(join(tmpdir(), "mcp-premium-skillsmd-down-"));
    const client = new McpClient({
      HOME: tmpDir,
      SKILLS_API_KEY: "sk_test_skillsmd_down",
      SKILLS_API_URL: "http://127.0.0.1:1",
      SKILLS_TEST_MODE: "1",
    });
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "run_skill",
        arguments: {
          name: "image",
          args: ["--help"],
          approved: true,
        },
      }, 83);
      expect(response).not.toBeNull();
      expect(response.result.isError).toBe(true);
      const error = JSON.parse(response.result.content[0].text);
      expect(error).toMatchObject({ code: "PLATFORM_ERROR" });
      expect(error.message).toContain("requires hosted access");
      expect(error.message).not.toContain("Skill Image CLI");
    } finally {
      await client.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  test("run_skill requires explicit approval before paid hosted submission", async () => {
    const { mkdtempSync, rmSync } = require("fs");
    const { tmpdir } = require("os");
    const tmpDir = mkdtempSync(join(tmpdir(), "mcp-premium-approval-required-"));
    let remoteCalls = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        remoteCalls += 1;
        return Response.json({ error: "run should be blocked before remote submission" }, { status: 500 });
      },
    });
    const client = new McpClient({
      HOME: tmpDir,
      SKILLS_API_KEY: "sk_test_mcp_approval_required",
      SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
      SKILLS_TEST_MODE: "1",
    });
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "run_skill",
        arguments: {
          name: "logo-design",
          args: ["make a mark"],
        },
      }, 84);
      expect(response).not.toBeNull();
      expect(response.result.isError).toBe(true);
      const error = JSON.parse(response.result.content[0].text);
      expect(error).toMatchObject({ code: "APPROVAL_REQUIRED" });
      expect(error.message).toContain("paid hosted skill");
      expect(error.message).toContain("approved: true");
      expect(remoteCalls).toBe(0);
    } finally {
      await client.close();
      server.stop(true);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  test("run_skill returns normalized remote run contract for premium submissions", async () => {
    const { mkdtempSync, rmSync } = require("fs");
    const { tmpdir } = require("os");
    const tmpDir = mkdtempSync(join(tmpdir(), "mcp-premium-contract-"));
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        expect(req.headers.get("authorization")).toBe("Bearer sk_test_contract");
        if (url.pathname === "/api/v1/runs/logo-design" && req.method === "POST") {
          return Response.json({
            id: "run_mcp_contract",
            skill: "logo-design",
            status: "queued",
            correlationId: "corr_mcp_contract",
          }, { status: 202 });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const client = new McpClient({
      HOME: tmpDir,
      SKILLS_API_KEY: "sk_test_contract",
      SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
      SKILLS_TEST_MODE: "1",
    });
    try {
      await client.initialize();
      const response = await client.request("tools/call", {
        name: "run_skill",
        arguments: {
          name: "logo-design",
          args: ["make a mark"],
          approved: true,
        },
      }, 85);
      expect(response).not.toBeNull();
      const payload = JSON.parse(response.result.content[0].text);
      expect(payload).toMatchObject({
        contractVersion: 1,
        id: "run_mcp_contract",
        skill: "logo-design",
        status: "queued",
        correlationId: "corr_mcp_contract",
        remote: true,
        remoteRun: {
          contractVersion: 1,
          id: "run_mcp_contract",
          skill: "logo-design",
          status: "queued",
        },
        nextActions: {
          poll: "skills runs status run_mcp_contract",
          download: "skills exports download run_mcp_contract",
        },
      });
      expect(payload.run.remoteRunId).toBe("run_mcp_contract");
      expect(payload.detailHint).toContain("detail:true");
    } finally {
      await client.close();
      server.stop(true);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  test("run_skill keeps free local skills local even when hosted auth is configured", async () => {
    const { mkdtempSync, rmSync } = require("fs");
    const { tmpdir } = require("os");
    const tmpDir = mkdtempSync(join(tmpdir(), "mcp-local-with-auth-"));
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
        arguments: { query: "image" },
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
        arguments: { name: "image" },
      });
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      const info = JSON.parse(response.result.content[0].text);
      expect(info.name).toBe("image");
      expect(info.displayName).toBeDefined();
      expect(info.category).toBeDefined();
      expect(info.pricing).toMatchObject({
        tier: "premium",
        quoteDependsOnInput: true,
      });
      expect(info.envVars).toContain("SKILLS_API_KEY");
      expect(info.envVars).not.toContain("SKILL_API_KEY");
      expect(info.envVars).not.toContain("OPENAI_API_KEY");
      expect(info.mcp.schemas.run.inputSchema.properties.name).toMatchObject({
        const: "image",
      });
      expect(info.mcp.schemas.install.inputSchema.properties.name).toMatchObject({
        const: "image",
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
        arguments: { name: "image" },
      }, 10);
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      const text = response.result.content[0].text;
      expect(text).toContain("Image Generation");
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
        arguments: { name: "image" },
      }, 12);
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      const reqs = JSON.parse(response.result.content[0].text);
      expect(Array.isArray(reqs.envVars)).toBe(true);
      expect(reqs.envVars).toContain("SKILLS_API_KEY");
      expect(reqs.envVars).not.toContain("SKILL_API_KEY");
      expect(reqs.envVars).not.toContain("OPENAI_API_KEY");
      expect(reqs.cliCommand).toBe("skills run image");
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
      expect(skills.map((s: any) => s.name)).not.toContain("deepresearch");
      expect(skills[0].pricing).toHaveProperty("formattedCost");
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
        arguments: { profile: "all" },
      }, 19);
      expect(response).not.toBeNull();
      const result = JSON.parse(response.result.content[0].text);
      expect(Array.isArray(result.skills)).toBe(true);
      expect(result.skills.length).toBe(25);
      expect(result.total).toBe(EXPECTED_ALL_SKILL_COUNT);
      expect(result.hasMore).toBe(true);
      expect(result.nextArguments).toMatchObject({ profile: "all", limit: 25, offset: 25 });
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
        arguments: { category: "Event Management", profile: "all" },
      }, 15);
      expect(response).not.toBeNull();
      const result = JSON.parse(response.result.content[0].text);
      const skills = result.skills;
      expect(Array.isArray(skills)).toBe(true);
      expect(skills.length).toBe(4);
      expect(result.total).toBe(4);
      for (const s of skills) {
        expect(s.category).toBe("Event Management");
      }
    } finally {
      await client.close();
    }
  }, 15000);

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
        arguments: { category: "Event Management" },
      }, 31);
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      const result = JSON.parse(response.result.content[0].text);
      expect(result.category).toBe("Event Management");
      expect(result.count).toBe(4);
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.results.length).toBe(4);
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
      expect(skills.map((s: any) => s.name)).not.toContain("deepresearch");
      expect(skills[0].pricing).toHaveProperty("formattedCost");
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

  test("reads public skill resource with pricing and sanitized premium metadata", async () => {
    const client = new McpClient();
    try {
      await client.initialize();
      const response = await client.request("resources/read", {
        uri: "skills://image",
      }, 33);
      expect(response).not.toBeNull();
      expect(response.result).toBeDefined();
      const info = JSON.parse(response.result.contents[0].text);
      expect(info.name).toBe("image");
      expect(info.pricing).toMatchObject({
        tier: "premium",
        quoteDependsOnInput: true,
      });
      expect(info.documentation).toContain("SKILLS_API_KEY");
      expect(info.requirements.envVars).toContain("SKILLS_API_KEY");
      expect(info.requirements.envVars).not.toContain("SKILL_API_KEY");
      expect(info.requirements.envVars).not.toContain("OPENAI_API_KEY");
      expect(info.mcp).toMatchObject({
        schemaVersion: 1,
        name: "image",
        schemas: {
          install: {
            inputSchema: {
              properties: {
                name: { const: "image" },
              },
            },
          },
          run: {
            inputSchema: {
              properties: {
                name: { const: "image" },
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
        arguments: { skills: ["image"], for: "invalid-agent" },
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
        arguments: { name: "image" },
      }, 44);
      expect(validResponse).not.toBeNull();
      const validResult = JSON.parse(validResponse.result.content[0].text);
      expect(validResult.valid).toBe(true);
      expect(validResult.metadata.runtime).toBe("hosted");
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

  test("storage tools return local-first status and no-network sync plan", async () => {
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
        mode: "local",
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

      const planResponse = await client.request("tools/call", {
        name: "storage_sync_plan",
        arguments: { includeSchemaSql: true },
      }, 86);
      expect(planResponse).not.toBeNull();
      const plan = JSON.parse(planResponse.result.content[0].text);
      expect(plan).toMatchObject({
        package: "open-skills",
        noNetwork: true,
        mode: "local",
      });
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
      expect(searchResult.tools).toContain("quote_skill");
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
