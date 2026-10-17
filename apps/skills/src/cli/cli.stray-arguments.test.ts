import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, runCliInCwd } from "./cli.test-utils.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * A verb that declares no positional argument must refuse a stray word.
 *
 * Commander's `allowExcessArguments` defaults to true, so these verbs used to
 * exit 0 with their ordinary output for input they never understood:
 * `skills categories typo` listed the categories, `skills list typo` printed
 * the whole catalogue, and `skills doctor typo` ran a readiness check for a
 * word it ignored. A caller reading the exit code was told the word was
 * understood. The default command and `skills mcp` already refused by hand
 * (BUG e3997558); the rest are closed by the shared pass, which is what these
 * cases pin.
 *
 * The pass deliberately covers only verbs that declare no argument of their
 * own. A verb that declares one keeps commander's arity, and a variadic verb
 * such as `feedback <message...>` still accepts free text — a single word is a
 * legitimate message there, not a phantom verb.
 */
const ARITY_VERBS = ["categories", "config", "doctor", "init", "list", "setup-info", "tags", "whoami", "capabilities"] as const;

describe("stray positionals on verbs that declare no argument", () => {
  test.each([...ARITY_VERBS])("`skills %s <stray>` refuses non-zero instead of running", async (verb) => {
    const { stdout, stderr, exitCode } = await runCli([verb, "__stray_probe__"]);
    expect(exitCode).not.toBe(0);
    // Nothing may reach stdout: a caller parsing the ordinary payload of this
    // verb must not be handed one for input the verb refused.
    expect(stdout).toBe("");
    expect(stderr).toContain("too many arguments");
    expect(stderr).toContain("Expected 0 arguments but got 1");
  });

  test("the refusal names the verb that was addressed", async () => {
    for (const verb of ["categories", "list", "tags", "doctor", "whoami"]) {
      const { stderr } = await runCli([verb, "__stray_probe__"]);
      expect(stderr).toContain(`for '${verb}'`);
    }
  });

  test("a verb that declares its own positional still accepts it", async () => {
    const { exitCode, stderr } = await runCli(["search", "qwen"]);
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("too many arguments");
  });

  test("a variadic verb still accepts free text", async () => {
    const { exitCode, stderr } = await runCli(["feedback", "synthetic", "message"]);
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("too many arguments");
  });

  for (const native of ["missing", "stub"] as const) {
    test(`subcommand dispatch still wins over the arity check (Claude ${native})`, async () => {
      // `setup` owns an action AND a child. Exercise the real parser, while
      // making the runner's installed agents and credentials unreachable.
      const root = mkdtempSync(join(tmpdir(), "skills-setup-dispatch-"));
      const home = join(root, "home"), bin = join(root, "bin"), temporary = join(root, "tmp");
      for (const path of [home, bin, temporary]) mkdirSync(path, { mode: 0o700 });
      const marker = join(root, "native-called.json"), config = join(home, ".claude.json");
      const original = JSON.stringify({ retained: "synthetic", mcpServers: { other: { command: "fixture-other" } } });
      writeFileSync(config, original, { mode: 0o600 });
      const guard = join(root, "guard.ts");
      writeFileSync(guard, `
const spawn = Bun.spawn;
const fetchEmbedded = globalThis.fetch;
globalThis.fetch = (async (input, init) => {
  try {
    const request = new Request(input, init);
    const url = new URL(request.url);
    // Match consumer-credentials.ts: Ink/Yoga loads only bounded embedded WASM.
    if (request.method !== "GET" || url.protocol !== "data:"
        || !url.href.startsWith("data:application/octet-stream;base64,") || url.href.length > 1024 * 1024
        || request.headers.has("authorization") || request.headers.has("x-api-key"))
      throw Error("SETUP_DISPATCH_NETWORK_REFUSED");
    return await fetchEmbedded(request);
  } catch {
    throw Error("SETUP_DISPATCH_NETWORK_REFUSED");
  }
}) as typeof fetch;
Bun.spawn = ((command, options) => {
  if (!Array.isArray(command) || command[0] !== "claude" || process.env.PATH !== ${JSON.stringify(bin)})
    throw Error("SETUP_DISPATCH_SUBPROCESS_REFUSED");
  return spawn(command, options);
}) as typeof Bun.spawn;
`, { mode: 0o600 });
      if (native === "stub") {
        const stub = join(root, "claude-stub.ts");
        writeFileSync(stub, `
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
assert.deepEqual(args.slice(0, 4), ["mcp", "add", "-s", "user"]);
const env: Record<string, string> = {};
let index = 4;
while (args[index] === "--env") { const item = args[index + 1]!; const split = item.indexOf("="); assert(split > 0); env[item.slice(0, split)] = item.slice(split + 1); index += 2; }
assert.deepEqual(args.slice(index), ["--transport", "stdio", "skills", "--", "skills-mcp", "--stdio"]);
const data = JSON.parse(readFileSync(${JSON.stringify(config)}, "utf8"));
data.mcpServers.skills = { type: "stdio", command: "skills-mcp", args: ["--stdio"], env };
writeFileSync(${JSON.stringify(config)}, JSON.stringify(data), { mode: 0o600 });
writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ admitted: true }), { mode: 0o600 });
`, { mode: 0o600 });
        const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
        writeFileSync(join(bin, "claude"), `#!/bin/sh\nexec ${quote(process.execPath)} --no-env-file --no-install ${quote(stub)} "$@"\n`, { mode: 0o700 });
      }
      const env = { HOME: home, USERPROFILE: home, PATH: bin, TMPDIR: temporary,
        HASNA_HOME: join(home, ".hasna"), HASNA_CONFIG_HOME: join(home, "config"), CLAUDE_CONFIG_DIR: home,
        HASNA_SKILLS_API_URL: "http://127.0.0.1:9", SKILLS_API_URL: "http://127.0.0.1:9",
        HASNA_STATION: "setup-dispatch-fixture-no-keychain", HASNA_SKILLS_LOCAL: "1", SKILLS_TEST_MODE: "1",
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", NO_COLOR: "1" };
      try {
        const refused = await runCliInCwd(["setup", "agents", "__stray_probe__", "--json"], root, env, { isolated: true, preload: guard });
        expect(refused.exitCode).not.toBe(0);
        expect(refused.stderr).toContain("too many arguments");
        expect(refused.stdout).toBe("");
        expect(existsSync(marker)).toBe(false);
        expect(readFileSync(config, "utf8")).toBe(original);

        const { exitCode, stdout, stderr } = await runCliInCwd(["setup", "agents", "--json"], root, env, { isolated: true, preload: guard });
        expect(exitCode).toBe(0);
        expect(stderr).not.toContain("too many arguments");
        const result = JSON.parse(stdout);
        expect(result.registered).toBe(7);
        expect(result.results.every((entry: { success: boolean }) => entry.success)).toBe(true);
        expect(existsSync(marker)).toBe(native === "stub");
        const data = JSON.parse(readFileSync(config, "utf8"));
        expect(data.retained).toBe("synthetic");
        expect(data.mcpServers.other).toEqual({ command: "fixture-other" });
        expect(data.mcpServers.skills).toMatchObject({ command: "skills-mcp", args: ["--stdio"] });
        expect(data.mcpServers.skills.env.HASNA_SKILLS_API_URL).toBe("http://127.0.0.1:9");
      } finally {
        // Only files generated in this test's dedicated sandbox are removed.
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

describe("the commands that own their refusal keep it", () => {
  test("an unknown top-level verb still names every valid command", async () => {
    const { stdout, stderr, exitCode } = await runCli(["bogus-verb"]);
    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("unknown command 'bogus-verb'");
    expect(stderr).toContain("Valid commands:");
    // Derived from the program, so a registered verb must appear in it.
    expect(stderr).toContain("categories");
  });

  test("`skills mcp <stray>` still names its three forms", async () => {
    const { stdout, stderr, exitCode } = await runCli(["mcp", "connect"]);
    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("takes no positional arguments");
    expect(stderr).toContain("--register");
  });
});
