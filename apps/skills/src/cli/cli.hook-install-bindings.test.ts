import { admitCorpusFixture, corpusInspectorPathFixture } from "../lib/codex-corpus.fixture.js";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliInCwd } from "./cli.test-utils.js";
import { useDefaultTestTimeout } from "../test-preload.js";
import { installSumiPathsFixture } from "../lib/sumi-paths.fixture.js";

useDefaultTestTimeout();
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "skills-hook-bindings-")); homes.push(home);
  return {
    policy: () => JSON.parse(readFileSync(join(home, ".hasna", "skills", "agent-policy.json"), "utf8")),
    async install(args: string[]) {
      const result = await runCliInCwd(["hook", "install", "--agent", "claude", "--json", ...args], home, { HOME: home, HASNA_HOME: join(home, ".hasna") });
      expect(result.exitCode).toBe(0);
      return JSON.parse(result.stdout);
    },
  };
}

test("CLI omitted flags preserve a fleet reinstall while explicit default values override it", async () => {
  const f = fixture();
  await f.install(["--command", "/opt/bin/skills", "--selection-profile", "fleet", "--apply"]);
  expect((await f.install([])).planned).toEqual([]);
  expect((await f.install(["--apply"])).changed).toEqual([]);
  expect(f.policy().bridge.commands.claude).toBe("/opt/bin/skills");
  expect(f.policy().bridge.profiles.claude).toBe("fleet");
  await f.install(["--selection-profile", "default", "--apply"]);
  expect(f.policy().bridge.commands.claude).toBe("/opt/bin/skills");
  expect(f.policy().bridge.profiles.claude).toBe("default");
  await f.install(["--command", "skills", "--apply"]);
  expect(f.policy().bridge.commands.claude).toBe("skills");
});

test("CLI new installation retains the normal command and profile defaults", async () => {
  const f = fixture();
  await f.install(["--apply"]);
  expect(f.policy().bridge.commands.claude).toBe("skills");
  expect(f.policy().bridge.profiles.claude).toBe("default");
  expect(f.policy().profileId).toBe("default");
});

test("bare CLI install reuses reviewed Claude discovery alongside automatic adapters", async () => {
  const home = mkdtempSync(join(tmpdir(), "skills-hook-reviewed-all-")); homes.push(home);
  const { reviewedReinstallFixture } = await import("../lib/agent-reviewed-reinstall.fixture.js");
  const { mkdirSync, symlinkSync, writeFileSync } = await import("node:fs");
  admitCorpusFixture(join(home, ".codex"));
  const inspectorDirectory = corpusInspectorPathFixture();
  const f = reviewedReinstallFixture(home), reviewPath = join(home, "review.json");
  const sumiPathBin = installSumiPathsFixture(home);
  writeFileSync(reviewPath, JSON.stringify(f.review()));
  const bin = join(home, "bin"); mkdirSync(bin); symlinkSync(process.execPath, join(bin, "bun"));
  const run = (args: string[]) => runCliInCwd(["hook", "install", "--json", ...args], home, { HOME: home, HASNA_HOME: join(home, ".hasna"), PATH: (args.includes("--agent") && args[args.indexOf("--agent") + 1] !== "all" ? "" : sumiPathBin + ":") + bin + ":" + inspectorDirectory });
  const first = await run(["--agent", "claude", "--command", "/opt/bin/skills", "--selection-profile", "fleet", "--discovery-inputs", reviewPath, "--apply"]);
  expect(first.exitCode).toBe(0);
  const planned = await run([]); expect(planned.stderr).toBe(""); expect(planned.exitCode).toBe(0);
  expect(JSON.parse(planned.stdout).discovery.find((item: any) => item.agent === "claude").method).toBe("reviewed");
  expect(JSON.parse(planned.stdout).discovery).toHaveLength(6);
  const applied = await run(["--apply"]); expect(applied.exitCode).toBe(0);
  const policy = JSON.parse(readFileSync(join(home, ".hasna/skills/agent-policy.json"), "utf8"));
  expect(policy.bridge.profiles.claude).toBe("fleet"); expect(policy.bridge.commands.claude).toBe("/opt/bin/skills");
  expect(policy.bridge.discovery.codex.method).toBe("automatic");
  const repeated = await run(["--apply"]); expect(repeated.exitCode).toBe(0); expect(JSON.parse(repeated.stdout).changed).toEqual([]);
  writeFileSync(f.source, "// Unreviewed replacement\n");
  const refused = await run([]); expect(refused.exitCode).toBe(1); expect(refused.stderr).toContain("fresh discovery review");
});
