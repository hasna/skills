import { afterAll, beforeAll, expect, test } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "skills-discovery-review-cli-")));
const entry = join(scratch, "entry.ts"), binary = join(scratch, "skills.js");
beforeAll(async () => {
  writeFileSync(entry, `import { Command } from ${JSON.stringify(require.resolve("commander"))};
import { registerAgentIntegration } from ${JSON.stringify(resolve(import.meta.dir, "commands/agent-integration.ts"))};
const program = new Command(); registerAgentIntegration(program); await program.parseAsync(process.argv);
`);
  await buildCliFixture(entry, binary);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const put = (path: string, value: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n", { mode: 0o644 }); };

/** A realistic Claude station: user settings, one enabled official cache
 * plugin, and its installed-plugin registration. */
function station() {
  const home = mkdtempSync(join(scratch, "home-")), data = join(home, "skills-data"), project = join(home, "project");
  mkdirSync(project, { recursive: true });
  const claude = join(home, ".claude"), pluginRoot = join(claude, "plugins/cache/claude-plugins-official/swift-lsp/1.0.0");
  const settings = join(claude, "settings.json"), registry = join(claude, "plugins/installed_plugins.json"), manifest = join(pluginRoot, ".claude-plugin/plugin.json");
  put(settings, { enabledPlugins: { "swift-lsp@claude-plugins-official": true }, permissions: { allow: ["Read"] }, model: "sonnet" });
  put(registry, { version: 2, plugins: { "swift-lsp@claude-plugins-official": [{ scope: "user", installPath: pluginRoot, version: "1.0.0" }] } });
  put(manifest, { name: "swift-lsp", version: "1.0.0" });
  mkdirSync(join(pluginRoot, "skills"), { recursive: true });
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_SKILLS_DIR: data, NO_COLOR: "1", TMPDIR: scratch };
  const run = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, ...args], { cwd: project, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, status };
  };
  const review = (name = "review") => join(home, `${name}-${Math.random().toString(36).slice(2)}.json`);
  return { home, data, project, settings, registry, manifest, pluginRoot, run, review };
}

test("the remedy command captures, applies and re-verifies a fresh Claude review after settings drift", async () => {
  const s = station();
  const first = s.review("first");
  const captured = await s.run(["hook", "discovery-review", "--agent", "claude", "--output", first, "--json"]);
  expect([captured.status, captured.stderr]).toEqual([0, ""]);
  const receipt = JSON.parse(captured.stdout);
  expect(receipt).toMatchObject({ schema: "hasna.skills.discovery-review-capture.v1", agent: "claude", output: first, previousMethod: null });
  expect(receipt.sources).toBeGreaterThan(0);
  expect(statSync(first).mode & 0o077).toBe(0);
  const review = JSON.parse(readFileSync(first, "utf8"));
  expect(review.agents[0].sources.some((source: any) => source.format !== undefined || source.fields !== undefined)).toBe(false);
  expect(review.agents[0].sources.some((source: any) => source.path === s.settings && source.hashMode === "claude-settings-v5")).toBe(true);

  const applied = await s.run(["hook", "install", "--agent", "claude", "--command", binary, "--discovery-inputs", first, "--apply", "--json"]);
  expect([applied.status, applied.stderr]).toEqual([0, ""]);

  // A discovery-bound settings change (a Skill deny rule survives the install
  // write) makes the saved review stale and names the capture command.
  put(s.settings, { enabledPlugins: { "swift-lsp@claude-plugins-official": true }, permissions: { allow: ["Read"], deny: ["Skill(retired-skill)"] }, model: "sonnet" });
  const drift = await s.run(["hook", "install", "--agent", "claude", "--command", binary, "--json"]);
  expect(drift.status).toBe(1);
  expect(drift.stderr).toContain("NATIVE_SKILL_DRIFT");
  expect(drift.stderr).toContain(`skills hook discovery-review --agent claude --output <new-review-file>, then run skills hook install --agent claude --discovery-inputs <new-review-file> --apply`);

  const second = s.review("second");
  const recaptured = await s.run(["hook", "discovery-review", "--agent", "claude", "--output", second, "--json"]);
  expect([recaptured.status, recaptured.stderr]).toEqual([0, ""]);
  const secondReceipt = JSON.parse(recaptured.stdout);
  expect(secondReceipt.previousMethod).toBe("reviewed");
  expect(secondReceipt.changes).toEqual([expect.objectContaining({ path: s.settings, kind: "changed" })]);

  const plan = await s.run(["hook", "install", "--agent", "claude", "--command", binary, "--discovery-inputs", second, "--json"]);
  expect([plan.status, plan.stderr]).toEqual([0, ""]);
  const apply = await s.run(["hook", "install", "--agent", "claude", "--command", binary, "--discovery-inputs", second, "--apply", "--json"]);
  expect([apply.status, apply.stderr]).toEqual([0, ""]);
  const reused = await s.run(["hook", "install", "--agent", "claude", "--command", binary, "--json"]);
  expect([reused.status, reused.stderr]).toEqual([0, ""]);
  expect(JSON.parse(reused.stdout).planned).toEqual([]);
});

test("the CLI refuses to overwrite a review file, accepts only absolute paths, and still refuses the stored binding", async () => {
  const s = station();
  const output = s.review("existing");
  put(output, "{}");
  const overwrite = await s.run(["hook", "discovery-review", "--agent", "claude", "--output", output, "--json"]);
  expect(overwrite.status).toBe(1);
  expect(overwrite.stderr).toContain("DISCOVERY_REVIEW_OUTPUT_EXISTS");
  expect(readFileSync(output, "utf8")).toBe("{}");
  const relative = await s.run(["hook", "discovery-review", "--agent", "claude", "--output", "review.json", "--json"]);
  expect(relative.status).toBe(1);
  expect(relative.stderr).toContain("DISCOVERY_REVIEW_OUTPUT_ABSOLUTE_REQUIRED");
  expect(lstatSync(join(s.project, "review.json"), { throwIfNoEntry: false })).toBeUndefined();

  const first = s.review("first");
  expect((await s.run(["hook", "discovery-review", "--agent", "claude", "--output", first, "--json"])).status).toBe(0);
  expect((await s.run(["hook", "install", "--agent", "claude", "--command", binary, "--discovery-inputs", first, "--apply", "--json"])).status).toBe(0);
  const policy = JSON.parse(readFileSync(join(s.data, "agent-policy.json"), "utf8"));
  const binding = policy.bridge.discovery.claude;
  const hand = s.review("hand");
  put(hand, { version: 1, agents: [{ agent: "claude", pluginHooks: "reviewed-no-skill-injection", roots: binding.roots, sources: binding.sources, directories: binding.directories }] });
  const refused = await s.run(["hook", "install", "--agent", "claude", "--command", binary, "--discovery-inputs", hand, "--json"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("Explicit discovery reviews require full source-file hashes");
});
