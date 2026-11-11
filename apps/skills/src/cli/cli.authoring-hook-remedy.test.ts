import { beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
import { installSumiPathsFixture } from "../lib/sumi-paths.fixture.js";
import { admitCorpusFixture, corpusInspectorPathFixture } from "../lib/codex-corpus.fixture.js";
import { captureCodexSettingsV4 } from "../lib/codex-settings-witness.js";

// HAS-00036: measured on 05.11 on station01 (skills 0.10.92), `skills create`,
// `skills new` and `skills prepare --dry-run` each exited 1 with «Native
// discovery is unresolved (codex: plugin hooks require current independently
// reviewed sources); provide a reviewed --discovery-inputs file», an option
// those commands do not have. The refusal is a deliberate gate (an unreviewed
// hook could load skills from the authoring corpus) and stays; the message must
// name the command that resolves it. This fixture is that station's shape with
// synthetic values. Fixtures are left in TMPDIR for evidence.
useDefaultTestTimeout();
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "skills-authoring-hook-remedy-")));
const entry = join(scratch, "entry.ts"), binary = join(scratch, "skills.js");
// The real registered authoring and native integration commands across a real
// subprocess boundary.
beforeAll(async () => {
  writeFileSync(entry, `import { Command } from ${JSON.stringify(require.resolve("commander"))};
import { registerCreateSync } from ${JSON.stringify(resolve(import.meta.dir, "commands/create-sync-config.ts"))};
import { registerPortableSkillCommands } from ${JSON.stringify(resolve(import.meta.dir, "commands/portable-skills.ts"))};
import { registerAgentIntegration } from ${JSON.stringify(resolve(import.meta.dir, "commands/agent-integration.ts"))};
// Hook install spawns the context/sync child only through this stub.
if (["context", "sync"].includes(process.argv[2] ?? "")) { process.stdout.write("{}"); process.exitCode = 1; }
else { const program = new Command(); registerCreateSync(program); registerPortableSkillCommands(program); registerAgentIntegration(program); await program.parseAsync(process.argv); }
`);
  await buildCliFixture(entry, binary);
});

const sha = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
const put = (path: string, text: string): void => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const remedy = "This command takes no --discovery-inputs option; review the current codex configuration with skills hook install --agent codex --discovery-inputs <reviewed-file> --apply, then retry.";
const staleRemedy = "provide a reviewed --discovery-inputs file";

/** `retained`: the policy keeps a reviewed Codex binding whose hook witness is
 * now stale (station01); otherwise there is no Skills policy at all. The Codex
 * configuration is written by `arm`, so a draft can be seeded first. */
function station(retained: boolean) {
  const home = realpathSync(mkdtempSync(join(scratch, "home-")));
  const market = join(home, "bridge/runtime/0.1.11/package/plugin"), root = join(market, "plugins/hasna-codex");
  const config = join(home, ".codex/config.toml"), catalog = join(market, ".agents/plugins/marketplace.json");
  const manifest = join(root, ".codex-plugin/plugin.json"), hooks = join(root, "hooks/hooks.json");
  const executable = join(home, "bridge/runtime/0.1.11/package/bin/codex-hasna.mjs");
  const data = join(home, ".hasna/skills"), policy = join(data, "agent-policy.json");
  mkdirSync(data, { recursive: true });
  const arm = (): void => {
    put(executable, "// bridge runtime\n");
    put(catalog, JSON.stringify({ name: "hasna-internal-bridge", plugins: [{ name: "hasna-codex", source: { source: "local", path: "./plugins/hasna-codex" } }] }));
    put(manifest, JSON.stringify({ name: "hasna-codex", version: "0.1.0", description: "Bridge", hooks: "./hooks/hooks.json" }));
    const handler = { type: "mcp_tool", server: "hasna-codex", tool: "activate_hook", input: { event: "${hook_event_name}" }, timeout: 30 };
    put(hooks, JSON.stringify({ description: "Bridge hooks", hooks: { SessionStart: [{ hooks: [handler] }] } }));
    put(config, `model = "synthetic"\n[marketplaces.hasna-internal-bridge]\nsource_type = "local"\nsource = "${market}"\n\n[plugins."hasna-codex@hasna-internal-bridge"]\nenabled = true\n\n[mcp_servers.hasna-codex]\ncommand = "/usr/bin/env"\nargs = ["-i", "HOME=${home}", "${executable}", "--stdio"]\ncwd = "${home}"\nenabled = true\n`);
    if (!retained) return;
    const claudeConfig = join(home, ".claude/settings.json"); put(claudeConfig, "{}");
    const claude = { agent: "claude", method: "reviewed", roots: [], sources: [{ path: claudeConfig, sha256: sha("{}") }] };
    const codex = { agent: "codex", method: "reviewed", roots: [], sources: [config, manifest, hooks, catalog, executable].map(path => ({ path, sha256: sha(readFileSync(path)) })) };
    put(policy, JSON.stringify({ loading: "cli", bridge: { home, discovery: { claude, codex } } }));
    // The hook file changes after its review, as a Codex plugin update does.
    put(hooks, JSON.stringify({ description: "Bridge hooks", hooks: { SessionStart: [{ hooks: [handler] }], Stop: [{ hooks: [handler] }] } }));
  };
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: data, NO_COLOR: "1", TERM: "dumb", TMPDIR: scratch };
  const run = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install", binary, ...args], { cwd: home, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { output: stdout + stderr, status };
  };
  // Every native input, the Skills policy and the authoring corpus.
  const state = () => [config, manifest, hooks, catalog, executable, policy, join(data, "installed")].map(path => existsSync(path) ? (path.endsWith("installed") ? "dir" : sha(readFileSync(path))) : null);
  return { home, data, hooks, arm, run, state };
}

