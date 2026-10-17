import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
import { admitCorpusFixture, installCorpusInspectorFixture, wrapNativeInspectionFixture } from "../lib/codex-corpus.fixture.js";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration } from "../lib/agent-integration.js";
import { captureCodexSettingsV3 } from "../lib/codex-settings-witness.js";

useDefaultTestTimeout();
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); });
const scratch = mkdtempSync(join(tmpdir(), "skills-codex-reconcile-cli-"));
const binary = join(scratch, "skills.js");
beforeAll(async () => { await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary); });
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const put = (path: string, text: string) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, text); };
const payload = (name: string) => `---\nname: ${name}\ndescription: Synthetic ${name} fixture\n---\nSynthetic disabled body\n`;
const PLUGIN = "pages@openai-curated-remote", REMOTE = "plugins~Plugin_00000000000000000000000000000758";

/** A synthetic station: reviewed Codex binding, one enrolled remote plugin, and a
 * native client whose skills/list answer comes from <root>/skills.json. */
function station() {
  const root = mkdtempSync(join(scratch, "case-")), home = join(root, "home"), dataDir = join(home, ".hasna/skills");
  mkdirSync(join(root, "tmp"), { recursive: true });
  admitCorpusFixture(join(home, ".codex"));
  const cache = join(home, ".codex/plugins/cache"), parent = join(cache, "openai-curated-remote/pages"), config = join(home, ".codex/config.toml");
  const materialize = (version: string, names: string[]) => {
    const version_root = join(parent, version);
    put(join(version_root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "pages", version, apps: "./.app.json" }));
    put(join(version_root, ".app.json"), '{"apps":{"pages":{"id":"synthetic_pages_connector"}}}');
    for (const name of names) put(join(version_root, "skills", name, "SKILL.md"), payload(name));
    return version_root;
  };
  put(join(parent, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: REMOTE }));
  const first = materialize("1.0.0", ["write-page"]);
  put(config, 'model = "synthetic"\n');
  const plugin = { id: PLUGIN, name: "pages", installed: true, enabled: true, localVersion: null, remotePluginId: REMOTE, sourceType: "remote" as const };
  const review = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [cache], sources: [captureCodexSettingsV3(config)], pluginHooks: "reviewed-no-skill-injection" as const }] };
  applyAgentIntegration(planAgentIntegration({ home, dataDir, projectDir: home, agents: ["codex"], discoveryInputs: review,
    codexNativeCatalog: { version: "codex-cli 0.163.0", cwd: home, plugins: [plugin], skills: [{ name: "pages:write-page", path: join(first, "skills/write-page/SKILL.md"), enabled: true, pluginId: PLUGIN }] } }));
  const command = join(root, "codex"), skillsFile = join(root, "skills.json");
  writeFileSync(command, wrapNativeInspectionFixture(`#!/usr/bin/env bun
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
if (process.argv[2] === "--version") { console.log("codex-cli 0.163.0"); process.exit(0); }
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.method === "initialize") console.log(JSON.stringify({ id: request.id, result: { userAgent: "skills-native-hook-enrollment/0.163.0 synthetic" } }));
  if (request.method === "skills/list") console.log(JSON.stringify({ id: request.id, result: { data: [{ cwd: request.params.cwds[0], errors: [], skills: JSON.parse(readFileSync(${JSON.stringify(skillsFile)}, "utf8")) }] } }));
  if (request.method === "plugin/installed") console.log(JSON.stringify({ id: request.id, result: { marketplaces: [{ name: "openai-curated-remote", plugins: [{ id: ${JSON.stringify(PLUGIN)}, name: "pages", installed: true, enabled: true, localVersion: null, remotePluginId: ${JSON.stringify(REMOTE)}, source: { type: "remote" } }] }], marketplaceLoadErrors: [] } }));
}
`), { mode: 0o700 });
  chmodSync(command, 0o700);
  const bridge = { name: "skills-cli", path: join(home, ".codex/skills/skills-cli/SKILL.md"), enabled: true, pluginId: null };
  const listSkills = (skills: unknown[]) => writeFileSync(skillsFile, JSON.stringify([bridge, ...skills]));
  listSkills([]);
  const run = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, "hook", "codex-reconcile", "--codex-command", command, ...args], {
      cwd: home, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { PATH: `${process.env.PATH ?? ""}`, HOME: home, USERPROFILE: home, TMPDIR: join(root, "tmp"), HASNA_SKILLS_DIR: dataDir, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", NO_COLOR: "1", TERM: "dumb" },
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    const lines = stdout.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(stderr).toBe("");
    return { exitCode, result: JSON.parse(lines[0]!) };
  };
  return { home, dataDir, config, first, parent, materialize, listSkills, run, options: { home, dataDir, projectDir: home } };
}

test("built CLI emits exactly one JSON result per outcome with matching exit codes", async () => {
  const s = station();
  expect(await s.run("--json")).toMatchObject({ exitCode: 0, result: { outcome: "unchanged", mode: "preview", counts: { enrolled: 0, alreadyEnrolled: 1, allowed: 1 }, allowed: ["skills-cli"] } });
  rmSync(s.first, { recursive: true });
  const next = s.materialize("1.1.0", ["write-page", "publish-page"]);
  s.listSkills([{ name: "pages:publish-page", path: join(next, "skills/publish-page/SKILL.md"), enabled: true, pluginId: PLUGIN }]);
  const config = readFileSync(s.config, "utf8");
  expect(await s.run()).toMatchObject({ exitCode: 0, result: { outcome: "planned", enrolled: ["pages:publish-page"] } });
  expect(readFileSync(s.config, "utf8")).toBe(config);
  const applied = await s.run("--apply", "--json");
  expect(applied).toMatchObject({ exitCode: 0, result: { outcome: "applied", mode: "apply", enrolled: ["pages:publish-page"], counts: { enrolled: 1, alreadyEnrolled: 1, allowed: 1 } } });
  expect(applied.result.code).toBeUndefined();
  expect(() => assertManagedAgentBridge("codex", s.options)).not.toThrow();
  expect(await s.run("--apply")).toMatchObject({ exitCode: 0, result: { outcome: "unchanged", enrolled: [] } });
  // A capability change refuses with exit 2 and the named code; nothing is written.
  put(join(next, ".app.json"), '{"apps":{"pages":{"id":"another_connector"}}}');
  const settled = readFileSync(s.config, "utf8");
  expect(await s.run("--apply", "--json")).toMatchObject({ exitCode: 2, result: { outcome: "refused", code: "CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED", refusals: [{ pluginId: PLUGIN, reasons: ["app"] }] } });
  expect(readFileSync(s.config, "utf8")).toBe(settled);
});

test("built CLI reports an unavailable native client as one error result", async () => {
  const s = station();
  const child = Bun.spawn([process.execPath, "--no-env-file", binary, "hook", "codex-reconcile", "--codex-command", join(s.home, "missing-codex"), "--apply"], {
    cwd: s.home, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    env: { PATH: `${process.env.PATH ?? ""}`, HOME: s.home, TMPDIR: join(s.home, "..", "tmp"), HASNA_SKILLS_DIR: s.dataDir, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", NO_COLOR: "1", TERM: "dumb" },
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(exitCode).toBe(1); expect(stderr).toBe("");
  const lines = stdout.split("\n").filter(Boolean);
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]!)).toMatchObject({ outcome: "error", mode: "apply", enrolled: [], changes: [] });
  expect(typeof JSON.parse(lines[0]!).code).toBe("string");
});
