import { installSumiPathsFixture } from "../lib/sumi-paths.fixture.js";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
import { admitCorpusFixture, corpusInspectorPathFixture } from "../lib/codex-corpus.fixture.js";
import { captureClaudeSettingsV4 } from "../lib/claude-settings-witness.js";
import { captureCodexSettingsV4 } from "../lib/codex-settings-witness.js";

// Owner request 2026-10-20: ordinary use (switching model, "always allow",
// Codex rewriting config.toml on a model change or folder trust) must never
// block a prompt, and a real discovery change (a new hook or plugin) must be
// reported without stopping the agent. These run the real registered hook
// command across a real subprocess boundary in a synthetic home; only the
// context/sync child response is synthetic.
useDefaultTestTimeout();
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "skills-drift-nonblocking-")));
const entry = join(scratch, "entry.ts"), binary = join(scratch, "skills.js");
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

const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const delivered = { SKILLS_TEST_CHILD_EXIT: "0", SKILLS_TEST_CHILD_STDOUT: JSON.stringify({ context: "Verified fixture context" }) };

async function home() {
  const root = mkdtempSync(join(scratch, "home-")), data = join(root, ".hasna", "skills");
  mkdirSync(data, { recursive: true });
  admitCorpusFixture(join(root, ".codex"));
  const env = { PATH: `${installSumiPathsFixture(root)}:${corpusInspectorPathFixture()}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: root, USERPROFILE: root, HASNA_HOME: join(root, ".hasna"), HASNA_SKILLS_DIR: data, NO_COLOR: "1", TMPDIR: scratch };
  const run = async (args: string[], childEnv: Record<string, string> = {}, input: unknown = {}, cwd = root) => {
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, ...args], { cwd, env: { ...env, ...childEnv }, stdin: new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, status };
  };
  const cwd = mkdtempSync(join(scratch, "isolated-cwd-"));
  return { root, data, run, cwd };
}

/** A station's reviewed Claude binding: a typed claude-settings-v4 witness of
 * ~/.claude/settings.json, as the fleet's discovery reviews recorded it. */
async function claudeStation() {
  const h = await home();
  const installed = await h.run(["hook", "install", "--agent", "claude", "--selection-profile", "engineering", "--command", binary, "--apply", "--json"]);
  expect([installed.status, installed.stderr]).toEqual([0, ""]);
  const settings = join(h.root, ".claude", "settings.json");
  const user = { ...JSON.parse(readFileSync(settings, "utf8")), model: "opus", effortLevel: "high", statusLine: { type: "command", command: "/opt/status/line" } };
  user.permissions.allow = [...user.permissions.allow, "Bash(npm run lint)"];
  writeFileSync(settings, JSON.stringify(user, null, 2));
  const policy = JSON.parse(readFileSync(join(h.data, "agent-policy.json"), "utf8"));
  const binding = policy.bridge.discovery.claude;
  const review = join(scratch, `review-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(review, JSON.stringify({ version: 1, agents: [{ agent: "claude", roots: binding.roots, sources: binding.sources.map((source: any) => source.path === settings ? captureClaudeSettingsV4(settings) : source), pluginHooks: "reviewed-no-skill-injection" }] }));
  const reviewed = await h.run(["hook", "install", "--agent", "claude", "--selection-profile", "engineering", "--command", binary, "--discovery-inputs", review, "--apply", "--json"]);
  expect([reviewed.status, reviewed.stderr]).toEqual([0, ""]);
  const witness = () => JSON.parse(readFileSync(join(h.data, "agent-policy.json"), "utf8")).bridge.discovery.claude.sources.find((source: any) => source.path === settings && source.format === undefined);
  expect(witness().hashMode).toBe("claude-settings-v4");
  const hook = async (event = "UserPromptSubmit", input: Record<string, unknown> = {}) => {
    const result = await h.run(["hook", "user-prompt", "--agent", "claude", "--selection-profile", "engineering", "--event", event], delivered, { hook_event_name: event, prompt: "test request", cwd: h.cwd, ...input }, h.cwd);
    expect([result.status, result.stderr]).toEqual([0, ""]);
    return { value: JSON.parse(result.stdout), stdout: result.stdout };
  };
  const reviewedSettings = JSON.parse(readFileSync(settings, "utf8"));
  const edit = (mutate: (value: any) => void) => { const next = structuredClone(reviewedSettings); mutate(next); writeFileSync(settings, JSON.stringify(next, null, 2)); };
  const receipt = () => { const path = join(h.data, "native-drift", "claude.json"); return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null; };
  return { ...h, settings, reviewedSettings, witness, hook, edit, receipt };
}

function expectDelivered(value: any, event = "UserPromptSubmit") {
  expect(value.decision).toBeUndefined();
  expect(value.continue).not.toBe(false);
  expect(value.systemMessage).toBeUndefined();
  expect(value.hookSpecificOutput.hookEventName).toBe(event);
  expect(value.hookSpecificOutput.additionalContext).toContain("Verified fixture context");
}

/** Drift is reported, never blocking, and never passed off as healthy. */
function expectReportedNotBlocked(value: any, stdout: string, path: string) {
  expect(value.decision).toBeUndefined();
  expect(value.continue).not.toBe(false);
  expect(value.stopReason).toBeUndefined();
  expect(value.systemMessage).toStartWith("Skills warning: native discovery changed; this prompt was not blocked and Skills context was omitted.");
  expect(value.systemMessage).toContain(path);
  expect(value.systemMessage).toContain("skills hook install");
  expect(stdout).not.toContain("Verified fixture context");
}

test("null control: an unchanged reviewed Claude station delivers context with no warning", async () => {
  const s = await claudeStation();
  for (const event of ["UserPromptSubmit", "SessionStart", "SubagentStart"]) expectDelivered((await s.hook(event)).value, event);
  expect(s.receipt()).toBeNull();
});

test("switching the Claude model to a custom or current model is not drift", async () => {
  const s = await claudeStation();
  expectDelivered((await s.hook()).value);
  for (const model of ["deepseek-flash", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]) {
    s.edit(value => { value.model = model; value.modelSettings = { [model]: { effortLevel: "xhigh", maxEffortLevel: "xhigh" } }; });
    for (const event of ["UserPromptSubmit", "SessionStart", "SubagentStart"]) expectDelivered((await s.hook(event)).value, event);
  }
  expect(s.receipt()).toBeNull();
  // The stored review was not silently rewritten.
  expect(s.witness().hashMode).toBe("claude-settings-v4");
});

test("ordinary Claude use (always allow, status line, env, theme, view) is not drift", async () => {
  const s = await claudeStation();
  expectDelivered((await s.hook()).value);
  s.edit(value => {
    value.permissions.allow.push("Bash(npm test)", "WebFetch(domain:example.com)");
    value.permissions.defaultMode = "acceptEdits";
    value.statusLine = { type: "command", command: "/opt/other/status" };
    value.env = { ...(value.env ?? {}), EXAMPLE_FLAG: "2" };
    value.theme = "custom:dracula";
    value.tui = "fullscreen";
    value.futurePreference = { anything: true };
  });
  expectDelivered((await s.hook()).value);
  expect(s.receipt()).toBeNull();
});

test("a new non-Skills Claude hook is detected and reported, but the prompt is not blocked", async () => {
  const s = await claudeStation();
  expectDelivered((await s.hook()).value);
  s.edit(value => { value.hooks.PostToolUse = [...(value.hooks.PostToolUse ?? []), { matcher: "*", hooks: [{ type: "command", command: "/opt/foreign/post-tool" }] }]; });
  for (const event of ["UserPromptSubmit", "SessionStart", "SubagentStart"]) {
    const result = await s.hook(event);
    expectReportedNotBlocked(result.value, result.stdout, s.settings);
  }
  const receipt = s.receipt();
  expect(receipt).toMatchObject({ schema: "hasna.skills.native-drift-receipt.v1", agent: "claude", status: "active", code: "NATIVE_SKILL_DRIFT", promptBlocked: false, skillsContext: "omitted" });
  expect(receipt.reason).toContain(s.settings);
  expect(receipt.occurrences).toBeGreaterThanOrEqual(3);
  // Restoring the reviewed settings clears the receipt and delivers context again.
  writeFileSync(s.settings, JSON.stringify(s.reviewedSettings, null, 2));
  expectDelivered((await s.hook()).value);
  expect(s.receipt()).toMatchObject({ status: "cleared" });
});

test("a newly enabled Claude plugin is detected and reported, but the prompt is not blocked", async () => {
  const s = await claudeStation();
  expectDelivered((await s.hook()).value);
  s.edit(value => { value.enabledPlugins = { ...(value.enabledPlugins ?? {}), "foreign@market": true }; });
  const result = await s.hook();
  expectReportedNotBlocked(result.value, result.stdout, s.settings);
  expect(s.receipt()).toMatchObject({ agent: "claude", status: "active" });
});

test("a Claude Skill tool call keeps its policy under drift: the bridge proceeds, payload skills stay denied", async () => {
  const s = await claudeStation();
  s.edit(value => { value.hooks.PostToolUse = [{ hooks: [{ type: "command", command: "/opt/foreign/post-tool" }] }]; });
  const bridge = await s.hook("PreToolUse", { tool_name: "Skill", tool_input: { skill: "skills-cli" } });
  expect(bridge.value.hookSpecificOutput?.permissionDecision).not.toBe("deny");
  expect(bridge.value.systemMessage).toStartWith("Skills warning: native discovery changed");
  const payload = await s.hook("PreToolUse", { tool_name: "Skill", tool_input: { skill: "some-payload-skill" } });
  expect(payload.value.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(payload.value.hookSpecificOutput.permissionDecisionReason).toContain("invoke only skills-cli");
});

test("a fresh claude-settings-v5 review is accepted and ignores model and permission changes", async () => {
  const s = await claudeStation();
  const witness = await s.run(["hook", "witness", "--kind", "claude-settings-v5", "--path", s.settings, "--json"]);
  expect([witness.status, witness.stderr]).toEqual([0, ""]);
  expect(JSON.parse(witness.stdout)).toMatchObject({ path: s.settings, hashMode: "claude-settings-v5" });
  const policy = JSON.parse(readFileSync(join(s.data, "agent-policy.json"), "utf8")).bridge.discovery.claude;
  const review = join(scratch, `review-v5-${Math.random().toString(36).slice(2)}.json`);
  // An explicit review binds full source files: the typed v5 witness replaces
  // every witness of settings.json, including the automatic field projection.
  writeFileSync(review, JSON.stringify({ version: 1, agents: [{ agent: "claude", roots: policy.roots, sources: [...policy.sources.filter((source: any) => source.path !== s.settings), JSON.parse(witness.stdout)], pluginHooks: "reviewed-no-skill-injection" }] }));
  const installed = await s.run(["hook", "install", "--agent", "claude", "--selection-profile", "engineering", "--command", binary, "--discovery-inputs", review, "--apply", "--json"]);
  expect([installed.status, installed.stderr]).toEqual([0, ""]);
  expect(s.witness().hashMode).toBe("claude-settings-v5");
  s.edit(value => { value.model = "deepseek-flash"; value.permissions.allow.push("Bash(git status)"); });
  expectDelivered((await s.hook()).value);
  s.edit(value => { value.hooks.Stop = [...(value.hooks.Stop ?? []), { hooks: [{ type: "command", command: "/opt/foreign/stop" }] }]; });
  const drift = await s.hook();
  expectReportedNotBlocked(drift.value, drift.stdout, s.settings);
});

/** A station's reviewed Codex binding (typed codex-settings-v4 witness). */
async function codexStation() {
  const h = await home();
  const config = join(h.root, ".codex", "config.toml");
  put(config, `model = "gpt-5.1"\nmodel_reasoning_effort = "high"\n`);
  const review = join(scratch, `review-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(review, JSON.stringify({ version: 1, agents: [{ agent: "codex", roots: [], sources: [captureCodexSettingsV4(config)], pluginHooks: "reviewed-no-skill-injection" }] }));
  const installed = await h.run(["hook", "install", "--agent", "codex", "--selection-profile", "engineering", "--command", binary, "--discovery-inputs", review, "--apply", "--json"]);
  expect([installed.status, installed.stderr]).toEqual([0, ""]);
  const reviewedText = readFileSync(config, "utf8");
  const hook = async (event = "UserPromptSubmit") => {
    const result = await h.run(["hook", "user-prompt", "--agent", "codex", "--selection-profile", "engineering", "--event", event], delivered, { hook_event_name: event, prompt: "test request", cwd: h.cwd }, h.cwd);
    expect([result.status, result.stderr]).toEqual([0, ""]);
    return { value: JSON.parse(result.stdout), stdout: result.stdout };
  };
  const receipt = () => { const path = join(h.data, "native-drift", "codex.json"); return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null; };
  const append = (text: string) => writeFileSync(config, `${reviewedText.trimEnd()}\n\n${text}`);
  return { ...h, config, reviewedText, hook, receipt, append };
}

test("null control: an unchanged reviewed Codex station delivers context with no warning", async () => {
  const s = await codexStation();
  for (const event of ["UserPromptSubmit", "SessionStart"]) expectDelivered((await s.hook(event)).value, event);
  expect(s.receipt()).toBeNull();
});

test("Codex rewriting config.toml on a model change and a folder trust is not drift", async () => {
  const s = await codexStation();
  expectDelivered((await s.hook()).value);
  // Root keys go first: appended after the installer's last table they would
  // belong to that table instead.
  writeFileSync(s.config, `service_tier = "fast"
notify = ["/opt/notify/bin"]
${s.reviewedText.replace('model = "gpt-5.1"', 'model = "gpt-5.2-codex"').replace('model_reasoning_effort = "high"', 'model_reasoning_effort = "xhigh"').trimEnd()}

[notice]
hide_full_access_warning = true

[notice.model_migrations]
"gpt-5.1" = "gpt-5.2-codex"

[projects."/Users/someone/repo"]
trust_level = "trusted"

[tui]
status_line = ["model", "context-remaining"]
`);
  for (const event of ["UserPromptSubmit", "SessionStart"]) expectDelivered((await s.hook(event)).value, event);
  expect(s.receipt()).toBeNull();
});

test("a new Codex hook or plugin is detected and reported, but the prompt is not blocked", async () => {
  const s = await codexStation();
  expectDelivered((await s.hook()).value);
  s.append(`[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "/opt/foreign/stop-hook"\n`);
  for (const event of ["UserPromptSubmit", "SessionStart"]) {
    const result = await s.hook(event);
    expectReportedNotBlocked(result.value, result.stdout, s.config);
  }
  expect(s.receipt()).toMatchObject({ agent: "codex", status: "active", promptBlocked: false });
  s.append(`[plugins."foreign@market"]\nenabled = true\n`);
  const plugin = await s.hook();
  expectReportedNotBlocked(plugin.value, plugin.stdout, s.config);
});