/** The kept refusal, with the remedy authoring can actually use. */
function refusedWithRemedy(result: { output: string; status: number }, retained: boolean, hooks: string): void {
  expect(result.status).toBe(1);
  expect(result.output).not.toContain(staleRemedy);
  const message = JSON.parse(result.output).error as string;
  expect(message).toStartWith(`Native discovery is unresolved (codex: plugin hooks require ${retained ? "current independently reviewed sources" : "a separate no-skill-injection review"}). Checked source: ${hooks}. Portable Skills authoring stays refused: an unreviewed codex hook or plugin option could load skills written to `);
  expect(message).toEndWith(remedy);
}

for (const retained of [true, false]) {
  const shape = retained ? "a stale retained review of a Codex plugin hook" : "an unreviewed Codex plugin hook and no Skills policy";

  test(`skills create still refuses ${shape} and names the command that reviews it`, async () => {
    const s = station(retained); s.arm();
    const before = s.state();
    refusedWithRemedy(await s.run(["create", "product-logo", "--kind", "instruction", "--description", "Synthetic authoring fixture", "--json"]), retained, s.hooks);
    expect(s.state()).toEqual(before);
  });

  test(`skills new still refuses ${shape} and names the command that reviews it`, async () => {
    const s = station(retained); s.arm();
    const before = s.state();
    refusedWithRemedy(await s.run(["new", "product-logo", "--kind", "instruction", "--description", "Synthetic authoring fixture", "--json"]), retained, s.hooks);
    expect(s.state()).toEqual(before);
  });

  test(`skills prepare --dry-run still refuses ${shape} and names the command that reviews it`, async () => {
    const s = station(retained);
    // Seed the draft before the Codex plugin is configured.
    const seeded = await s.run(["new", "product-logo", "--kind", "instruction", "--description", "Synthetic authoring fixture", "--json"]);
    expect(seeded.status).toBe(0);
    const manifestPath = join(JSON.parse(seeded.output).path, "skill.json");
    s.arm();
    const before = s.state(), draft = readFileSync(manifestPath, "utf8");
    refusedWithRemedy(await s.run(["prepare", "product-logo", "--version", "0.2.0", "--dry-run", "--json"]), retained, s.hooks);
    expect(readFileSync(manifestPath, "utf8")).toBe(draft);
    expect(s.state()).toEqual(before);
  });

  test(`commands that change native harness state keep their own refusal for ${shape}`, async () => {
    const s = station(retained); s.arm();
    const before = s.state();
    // These commands accept --discovery-inputs, so their messages name it.
    const install = await s.run(["hook", "install", "--agent", "codex", "--apply", "--json"]);
    expect(install.status).toBe(1);
    expect(install.output).toContain(retained ? "that review no longer verifies, so a fresh explicit review is required: capture one with skills hook discovery-review --agent codex --output <new-review-file>, then run skills hook install --agent codex --discovery-inputs <new-review-file> --apply" : "Native discovery is unresolved (codex: plugin hooks require a separate no-skill-injection review); provide a reviewed --discovery-inputs file");
    const vendor = await s.run(["migrate", "native", "--agent", "codex", "--project", s.home, "--include-vendor", "--json"]);
    expect([vendor.status, vendor.output.trim()]).toEqual([1, "Native discovery is unresolved (codex: plugin hooks require a separate no-skill-injection review); provide a reviewed --discovery-inputs file"]);
    expect(s.state()).toEqual(before);
  });
}

