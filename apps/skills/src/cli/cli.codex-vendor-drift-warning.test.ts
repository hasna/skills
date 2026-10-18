import { installSumiPathsFixture } from "../lib/sumi-paths.fixture.js";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { captureCodexRemoteReceiptSnapshot } from "../lib/codex-native-skill-catalog.js";
import { tmpdir } from "node:os";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
import { admitCorpusFixture, corpusInspectorPathFixture } from "../lib/codex-corpus.fixture.js";

useDefaultTestTimeout();
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "skills-vendor-drift-hook-")));
const entry = join(scratch, "entry.ts"), binary = join(scratch, "skills.js");
// Exercise the real registered hook command and real subprocess boundary. Only
// the child context/sync response is synthetic; no live configuration is read.
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

const payload = (name: string) => `---\nname: ${name}\ndescription: Synthetic vendor plugin refresh fixture\n---\nSynthetic native instructions\n`;
const put = (p: string, s: string) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
const delivered = { SKILLS_TEST_CHILD_EXIT: "0", SKILLS_TEST_CHILD_STDOUT: JSON.stringify({ context: "Verified fixture context" }) };
const REMOTE_ID = "plugins_synthetic_00_0000000000000000000";

/** A station shaped like station04: Skills hooks installed for every agent, then
 * a reviewed native catalog enrolled the remote `sites@openai-curated-remote`
 * plugin (1.0.1), then a remote refresh deposited 1.0.2-remix-b.1/sites-remix. */
