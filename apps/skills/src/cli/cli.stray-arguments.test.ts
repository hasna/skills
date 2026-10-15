import { describe, expect, test } from "bun:test";
import { runCli } from "./cli.test-utils.js";
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

  test("subcommand dispatch still wins over the arity check", async () => {
    // `setup` has an action handler AND a child; the child must still dispatch.
    const { exitCode, stderr } = await runCli(["setup", "agents", "--json"]);
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("too many arguments");
  });
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