test("create, new, prepare and port help say that unreviewed native hooks block authoring and how to review them", async () => {
  const s = station(false);
  for (const command of ["create", "new", "prepare", "port"]) {
    const help = await s.run([command, "--help"]);
    expect(help.status).toBe(0);
    expect(help.output).toContain("Authoring refuses while another agent's native hooks, plugin hooks or plugin");
    expect(help.output).toContain("skills hook install --agent <agent> --discovery-inputs <reviewed-file> --apply");
    expect(help.output).toContain("Authoring commands themselves take no --discovery-inputs option.");
  }
});

test("the named remedy works: a reviewed hook install covering the plugin hooks lets authoring continue", async () => {
  // Station02 shape (as cli.native-drift-remediation.test.ts): an enabled
  // local Codex plugin that declares hooks, before any Skills policy exists.
  const home = realpathSync(mkdtempSync(join(scratch, "remedy-"))), data = join(home, ".hasna/skills");
  mkdirSync(data, { recursive: true });
  admitCorpusFixture(join(home, ".codex"));
  const env = { PATH: `${installSumiPathsFixture(home)}:${corpusInspectorPathFixture()}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: data, NO_COLOR: "1", TMPDIR: scratch };
  const run = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install", binary, ...args], { cwd: home, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { output: stdout + stderr, status };
  };
  const market = join(home, "bridge-marketplace"), root = join(market, "plugins", "hasna-codex"), config = join(home, ".codex/config.toml");
  const catalog = join(market, ".agents/plugins/marketplace.json"), manifest = join(root, ".codex-plugin/plugin.json"), hooks = join(root, "hooks/hooks.json");
  put(catalog, JSON.stringify({ name: "hasna-internal-bridge", plugins: [{ name: "hasna-codex", source: { source: "local", path: "./plugins/hasna-codex" } }] }));
  put(manifest, JSON.stringify({ name: "hasna-codex", version: "0.1.0" }));
  put(hooks, JSON.stringify({ hooks: {} }));
  put(config, `[marketplaces.hasna-internal-bridge]\nsource_type = "local"\nsource = ${JSON.stringify(market)}\n\n[plugins."hasna-codex@hasna-internal-bridge"]\nenabled = true\n`);
  const refused = await run(["new", "product-logo", "--kind", "instruction", "--json"]);
  expect(refused.status).toBe(1);
  expect(JSON.parse(refused.output).error).toEndWith(remedy);
  // Exactly the named command, with a review that covers the plugin's hook sources.
  const review = join(scratch, `review-${Math.random().toString(36).slice(2)}.json`);
  const bytes = (path: string) => ({ path, sha256: sha(readFileSync(path)) });
  writeFileSync(review, JSON.stringify({ version: 1, agents: [{ agent: "codex", roots: [], sources: [captureCodexSettingsV4(config), bytes(manifest), bytes(hooks), bytes(catalog)], pluginHooks: "reviewed-no-skill-injection" }] }));
  const installed = await run(["hook", "install", "--agent", "codex", "--selection-profile", "engineering", "--command", binary, "--discovery-inputs", review, "--apply", "--json"]);
  expect(installed.status).toBe(0);
  const created = await run(["new", "product-logo", "--kind", "instruction", "--json"]);
  expect(created.status).toBe(0);
  expect(existsSync(join(JSON.parse(created.output).path, "SKILL.md"))).toBe(true);
  // A later change to the reviewed hook file refuses authoring again.
  put(hooks, JSON.stringify({ hooks: { Stop: [] } }));
  const again = await run(["new", "product-mark", "--kind", "instruction", "--json"]);
  expect(again.status).toBe(1);
  expect(JSON.parse(again.output).error).toEndWith(remedy);
});
