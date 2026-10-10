import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliInCwd } from "./cli.test-utils.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "skills-hook-detection-")); homes.push(home);
  const bin = join(home, "bin"); mkdirSync(bin); symlinkSync(process.execPath, join(bin, "bun"));
  const env = { HOME: home, HASNA_HOME: join(home, ".hasna"), PATH: bin };
  return { home, bin, run: (args: string[] = [], extra: Record<string, string> = {}) => runCliInCwd(["hook", "install", "--json", ...args], home, { ...env, ...extra }) };
}

test("default hook install plans only present Claude and Codex without a Sumi resolver", async () => {
  const f = fixture(); mkdirSync(join(f.home, ".claude")); mkdirSync(join(f.home, ".codex"));
  const result = await f.run(); expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).discovery.map((entry: any) => entry.agent)).toEqual(["claude", "codex"]);
  expect(existsSync(join(f.home, ".hasna", "skills", "agent-policy.json"))).toBe(false);
});

test("explicit all remains strict about the Sumi resolver even when Sumi is absent", async () => {
  const f = fixture(); mkdirSync(join(f.home, ".claude"));
  const result = await f.run(["--agent", "all"]); expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Sumi path discovery refused (SUMI_PATH_RESOLVER_UNAVAILABLE)");
  expect(existsSync(join(f.home, ".hasna", "skills", "agent-policy.json"))).toBe(false);
});

test("present Sumi CLI is detected without executing it and refuses a missing helper", async () => {
  const f = fixture(), marker = join(f.home, "executed");
  writeFileSync(join(f.bin, "sumi"), `#!/bin/sh\nprintf executed > ${JSON.stringify(marker)}\n`, { mode: 0o700 });
  const result = await f.run(); expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("SUMI_PATH_RESOLVER_UNAVAILABLE"); expect(existsSync(marker)).toBe(false);
});

test("configured Sumi cannot disappear from the default when its helper is unavailable", async () => {
  const f = fixture(), dataDir = join(f.home, ".hasna", "skills"); mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, "agent-policy.json"), JSON.stringify({ loading: "cli", bridge: { agents: ["sumi"] } }));
  const result = await f.run(); expect(result.exitCode).toBe(1); expect(result.stderr).toContain("SUMI_PATH_RESOLVER_UNAVAILABLE");
});

test("legacy and XDG Sumi configuration select the strict adapter when its helper is missing", async () => {
  for (const xdg of [false, true]) {
    const f = fixture(), base = join(f.home, xdg ? "xdg" : ".config"), root = join(base, "sumi"); mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "sumi.json"), "{");
    const result = await f.run([], xdg ? { XDG_CONFIG_HOME: base } : {}); expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Sumi path discovery refused (SUMI_PATH_RESOLVER_UNAVAILABLE)");
    expect(existsSync(join(f.home, ".hasna", "skills", "agent-policy.json"))).toBe(false);
  }
});

test("dangling and unreadable Sumi roots keep blocking the default instead of dropping Sumi", async () => {
  for (const xdg of [false, true]) {
    const f = fixture(), base = join(f.home, xdg ? "xdg" : ".config"); mkdirSync(base); symlinkSync(join(f.home, "missing"), join(base, "sumi"));
    const result = await f.run([], xdg ? { XDG_CONFIG_HOME: base } : {}); expect(result.exitCode).toBe(1); expect(result.stderr).toContain("SUMI_PATH_RESOLVER_UNAVAILABLE");
    const g = fixture(), parent = join(g.home, xdg ? "xdg" : ".config"), root = join(parent, "sumi"); mkdirSync(root, { recursive: true }); chmodSync(root, 0);
    try { const inaccessible = await g.run([], xdg ? { XDG_CONFIG_HOME: parent } : {}); expect(inaccessible.exitCode).toBe(1); expect(inaccessible.stderr).toContain("SUMI_PATH_RESOLVER_UNAVAILABLE"); }
    finally { chmodSync(root, 0o700); }
  }
});

