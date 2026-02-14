import { describe, test, expect } from "bun:test";
import { join } from "path";

const MCP_PATH = join(import.meta.dir, "index.ts");

/**
 * Helper class to communicate with the MCP server over stdio.
 */
class McpClient {
  private proc: ReturnType<typeof Bun.spawn>;
  private buffer = "";
  private messages: any[] = [];
  private reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor() {
    this.proc = Bun.spawn(["bun", "run", MCP_PATH], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });
    this.reader = this.proc.stdout.getReader();
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
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
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
      this.proc.stdin.end();
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
      expect(toolNames).toContain("install_skill");
      expect(toolNames).toContain("remove_skill");
      expect(toolNames).toContain("list_categories");
      expect(toolNames).toContain("get_requirements");
    } finally {
      await client.close();
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
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
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
});
