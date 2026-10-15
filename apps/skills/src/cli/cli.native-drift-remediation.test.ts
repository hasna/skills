import { installSumiPathsFixture } from "../lib/sumi-paths.fixture.js";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
import { admitCorpusFixture, corpusInspectorPathFixture } from "../lib/codex-corpus.fixture.js";
import { captureCodexSettingsV4 } from "../lib/codex-settings-witness.js";

useDefaultTestTimeout();
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "skills-drift-remediation-")));
const entry = join(scratch, "entry.ts"), binary = join(scratch, "skills.js");
// The real registered hook and migrate commands across a real subprocess
// boundary; only the context/sync child response is synthetic.
beforeAll(async () => {
  writeFileSync(entry, `import { Command } from ${JSON.stringify(require.resolve("commander"))};
import { registerAgentIntegration } from ${JSON.stringify(resolve(import.meta.dir, "commands/agent-integration.ts"))};
if (["context", "sync"].includes(process.argv[2] ?? "")) {
  process.stdout.write(process.env.SKILLS_TEST_CHILD_STDOUT ?? "{}");
  process.exitCode = Number(process.env.SKILLS_TEST_CHILD_EXIT ?? "1");
} else {
  const program = new Command(); registerAgentIntegration(program); await program.parseAsync(process.argv);
}
`);
  await buildCliFixture(entry, binary);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const payload = (name: string) => `---\nname: ${name}\ndescription: Synthetic drift remediation fixture\n---\nSynthetic native instructions\n`;
const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
/** A fresh reviewed discovery input for the current configuration. */
const freshReview = (config: string) => {
  const file = join(scratch, `review-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify({ version: 1, agents: [{ agent: "codex", roots: [], sources: [captureCodexSettingsV4(config)], pluginHooks: "reviewed-no-skill-injection" }] }));
  return file;
};
const delivered = { SKILLS_TEST_CHILD_EXIT: "0", SKILLS_TEST_CHILD_STDOUT: JSON.stringify({ context: "Verified fixture context" }) };

/** Station02 shape: a reviewed Codex binding (typed V4 witness) with an enabled
 * local plugin that declares hooks, like the Hasna Codex bridge plugin. */
async function station(initial = "") {
  const home = mkdtempSync(join(scratch, "home-")), data = join(home, ".hasna", "skills");
  mkdirSync(data, { recursive: true });
  admitCorpusFixture(join(home, ".codex"));
  const env = { PATH: `${installSumiPathsFixture(home)}:${corpusInspectorPathFixture()}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: data, NO_COLOR: "1", TMPDIR: scratch };
  const run = async (args: string[], childEnv: Record<string, string> = {}, input: unknown = {}, cwd = home) => {
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, ...args], { cwd, env: { ...env, ...childEnv }, stdin: new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, status };
  };
  const config = join(home, ".codex", "config.toml"), market = join(home, "bridge-marketplace"), pluginRoot = join(market, "plugins", "hasna-codex");
  put(join(market, ".agents", "plugins", "marketplace.json"), JSON.stringify({ name: "hasna-internal-bridge", plugins: [{ name: "hasna-codex", source: { source: "local", path: "./plugins/hasna-codex" } }] }));
  put(join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "hasna-codex", version: "0.1.0" }));
  put(join(pluginRoot, "hooks", "hooks.json"), JSON.stringify({ hooks: {} }));
  put(config, `[marketplaces.hasna-internal-bridge]\nsource_type = "local"\nsource = ${JSON.stringify(market)}\n\n[plugins."hasna-codex@hasna-internal-bridge"]\nenabled = true\n${initial ? `\n${initial}` : ""}`);
  const review = join(scratch, `review-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(review, JSON.stringify({ version: 1, agents: [{ agent: "codex", roots: [], sources: [captureCodexSettingsV4(config)], pluginHooks: "reviewed-no-skill-injection" }] }));
  const installed = await run(["hook", "install", "--agent", "codex", "--selection-profile", "engineering", "--command", binary, "--discovery-inputs", review, "--apply", "--json"]);
  expect([installed.status, installed.stderr]).toEqual([0, ""]);
  const cwd = mkdtempSync(join(scratch, "isolated-cwd-"));
  const hook = async () => {
    const result = await run(["hook", "user-prompt", "--agent", "codex", "--selection-profile", "engineering", "--event", "UserPromptSubmit"], delivered, { hook_event_name: "UserPromptSubmit", prompt: "test request", cwd }, cwd);
    expect([result.status, result.stderr]).toEqual([0, ""]);
    return JSON.parse(result.stdout);
  };
  expect((await hook()).decision).toBeUndefined();
  return { home, cwd, config, run, hook };
}

test("the drift refusal names remediation that works on a station whose configured plugin declares hooks", async () => {
  const s = await station();
  // A user copy and a refreshed OpenAI vendor copy, as stations 02, 08 and 11 saw.
  const user = join(s.home, ".agents", "skills", "user-copy");
  put(join(user, "SKILL.md"), payload("user-copy"));
  const parent = join(s.home, ".codex", "plugins", "cache", "openai-curated-remote", "sites"), vendor = join(parent, "1.0.2", "skills", "sites");
  put(join(parent, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: "plugins_synthetic_00_0000000000000000000" }));
  put(join(parent, "1.0.2", ".codex-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "1.0.2", description: "Synthetic plugin" }));
  put(join(vendor, "SKILL.md"), payload("sites"));

  const blocked = await s.hook();
  expect(blocked.decision).toBe("block");
  expect(blocked.reason).toBe(`NATIVE_SKILL_DRIFT: 2 unexpected native skill copies were found: ${JSON.stringify(user)}, ${JSON.stringify(vendor)}. For user and project copies, review skills migrate native --agent codex --project <working-directory> --include-unmanaged --json before continuing; it inventories that directory and its ancestors. Use --apply after reviewing the archive plan. Codex refreshes OpenAI marketplace copies on its own, so disable each in Codex instead: add [[skills.config]] with name = "sites:sites" and enabled = false to ${JSON.stringify(s.config)}. Codex then never loads it and the Codex prompt hook accepts it.`);
  expect(blocked.reason).not.toContain("--include-vendor");

  // The 0.10.72 hint refuses here: --include-vendor resolves configured plugins.
  const old = await s.run(["migrate", "native", "--agent", "codex", "--project", s.cwd, "--include-unmanaged", "--include-vendor", "--json"]);
  expect([old.status, old.stderr.trim()]).toEqual([1, "Native discovery is unresolved (codex: plugin hooks require a separate no-skill-injection review); provide a reviewed --discovery-inputs file"]);

  // The named user-copy command works and archives only the user copy.
  const plan = await s.run(["migrate", "native", "--agent", "codex", "--project", s.cwd, "--include-unmanaged", "--json"]);
  expect([plan.status, plan.stderr]).toEqual([0, ""]);
  expect(JSON.parse(plan.stdout).inventory.filter((item: any) => !item.bridge).map((item: any) => item.path)).toEqual([user]);
  const applied = await s.run(["migrate", "native", "--agent", "codex", "--project", s.cwd, "--include-unmanaged", "--apply", "--json"]);
  expect([applied.status, applied.stderr]).toEqual([0, ""]);
  expect(existsSync(user)).toBe(false);
  expect(existsSync(join(vendor, "SKILL.md"))).toBe(true);

  // The named Codex disable rule retires the vendor copy without a rebind.
  const remaining = await s.hook();
  expect(remaining.reason).toStartWith(`NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: ${JSON.stringify(vendor)}. Codex refreshes OpenAI marketplace copies`);
  writeFileSync(s.config, `${readFileSync(s.config, "utf8").trimEnd()}\n\n[[skills.config]]\nname = "sites:sites"\nenabled = false\n`);
  const accepted = await s.hook();
  expect(accepted.decision).toBeUndefined();
  expect(accepted.reason).toBeUndefined();

  // A strict guard call (hook install reusing the saved review, as trust enrolment
  // also does) ignores the hand-added name rule, so it names a refreshed binding
  // rather than repeating the rule.
  const reused = await s.run(["hook", "install", "--agent", "codex", "--apply", "--json"]);
  expect([reused.status, reused.stderr.trim()]).toEqual([1, `NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: ${JSON.stringify(vendor)}. This check, unlike the live Codex prompt hook, does not accept a hand-added Codex name rule for a plugin-cache copy, so refresh the binding instead: skills hook install --agent codex --discovery-inputs <reviewed-file> --apply, with a fresh discovery review. It disables and records each copy.`]);
  // The named step works, and the saved review is reusable again afterwards.
  const refreshed = await s.run(["hook", "install", "--agent", "codex", "--discovery-inputs", freshReview(s.config), "--apply", "--json"]);
  expect([refreshed.status, refreshed.stderr]).toEqual([0, ""]);
  const again = await s.run(["hook", "install", "--agent", "codex", "--apply", "--json"]);
  expect([again.status, again.stderr]).toEqual([0, ""]);
  expect((await s.hook()).decision).toBeUndefined();
});

test("on a reviewed binding, removing an enabling rule is followed by the named refreshed binding, which clears the refusal", async () => {
  const enabling = `[[skills.config]]\nname = "sites:sites"\nenabled = true\n`;
  const s = await station(enabling);
  const parent = join(s.home, ".codex", "plugins", "cache", "openai-curated-remote", "sites"), vendor = join(parent, "1.0.2", "skills", "sites");
  put(join(parent, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: "plugins_synthetic_00_0000000000000000000" }));
  put(join(parent, "1.0.2", ".codex-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "1.0.2", description: "Synthetic plugin" }));
  put(join(vendor, "SKILL.md"), payload("sites"));
  const blocked = await s.hook();
  expect(blocked.reason).toBe(`NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: ${JSON.stringify(vendor)}. For other Codex plugin-cache copies, add [[skills.config]] with the exact path of each SKILL.md and enabled = false to ${JSON.stringify(s.config)}, or remove the plugin in Codex. First remove the [[skills.config]] rules there that enable skills; no path rule counts while one does. The reviewed binding records that file, so follow the edit with skills hook install --agent codex --discovery-inputs <reviewed-file> --apply, with a fresh discovery review.`);
  // Follow it exactly: the edit alone changes the recorded configuration...
  writeFileSync(s.config, `${readFileSync(s.config, "utf8").replace(enabling, "").trimEnd()}\n\n[[skills.config]]\npath = ${JSON.stringify(join(vendor, "SKILL.md"))}\nenabled = false\n`);
  expect((await s.hook()).reason).toBe(`NATIVE_SKILL_DRIFT: Native discovery input changed; run skills hook install with a fresh discovery review: ${s.config}`);
  // ...and the named refreshed binding clears it for the hook and for strict callers.
  const refreshed = await s.run(["hook", "install", "--agent", "codex", "--discovery-inputs", freshReview(s.config), "--apply", "--json"]);
  expect([refreshed.status, refreshed.stderr]).toEqual([0, ""]);
  expect((await s.hook()).decision).toBeUndefined();
  const reused = await s.run(["hook", "install", "--agent", "codex", "--apply", "--json"]);
  expect([reused.status, reused.stderr]).toEqual([0, ""]);
});
