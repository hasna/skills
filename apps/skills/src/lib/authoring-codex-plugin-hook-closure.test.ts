import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assertPortableAuthoringPath } from "./authoring-path.js";
import { resolveAgentDiscovery } from "./agent-discovery.js";
import { scaffoldPortableSkill } from "./portable-skills.js";
import { prepareSkill } from "./prepare-skill.js";

// HC-01329: after the MCP and [agents] adapters, `skills prepare` stopped on
// Codex plugin hooks. Measured on 04.11: the retained review pins the
// hasna-codex hook files in Codex's installed copy (plugins/cache) while
// authoring exclusion reads the marketplace source; a stale witness of an
// unrelated plugin failed the whole review; chrome@openai-bundled declares its
// hooks inline in its manifest. This fixture is the hasna-codex layout with
// synthetic values. The runner confines TMPDIR and HOME to a credential-free
// sandbox; fixtures are left for evidence.
const sha = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
function put(path: string, text: string): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }

type Options = { inline?: unknown; command?: boolean; noServer?: boolean; urlServer?: boolean; review?: (paths: Paths) => string[] };
type Paths = ReturnType<typeof layout>;
function layout(home: string) {
  const market = join(home, "bridge/runtime/0.1.11/package/plugin"), root = join(market, "plugins/hasna-codex");
  const copy = join(home, ".codex/plugins/cache/hasna-internal-bridge/hasna-codex/0.1.0");
  return {
    home, market, root, copy,
    config: join(home, ".codex/config.toml"), catalog: join(market, ".agents/plugins/marketplace.json"),
    executable: join(home, "bridge/runtime/0.1.11/package/bin/codex-hasna.mjs"),
    sourceManifest: join(root, ".codex-plugin/plugin.json"), sourceHooks: join(root, "hooks/hooks.json"),
    copyManifest: join(copy, ".codex-plugin/plugin.json"), copyHooks: join(copy, "hooks/hooks.json"),
    otherPlugin: join(home, ".codex/plugins/cache/openai-curated-remote/sites/1.1.2/.codex-plugin/plugin.json"),
    userHooks: join(home, ".codex/hooks.json"),
  };
}
// Like station04 and station08: the review pins the installed copy, the
// catalog, an unrelated plugin's copy and the user hook file, not the runtime.
const installedCopyReview = (p: Paths): string[] => [p.config, p.copyManifest, p.copyHooks, p.catalog, p.otherPlugin, p.userHooks];
// Like station16: the review pins the marketplace source and the runtime.
const sourceReview = (p: Paths): string[] => [p.config, p.sourceManifest, p.sourceHooks, p.catalog, p.executable, p.otherPlugin, p.userHooks];

function station(options: Options = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "authoring-codex-hook-closure-")));
  const p = layout(home);
  const claudeConfig = join(home, ".claude/settings.json"); put(claudeConfig, "{}");
  const claude = resolveAgentDiscovery({ home, agent: "claude" });
  claude.method = "reviewed"; claude.sources[0] = { path: claudeConfig, sha256: sha("{}") };
  put(p.executable, "// bridge runtime\n");
  put(p.catalog, JSON.stringify({ name: "hasna-internal-bridge", plugins: [{ name: "hasna-codex", source: { source: "local", path: "./plugins/hasna-codex" } }] }));
  const handler = options.command ? { type: "command", command: "bun hook.js" } : { type: "mcp_tool", server: "hasna-codex", tool: "activate_hook", input: { event: "${hook_event_name}" }, timeout: 30 };
  // The measured hasna-codex hooks.json carries a top-level description.
  const declaration = { description: "Bridge hooks", hooks: { SessionStart: [{ hooks: [handler] }], UserPromptSubmit: [{ hooks: [handler] }] } };
  const inline = options.inline !== undefined;
  const manifest = JSON.stringify({ name: "hasna-codex", version: "0.1.0", description: "Bridge", hooks: inline ? options.inline : "./hooks/hooks.json" });
  put(p.sourceManifest, manifest); put(p.copyManifest, manifest);
  if (!inline) { put(p.sourceHooks, JSON.stringify(declaration)); put(p.copyHooks, JSON.stringify(declaration)); }
  put(p.otherPlugin, '{"name":"sites","version":"1.1.2"}');
  put(p.userHooks, '{"hooks":{}}');
  const server = options.noServer ? "" : options.urlServer ? '[mcp_servers.hasna-codex]\nurl = "https://bridge.invalid/mcp"\n'
    : `[mcp_servers.hasna-codex]\ncommand = "/usr/bin/env"\nargs = ["-i", "HOME=${home}", "${p.executable}", "--stdio"]\ncwd = "${home}"\nenabled = true\n`;
  put(p.config, `model = "synthetic"\n[marketplaces.hasna-internal-bridge]\nsource_type = "local"\nsource = "${p.market}"\n\n[plugins."hasna-codex@hasna-internal-bridge"]\nenabled = true\n\n${server}`);
  const reviewed = (options.review ?? installedCopyReview)(p).map(path => ({ path, sha256: existsSync(path) ? sha(readFileSync(path)) : null }));
  const codex = { agent: "codex" as const, method: "reviewed" as const, roots: [], sources: reviewed };
  put(join(home, ".hasna/skills/agent-policy.json"), JSON.stringify({ loading: "cli", bridge: { home, discovery: { claude, codex } } }));
  return { ...p, homeDir: home, rootDir: join(home, ".hasna/skills/authoring") };
}
const name = "hook-closure-fixture";
const allowed = (f: ReturnType<typeof station>): void => {
  expect(() => assertPortableAuthoringPath(join(f.rootDir, name), f)).not.toThrow();
  scaffoldPortableSkill(name, { ...f, kind: "instruction" });
  expect(prepareSkill(name, { ...f, version: "0.1.1", dryRun: true }).written).toBe(false);
  // The plugin's own roots stay excluded.
  for (const path of [join(f.root, "skills", name), join(f.root, name), join(f.copy, name)]) {
    expect(() => assertPortableAuthoringPath(path, f)).toThrow("native discovery root");
  }
};
const refused = (f: ReturnType<typeof station>, message: string): void => {
  expect(() => assertPortableAuthoringPath(join(f.rootDir, name), f)).toThrow(message);
  expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow(message);
  expect(existsSync(join(f.rootDir, name))).toBe(false);
};

