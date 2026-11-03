import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withoutDataDirOverrideEnv } from "../test-preload.js";
import { selectMcpTransport } from "./http.js";

// An agent host registered as plain `skills-mcp` (no --stdio) connects a pipe
// and waits for JSON-RPC on it. 0.10.90 answered that pipe with nothing,
// because it started the HTTP server, so the host's Skills tools never came up.

test("an explicit choice keeps its meaning whatever stdin is", () => {
  for (const pipe of [true, false]) {
    expect(selectMcpTransport(["--stdio"], {}, pipe)).toBe("stdio");
    expect(selectMcpTransport([], { MCP_STDIO: "1" }, pipe)).toBe("stdio");
    expect(selectMcpTransport(["--http"], {}, pipe)).toBe("http");
    expect(selectMcpTransport(["--port", "9000"], {}, pipe)).toBe("http");
    expect(selectMcpTransport([], { MCP_HTTP: "1" }, pipe)).toBe("http");
    // Both named: stdio wins, as it did before this change.
    expect(selectMcpTransport(["--stdio", "--http"], {}, pipe)).toBe("stdio");
  }
});

test("with no choice, an agent host's pipe gets stdio and anything else keeps HTTP", () => {
  expect(selectMcpTransport([], {}, true)).toBe("stdio");
  expect(selectMcpTransport([], {}, false)).toBe("http");
  // A port in the environment only picks the HTTP port; it is not a choice.
  expect(selectMcpTransport([], { MCP_HTTP_PORT: "9000" }, true)).toBe("stdio");
});

test("plain skills-mcp answers initialize over a pipe without --stdio", async () => {
  const home = mkdtempSync(join(tmpdir(), "skills-mcp-transport-"));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(withoutDataDirOverrideEnv({ ...process.env, HOME: home, NO_COLOR: "1" }))) {
    if (value !== undefined && !key.startsWith("MCP_")) env[key] = value;
  }
  env.HASNA_SKILLS_LOCAL = "1";
  // If the HTTP default were taken, keep it off the shared port.
  env.MCP_HTTP_PORT = String(20000 + Math.floor(Math.random() * 20000));
  const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "index.ts")], { cwd: home, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  try {
    (proc.stdin as import("bun").FileSink).write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } }) + "\n");
    (proc.stdin as import("bun").FileSink).flush();
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader(), decoder = new TextDecoder();
    let text = "";
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !text.includes("\n")) {
      const next = await Promise.race([reader.read(), new Promise<null>(resolve => setTimeout(() => resolve(null), deadline - Date.now()))]);
      if (!next || next.done) break;
      text += decoder.decode(next.value, { stream: true });
    }
    const reply = JSON.parse(text.split("\n")[0] || "null");
    expect(reply?.id).toBe(1);
    expect(reply?.result?.serverInfo).toBeDefined();
  } finally {
    proc.kill();
    await proc.exited;
  }
}, 30_000);