async function station04() {
  const home = mkdtempSync(join(scratch, "home-")), data = join(home, ".hasna", "skills");
  mkdirSync(data, { recursive: true });
  admitCorpusFixture(join(home, ".codex"));
  const env = { PATH: `${installSumiPathsFixture(home)}:${corpusInspectorPathFixture()}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: data, NO_COLOR: "1", TMPDIR: scratch };
  async function run(args: string[], childEnv: Record<string, string> = {}, input: unknown = {}, cwd = home) {
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, ...args], { cwd, env: { ...env, ...childEnv }, stdin: new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stderr).toBe(""); expect(status).toBe(0);
    return { value: JSON.parse(stdout), stdout };
  }
  await run(["hook", "install", "--agent", "all", "--selection-profile", "engineering", "--command", binary, "--apply", "--json"]);
  const config = join(home, ".codex", "config.toml"), parent = join(home, ".codex", "plugins", "cache", "openai-curated-remote", "sites");
  const oldDocument = join(parent, "1.0.1", "skills", "sites", "SKILL.md");
  put(join(parent, "1.0.1", ".codex-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "1.0.1", description: "Synthetic plugin" }));
  put(oldDocument, payload("sites"));
  put(join(parent, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: REMOTE_ID }));
  writeFileSync(config, `${readFileSync(config, "utf8").trimEnd()}\n\n[[skills.config]]\npath = ${JSON.stringify(oldDocument)}\nenabled = false\n`);
  const catalog = join(scratch, `catalog-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(catalog, JSON.stringify({ version: "codex-cli 0.160.0", cwd: home, skills: [], plugins: [{ id: "sites@openai-curated-remote", name: "sites", installed: true, enabled: true, localVersion: null, remotePluginId: REMOTE_ID, sourceType: "remote" }], remoteReceipts: captureCodexRemoteReceiptSnapshot(join(home, ".codex", "plugins", "cache")) }));
  const receipt = await run(["hook", "install", "--agent", "codex", "--codex-native-catalog", catalog, "--apply", "--json"]);
  expect(receipt.value.codexPluginSkills.map((control: any) => control.name)).toEqual(["sites:sites"]);
  const installed = readFileSync(config, "utf8");
  // An isolated working directory, outside the home, as a Codex session in a repository has.
  const cwd = mkdtempSync(join(scratch, "isolated-cwd-"));
  const hook = (event = "UserPromptSubmit", agent = "codex", childEnv: Record<string, string> = delivered) =>
    run(["hook", "user-prompt", "--agent", agent, "--selection-profile", "engineering", "--event", event], childEnv, { hook_event_name: event, prompt: "test request", cwd }, cwd);
  const clean = await hook();
  expect(clean.value.decision).toBeUndefined(); expect(clean.value.systemMessage).toBeUndefined();
  const copy = join(parent, "1.0.2-remix-b.1", "skills", "sites-remix");
  put(join(parent, "1.0.2-remix-b.1", ".codex-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "1.0.2-remix-b.1", description: "Synthetic plugin" }));
  put(join(copy, "SKILL.md"), payload("sites-remix"));
  const setConfig = (rows: string) => writeFileSync(config, `${installed.trimEnd()}\n\n${rows}`);
  return { home, cwd, config, copy, installed, hook, run, setConfig };
}

test("station04 replay from an isolated cwd: an enabled refreshed vendor skill blocks every Codex lifecycle event", async () => {
  const f = await station04();
  for (const event of ["UserPromptSubmit", "SessionStart", "SubagentStart"]) {
    const result = await f.hook(event);
    const reason = result.value.reason ?? result.value.stopReason ?? result.value.systemMessage;
    expect(reason).toStartWith(`NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: ${JSON.stringify(f.copy)}`);
    expect(result.stdout).not.toContain("Synthetic native instructions");
    if (event === "UserPromptSubmit") expect(result.value.decision).toBe("block");
    if (event === "SessionStart") expect(result.value.continue).toBe(false);
  }
});

test("station04 replay from an isolated cwd: a qualified-name disable delivers context without loading the skill", async () => {
  const f = await station04();
  // The station already has this version's exact-path denial; the operator adds
  // the qualified name so a subsequent version stays inert too.
  f.setConfig(`[[skills.config]]\npath = ${JSON.stringify(join(f.copy, "SKILL.md"))}\nenabled = false\n\n[[skills.config]]\nname = "sites:sites-remix"\nenabled = false\n`);
  for (const event of ["UserPromptSubmit", "SessionStart", "SubagentStart"]) {
    const result = await f.hook(event);
    expect(result.value.decision).toBeUndefined(); expect(result.value.continue).not.toBe(false);
    expect(result.value.hookSpecificOutput.hookEventName).toBe(event);
    expect(result.value.hookSpecificOutput.additionalContext).toContain("Verified fixture context");
    expect(result.stdout).not.toContain("Synthetic native instructions");
    // The appended vendor rule changed the automatic configuration witness; it is
    // tolerated as a vendor refresh entry and named, never silently adopted.
    expect(result.value.systemMessage).toStartWith("Skills warning: 1 recorded Codex discovery witness changed only by a vendor plugin refresh (vendor configuration entries) and was not blocked: ");
  }
  // The exact-path disable already present on station04 works the same way.
  f.setConfig(`[[skills.config]]\npath = ${JSON.stringify(join(f.copy, "SKILL.md"))}\nenabled = false\n`);
  const byPath = await f.hook();
  expect(byPath.value.decision).toBeUndefined();
  expect(byPath.value.hookSpecificOutput.additionalContext).toContain("Verified fixture context");
  expect(byPath.stdout).not.toContain("Synthetic native instructions");
  // A whole-plugin table alone never retires a remote vendor copy: remote state
  // can enable a locally disabled remote plugin. The copy still blocks.
  f.setConfig(`[plugins."sites@openai-curated-remote"]\nenabled = false\n`);
  const byPlugin = await f.hook();
  expect(byPlugin.value.decision).toBe("block");
  expect(byPlugin.value.reason).toStartWith(`NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: ${JSON.stringify(f.copy)}`);
  expect(byPlugin.value.hookSpecificOutput).toBeUndefined();
  expect(byPlugin.stdout).not.toContain("Synthetic native instructions");
  // A later enabling rule brings the block back.
  f.setConfig(`[[skills.config]]\nname = "sites:sites-remix"\nenabled = false\n\n[[skills.config]]\nname = "sites:sites-remix"\nenabled = true\n`);
  expect((await f.hook()).value.decision).toBe("block");
});

test("a disabled vendor skill beside a user copy, or under a non-OpenAI marketplace, still blocks; Claude is unchanged", async () => {
  const f = await station04();
  f.setConfig(`[[skills.config]]\nname = "sites:sites-remix"\nenabled = false\n`);
  put(join(f.home, ".agents", "skills", "user-copy", "SKILL.md"), payload("user-copy"));
  const blocked = await f.hook();
  expect(blocked.value.decision).toBe("block");
  expect(blocked.value.reason).toStartWith(`NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: ${JSON.stringify(join(f.home, ".agents", "skills", "user-copy"))}`);
  const g = await station04();
  const acme = join(g.home, ".codex", "plugins", "cache", "acme", "sites", "1.0.0");
  put(join(acme, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "1.0.0" }));
  put(join(acme, "skills", "sites-remix", "SKILL.md"), payload("sites-remix"));
  g.setConfig(`[[skills.config]]\nname = "sites:sites-remix"\nenabled = false\n`);
  const lookalike = await g.hook();
  expect(lookalike.value.decision).toBe("block");
  expect(lookalike.value.reason).toContain(JSON.stringify(join(acme, "skills", "sites-remix")));
  const claude = await g.hook("UserPromptSubmit", "claude");
  expect(claude.value.systemMessage).toBeUndefined();
  expect(claude.value).toEqual({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: expect.stringContaining("Verified fixture context") } });
});

test("an optional delivery failure keeps both the unavailable notice and the vendor-refresh warning visible", async () => {
  const f = await station04();
  f.setConfig(`[[skills.config]]\nname = "sites:sites-remix"\nenabled = false\n`);
  const result = await f.hook("UserPromptSubmit", "codex", { SKILLS_TEST_CHILD_STDOUT: JSON.stringify({ error: { code: "SKILLS_API_UNAVAILABLE" } }) });
  expect(result.value.decision).toBeUndefined();
  expect(result.value.systemMessage).toContain("[SKILLS_API_UNAVAILABLE]");
  expect(result.value.systemMessage).toContain("changed only by a vendor plugin refresh");
});