test("(a) a review of the installed copy covers byte-identical marketplace source hook files", () => {
  allowed(station());
});

test("(a) a different source file, another plugin's copy or a moved file is not the reviewed content", () => {
  const changed = station();
  put(changed.sourceHooks, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "mcp_tool", server: "hasna-codex", tool: "other_tool" }] }] } }));
  refused(changed, "plugin hooks require current independently reviewed sources");
  // Identical bytes reviewed under another plugin identity, or at another
  // relative path of the right installed copy.
  for (const elsewhere of [(p: Paths) => join(p.home, ".codex/plugins/cache/other-market/hasna-codex/0.1.0/hooks/hooks.json"), (p: Paths) => join(p.copy, ".codex-plugin/hooks.json")]) {
    const f = station({ review: p => [p.config, elsewhere(p), p.copyManifest, p.catalog, p.userHooks] });
    put(elsewhere(f), readFileSync(f.sourceHooks, "utf8"));
    const policy = join(f.home, ".hasna/skills/agent-policy.json"), value = JSON.parse(readFileSync(policy, "utf8"));
    value.bridge.discovery.codex.sources[1].sha256 = sha(readFileSync(f.sourceHooks));
    writeFileSync(policy, JSON.stringify(value));
    refused(f, "plugin hooks require current independently reviewed sources");
  }
});

test("(b) a stale witness of an unrelated plugin no longer blocks this plugin's hooks", () => {
  for (const review of [installedCopyReview, sourceReview]) {
    const f = station({ review });
    put(f.otherPlugin, '{"name":"sites","version":"1.1.3"}');
    allowed(f);
  }
});

test("(b) this plugin's own evidence, its runtime and the user hook file must still verify", () => {
  const cases: Array<[ReturnType<typeof station>, (f: ReturnType<typeof station>) => string]> = [
    [station({ review: sourceReview }), f => f.executable],
    [station(), f => f.userHooks],
    [station(), f => f.catalog],
    [station(), f => f.copyHooks],
  ];
  for (const [f, path] of cases) {
    put(path(f), `${readFileSync(path(f), "utf8")}\n`);
    refused(f, "Native discovery input changed");
  }
});

test("(b) declarations alone are not a closure", () => {
  refused(station({ review: p => [p.config, p.copyManifest, p.copyHooks] }), "opaque executable dependency closure is unavailable");
});

test("(b) command handlers keep the whole-review check", () => {
  const f = station({ command: true, review: sourceReview });
  put(f.otherPlugin, '{"name":"sites","version":"1.1.3"}');
  refused(f, "Native discovery input changed");
});

test("(b) a hook server must be a configured local stdio MCP server", () => {
  refused(station({ noServer: true }), "plugin hook MCP server is not a configured local stdio server");
  refused(station({ urlServer: true }), 'unknown discovery controls have no root-exclusion adapter for "mcp_servers"');
});

test("(c) inline manifest hooks are read and verified like a hook file", () => {
  const cleanup = { hooks: { Stop: [{ hooks: [{ type: "mcp_tool", server: "hasna-codex", tool: "turn_ended", input: { hook_event_name: "${hook_event_name}" } }] }] } };
  allowed(station({ inline: cleanup }));
  const stale = station({ inline: cleanup });
  put(stale.sourceManifest, readFileSync(stale.sourceManifest, "utf8").replace("Bridge", "Bridge 2"));
  refused(stale, "plugin hooks require current independently reviewed sources");
  for (const inline of [
    { hooks: { Stop: [{ hooks: [{ type: "prompt", text: "inject" }] }] } },
    { hooks: { Unknown: [{ hooks: [{ type: "mcp_tool", server: "hasna-codex", tool: "turn_ended" }] }] } },
    { hooks: { Stop: [{ hooks: [{ type: "mcp_tool", server: "hasna-codex", tool: "turn_ended", extra: true }] }] } },
    { Stop: [] },
    { description: 1, hooks: {} },
    { hooks: {}, name: "extra" },
  ]) refused(station({ inline }), "unsupported inline plugin hooks");
  refused(station({ inline: [cleanup] }), "unsupported plugin hooks target");
  const commandInline = station({ inline: { hooks: { Stop: [{ hooks: [{ type: "command", command: "bun hook.js" }] }] } } });
  put(commandInline.otherPlugin, '{"name":"sites","version":"1.1.3"}');
  refused(commandInline, "Native discovery input changed");
});

test("native admission is unchanged: a hooked Codex plugin still needs an explicit review", () => {
  const f = station();
  expect(() => resolveAgentDiscovery({ home: f.home, agent: "codex", executable: null })).toThrow("plugin hooks require a separate no-skill-injection review");
});
