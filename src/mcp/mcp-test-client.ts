import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { BASIC_SKILL_NAMES, SKILLS } from "../lib/registry.js";
import { withoutDataDirOverrideEnv } from "../test-preload.js";


const MCP_PATH = join(import.meta.dir, "index.ts");
export const EXPECTED_ALL_SKILL_COUNT = SKILLS.length;
export const EXPECTED_BASIC_SKILL_COUNT = BASIC_SKILL_NAMES.length;
const CLEAN_STORAGE_ENV = {
  HASNA_SKILLS_DATABASE_URL: "",
  HASNA_SKILLS_DATABASE_SSL: "",
  HASNA_SKILLS_DATABASE_SCHEMA: "",
  HASNA_SKILLS_S3_BUCKET: "",
  HASNA_SKILLS_S3_PREFIX: "",
  HASNA_SKILLS_AWS_REGION: "",
  HASNA_SKILLS_SYNC_DRY_RUN: "",
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
export class McpClient {
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
      // Drop the preload's $HASNA_SKILLS_DIR: the server under test must resolve
      // its data dir from the throwaway $HOME above, not from the parent's
      // ambient override inherited via ...process.env.
      env: withoutDataDirOverrideEnv({
        ...process.env,
        HOME: home,
        ...CLEAN_STORAGE_ENV,
        ...env,
        MCP_STDIO: "1",
        NO_COLOR: "1",
      }) as Record<string, string>,
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

