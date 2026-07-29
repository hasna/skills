import { describe, expect, test } from "bun:test";
import { runCli } from "./cli.test-utils";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

// A clean $HOME (no auth.json) plus empty credential env is an unconfigured install: the
// point of these tests is that `skills pull` fails closed instead of inventing a host.
const UNCONFIGURED = { SKILLS_API_URL: "", SKILLS_API_KEY: "", SKILL_API_KEY: "" };

describe("skills pull (CLI)", () => {
  test("--help documents the command and its flags", async () => {
    const { stdout, exitCode } = await runCli(["pull", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("into this machine's corpus");
    expect(stdout).toContain("--all");
    expect(stdout).toContain("--for-machine");
  });

  test("fails closed with a clear message when nothing is configured", async () => {
    const { stderr, exitCode } = await runCli(["pull", "some-skill"], UNCONFIGURED);
    expect(exitCode).toBe(1);
    // No credential -> named, actionable error; never a silent success or a guessed host.
    expect(stderr).toContain("No API key configured");
    expect(stderr).toContain("SKILLS_API_URL");
  });

  test("fails closed with a MissingApiUrl message when a key exists but no origin does", async () => {
    const { stderr, exitCode } = await runCli(["pull", "some-skill"], {
      SKILLS_API_URL: "",
      SKILLS_API_KEY: "sk_test_key",
    });
    expect(exitCode).toBe(1);
    // The fail-closed guarantee: with a key but no origin, refuse rather than pick a host.
    expect(stderr).toContain("requires a Skills API URL");
    expect(stderr.toLowerCase()).not.toContain("localhost");
  });

  test("--json emits a structured error when unconfigured", async () => {
    const { stdout, exitCode } = await runCli(["pull", "some-skill", "--json"], UNCONFIGURED);
    expect(exitCode).toBe(1);
    const payload = JSON.parse(stdout);
    expect(payload.error).toContain("No API key configured");
    expect(Array.isArray(payload.detail)).toBe(true);
  });
});
