import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { useDefaultTestTimeout, withoutDataDirOverrideEnv } from "../../test-preload.js";

useDefaultTestTimeout();

interface McpResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runHandleMcp(
  home: string,
  options: { register: string; json: boolean },
  env: Record<string, string> = {},
): Promise<McpResult> {
  const source = [
    'import { handleMcp } from "./src/cli/commands/runtime-mcp.ts";',
    `await handleMcp(${JSON.stringify(options)});`,
  ].join("\n");
  const proc = Bun.spawn([process.execPath, "-e", source], {
    cwd: join(import.meta.dir, "../../.."),
    env: {
      ...withoutDataDirOverrideEnv({ ...process.env }),
      HOME: home,
      NO_COLOR: "1",
      ...env,
    } as Record<string, string>,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function withHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), "runtime-mcp-test-"));
  try {
    return await fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("handleMcp", () => {
  test("registers every supported agent, merges existing config, and resolves skills-mcp from PATH", () => withHome(async (home) => {
    const binDir = join(home, "bin");
    mkdirSync(binDir);
    writeFileSync(join(binDir, "skills-mcp"), "#!/bin/sh\nexit 0\n");
    writeFileSync(join(binDir, "claude"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(binDir, "claude"), 0o755);

    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "config.toml"), [
      "model = \"gpt-5\"",
      "",
      "[mcp_servers.skills]",
      "command = \"old-command\"",
      "args = [\"old\"]",
      "",
      "[mcp_servers.other]",
      "command = \"other-mcp\"",
      "",
    ].join("\n"));
    mkdirSync(join(home, ".gemini"), { recursive: true });
    writeFileSync(join(home, ".gemini", "settings.json"), JSON.stringify({
      theme: "dark",
      mcpServers: { other: { command: "other-mcp" } },
    }));

    const result = await runHandleMcp(home, { register: "all", json: true }, {
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    });

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.registered).toBe(7);
    expect(output.results.map((item: { agent: string }) => item.agent)).toEqual([
      "claude", "codex", "gemini", "pi", "opencode", "cursor", "windsurf",
    ]);
    expect(output.results.every((item: { success: boolean }) => item.success)).toBe(true);
    expect(output.results[0].command).toContain(join(binDir, "skills-mcp"));

    const codex = readFileSync(join(home, ".codex", "config.toml"), "utf-8");
    expect(codex).toContain("model = \"gpt-5\"");
    expect(codex).toContain("[mcp_servers.other]");
    expect(codex).toContain(`command = ${JSON.stringify(join(binDir, "skills-mcp"))}`);
    expect(codex).not.toContain("old-command");
    expect(codex).not.toContain("args = [\"old\"]");

    const gemini = JSON.parse(readFileSync(join(home, ".gemini", "settings.json"), "utf-8"));
    expect(gemini.theme).toBe("dark");
    expect(gemini.mcpServers.other).toEqual({ command: "other-mcp" });
    expect(gemini.mcpServers.skills).toEqual({ command: join(binDir, "skills-mcp"), args: [] });

    const opencode = JSON.parse(readFileSync(join(home, ".config", "opencode", "opencode.json"), "utf-8"));
    expect(opencode.$schema).toBe("https://opencode.ai/config.json");
    expect(opencode.mcp.skills).toEqual({
      type: "local",
      command: [join(binDir, "skills-mcp")],
      enabled: true,
    });
    for (const path of [
      join(home, ".pi", "agent", "mcp.json"),
      join(home, ".cursor", "mcp.json"),
      join(home, ".windsurf", "mcp.json"),
    ]) {
      expect(JSON.parse(readFileSync(path, "utf-8")))
        .toHaveProperty("mcpServers.skills.command", join(binDir, "skills-mcp"));
    }
  }));

  test("reports an unknown agent without writing config", () => withHome(async (home) => {
    const result = await runHandleMcp(home, { register: "not-an-agent", json: true });

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      registered: 0,
      results: [{
        agent: "not-an-agent",
        success: false,
        error: "Unknown agent: not-an-agent. Available: claude, codex, gemini, pi, opencode, cursor, windsurf, all",
      }],
    });
    expect(() => readFileSync(join(home, ".codex", "config.toml"))).toThrow();
  }));

  test("returns a failed result when an existing agent config is not a JSON object", () => withHome(async (home) => {
    const configPath = join(home, ".cursor", "mcp.json");
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(configPath, "[]\n");

    const result = await runHandleMcp(home, { register: "cursor", json: true });

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output.registered).toBe(0);
    expect(output.results).toHaveLength(1);
    expect(output.results[0]).toMatchObject({ agent: "cursor", success: false, path: configPath });
    expect(output.results[0].error).toContain("must contain a JSON object");
    expect(readFileSync(configPath, "utf-8")).toBe("[]\n");
  }));
});
