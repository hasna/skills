import { installSumiPathsFixture } from "../lib/sumi-paths.fixture.js";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

async function fixture() {
  const home = mkdtempSync(join(scratch, "home-")), data = join(home, ".hasna", "skills");
  mkdirSync(data, { recursive: true });
  admitCorpusFixture(join(home, ".codex"));
  const env = { PATH: `${installSumiPathsFixture(home)}:${corpusInspectorPathFixture()}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: data, NO_COLOR: "1", TMPDIR: scratch };
  async function run(args: string[], childEnv: Record<string, string> = {}, input: unknown = {}) {
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, ...args], { cwd: home, env: { ...env, ...childEnv }, stdin: new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(status).toBe(0); expect(stderr).toBe("");
    return { value: JSON.parse(stdout), stdout };
  }
  await run(["hook", "install", "--agent", "all", "--selection-profile", "engineering", "--command", binary, "--apply", "--json"]);
  /** Materialize a plugin version the way Codex's remote plugin refresh does. */
  const vendor = (marketplace = "openai-curated-remote", plugin = "sites", version = "1.0.2-remix-b.1", skill = "sites-remix") => {
    const parent = join(home, ".codex", "plugins", "cache", marketplace, plugin), path = join(parent, version, "skills", skill);
    put(join(parent, version, ".codex-plugin", "plugin.json"), JSON.stringify({ name: plugin, version, description: "Synthetic plugin" }));
    put(join(parent, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: `plugins~Plugin_${plugin.padEnd(32, "0")}` }));
    put(join(path, "SKILL.md"), payload(skill));
    return path;
  };
  return { home, run, vendor, hook: (childEnv: Record<string, string>, event = "UserPromptSubmit", agent = "codex") => run(["hook", "user-prompt", "--agent", agent, "--selection-profile", "engineering", "--event", event], childEnv, { hook_event_name: event, prompt: "test request", cwd: home }) };
}

test("vendor plugin-cache drift warns visibly and Codex context delivery continues on every lifecycle event", async () => {
  const f = await fixture();
  const clean = await f.hook(delivered);
  expect(clean.value.systemMessage).toBeUndefined();
  expect(clean.value.hookSpecificOutput.additionalContext).toContain("Verified fixture context");
  const copy = f.vendor();
  for (const event of ["UserPromptSubmit", "SessionStart", "SubagentStart"]) {
    const result = await f.hook(delivered, event);
    expect(result.value.decision).toBeUndefined(); expect(result.value.continue).not.toBe(false);
    expect(result.value.systemMessage).toStartWith("Skills warning: 1 vendor Codex plugin skill copy was found in the plugin cache and was not blocked: ");
    expect(result.value.systemMessage).toContain(JSON.stringify(copy));
    expect(result.value.systemMessage).toContain("--include-vendor");
    expect(result.value.systemMessage).toContain("[[skills.config]]");
    expect(result.value.hookSpecificOutput.hookEventName).toBe(event);
    expect(result.value.hookSpecificOutput.additionalContext).toContain("Verified fixture context");
    // Paths only: the vendor payload never reaches hook output.
    expect(result.stdout).not.toContain("Synthetic native instructions");
  }
});

test("an optional delivery failure keeps both the unavailable notice and the vendor warning visible", async () => {
  const f = await fixture();
  f.vendor();
  const result = await f.hook({ SKILLS_TEST_CHILD_STDOUT: JSON.stringify({ error: { code: "SKILLS_API_UNAVAILABLE" } }) });
  expect(result.value.decision).toBeUndefined();
  expect(result.value.systemMessage).toContain("[SKILLS_API_UNAVAILABLE]");
  expect(result.value.systemMessage).toContain("Skills warning: 1 vendor Codex plugin skill copy");
});

test("vendor drift beside a user copy or under a Hasna marketplace still blocks the Codex prompt", async () => {
  const user = await fixture();
  user.vendor();
  put(join(user.home, ".codex", "skills", "user-copy", "SKILL.md"), payload("user-copy"));
  const blocked = await user.hook(delivered);
  expect(blocked.value.decision).toBe("block");
  expect(blocked.value.reason).toStartWith("NATIVE_SKILL_DRIFT: 2 unexpected native skill copies were found: ");
  expect(blocked.value.systemMessage).toBeUndefined();
  const started = await user.hook(delivered, "SessionStart");
  expect(started.value.continue).toBe(false);
  expect(started.value.stopReason).toStartWith("NATIVE_SKILL_DRIFT: 2 unexpected native skill copies were found: ");
  const hasna = await fixture();
  hasna.vendor("hasna-skills", "payload", "1.0.0", "payload");
  const refused = await hasna.hook(delivered);
  expect(refused.value.decision).toBe("block");
  expect(refused.value.reason).toStartWith("NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: ");
});

test("other agents' hook output is unchanged when the Codex plugin cache holds vendor copies", async () => {
  const f = await fixture();
  f.vendor();
  const claude = await f.hook(delivered, "UserPromptSubmit", "claude");
  expect(claude.value.systemMessage).toBeUndefined();
  expect(claude.value).toEqual({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: expect.stringContaining("Verified fixture context") } });
});

test("a changed Codex discovery source warns and still delivers context; beside a non-vendor copy it blocks", async () => {
  const f = await fixture();
  const config = join(f.home, ".codex", "config.toml");
  writeFileSync(config, `${readFileSync(config, "utf8")}\n[plugins."other@probe"]\nenabled = false\n`);
  for (const event of ["UserPromptSubmit", "SessionStart", "SubagentStart"]) {
    const result = await f.hook(delivered, event);
    expect(result.value.decision).toBeUndefined(); expect(result.value.continue).not.toBe(false);
    expect(result.value.systemMessage).toStartWith("Skills warning: 1 reviewed Codex discovery witness changed (source file) and was not blocked: ");
    expect(result.value.systemMessage).toContain(JSON.stringify(realpathSync(config)));
    expect(result.value.hookSpecificOutput.additionalContext).toContain("Verified fixture context");
  }
  // Both drift classes together produce one warning line each.
  f.vendor();
  const both = await f.hook(delivered);
  expect(both.value.systemMessage.split("\n")).toHaveLength(2);
  expect(both.value.hookSpecificOutput.additionalContext).toContain("Verified fixture context");
  // A non-vendor copy still blocks, whatever else drifted.
  put(join(f.home, ".agents", "skills", "user-copy", "SKILL.md"), payload("user-copy"));
  const blocked = await f.hook(delivered);
  expect(blocked.value.decision).toBe("block");
  expect(blocked.value.reason).toStartWith("NATIVE_SKILL_DRIFT: 2 unexpected native skill copies were found: ");
  // The Claude hook does not read the Codex configuration and is unchanged.
  const claude = await f.hook(delivered, "UserPromptSubmit", "claude");
  expect(claude.value.systemMessage).toBeUndefined();
});