test("present Sumi uses its read-only path protocol and leaves native roots absent during planning", async () => {
  const f = fixture(), config = join(f.home, "native-sumi-config"), marker = join(f.home, "general-cli-executed");
  writeFileSync(join(f.bin, "sumi"), `#!/bin/sh\nprintf executed > ${JSON.stringify(marker)}\n`, { mode: 0o700 });
  const helper = `#!${process.execPath}\nimport { join } from "node:path";
const args = process.argv.slice(2), home = args[args.indexOf("--home") + 1], cwd = args[args.indexOf("--cwd") + 1];
const config = join(home, "native-sumi-config");
process.stdout.write(JSON.stringify({ schemaVersion: 1, kind: "sumi-paths", home, cwd,
roots: { data: join(home, "native-data"), cache: join(home, "native-cache"), config, state: join(home, "native-state") },
legacyRoots: { data: null, cache: null, config: null, state: null },
configFiles: { canonical: join(config, "sumi.json"), legacy: null }, skillRoots: { canonical: join(config, "skills"), legacy: null } }));\n`;
  writeFileSync(join(f.bin, "sumi-paths"), helper, { mode: 0o700 });
  const result = await f.run(); expect(result.exitCode).toBe(0);
  const receipt = JSON.parse(result.stdout); expect(receipt.discovery.map((entry: any) => entry.agent)).toEqual(["sumi"]);
  expect(receipt.planned).toContain(join(config, "sumi.json"));
  expect(existsSync(config)).toBe(false); expect(existsSync(marker)).toBe(false);
});

test("empty and unsupported Sumi selectors are configured, not silently absent", async () => {
  const f = fixture(); mkdirSync(join(f.home, ".claude"));
  const empty = await f.run([], { SUMI_HOME: "" }); expect(empty.exitCode).toBe(1); expect(empty.stderr).toContain("SUMI_PATH_RESOLVER_UNAVAILABLE");
  const unsupported = await f.run([], { SUMI_CONFIG_CONTENT: "" }); expect(unsupported.exitCode).toBe(1); expect(unsupported.stderr).toContain("SUMI_PATH_CONFIG_UNSUPPORTED");
});

test("default with no consumers and invalid explicit selections fail visibly", async () => {
  const f = fixture(); const absent = await f.run(); expect(absent.exitCode).toBe(1); expect(absent.stderr).toContain("No configured or detected agents");
  for (const selection of ["", "unknown", "claude,codex", "ALL"]) {
    const refused = await f.run(["--agent", selection]); expect(refused.exitCode).toBe(1); expect(refused.stderr).toContain("Supported agents:");
  }
  const explicit = await f.run(["--agent", "claude"]); expect(explicit.exitCode).toBe(0);
  expect(JSON.parse(explicit.stdout).discovery.map((entry: any) => entry.agent)).toEqual(["claude"]);
});

test("malformed managed policy and dangling provider roots never fall back to another detected provider", async () => {
  const f = fixture(), dataDir = join(f.home, ".hasna", "skills"); mkdirSync(join(f.home, ".claude")); mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, "agent-policy.json"), "{"); const invalid = await f.run(); expect(invalid.exitCode).toBe(1); expect(invalid.stderr).toContain("refusing legacy fallback");
  const g = fixture(); symlinkSync(join(g.home, "missing"), join(g.home, ".claude"));
  const dangling = await g.run(); expect(dangling.exitCode).toBe(1); expect(dangling.stderr).not.toContain("No configured or detected agents");
});

test("unreadable provider configuration remains a blocking detected consumer", async () => {
  const f = fixture(), root = join(f.home, ".claude"); mkdirSync(root); chmodSync(root, 0);
  try { const result = await f.run(); expect(result.exitCode).toBe(1); expect(result.stderr).not.toContain("No configured or detected agents"); }
  finally { chmodSync(root, 0o700); }
});
