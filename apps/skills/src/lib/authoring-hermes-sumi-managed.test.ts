import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assertPortableAuthoringPath } from "./authoring-path.js";
import { resolveAgentDiscovery } from "./agent-discovery.js";
import { scaffoldPortableSkill } from "./portable-skills.js";
import { prepareSkill } from "./prepare-skill.js";

// HC-01329: with the Codex, Gemini, Cursor and OpenCode cases resolved,
// station06 and 07 stopped at "hermes: unsupported Hermes skills controls"
// (skills.creation_nudge_interval), station08 at "hermes: non-enumerable hooks
// require a current settings review" (the managed supervisor hooks), and all
// three then at "sumi: external or foreign local plugins require review" for
// single-file local plugins their reviewed Sumi binding pins (measured 04.11,
// read-only). Commands and specifiers below are literal strings. The runner
// confines TMPDIR and HOME to a credential-free sandbox; fixtures are left.
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
function put(path: string, text: string): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
const name = "hermes-sumi-fixture";
function base(prefix: string) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const claudeConfig = join(home, ".claude/settings.json"); put(claudeConfig, "{}");
  const claude = resolveAgentDiscovery({ home, agent: "claude" });
  claude.method = "reviewed"; claude.sources[0] = { path: claudeConfig, sha256: sha("{}") };
  return { home, claude, homeDir: home, rootDir: join(home, ".hasna/skills/authoring") };
}
const allowed = (f: { home: string; homeDir: string; rootDir: string }): void => {
  expect(() => assertPortableAuthoringPath(join(f.rootDir, name), f)).not.toThrow();
  scaffoldPortableSkill(name, { ...f, kind: "instruction" });
  expect(prepareSkill(name, { ...f, version: "0.1.1", dryRun: true }).written).toBe(false);
};
const refused = (f: { home: string; homeDir: string; rootDir: string }, message: string): void => {
  expect(() => assertPortableAuthoringPath(join(f.rootDir, name), f)).toThrow(message);
  expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow(message);
  expect(existsSync(join(f.rootDir, name))).toBe(false);
};

// ---- Hermes ----
type HermesOptions = { skills?: unknown; hooks?: (s: Supervisor) => unknown; supervisor?: (s: Supervisor) => unknown; changeSupervisor?: boolean };
type Supervisor = { path: string; runtime: string };
const managedHermes = (s: Supervisor) => ({
  pre_llm_call: [{ command: `'${s.runtime}' '${s.path}' --event pre_llm_call`, timeout: 15 }],
  pre_tool_call: [{ command: `'${s.runtime}' '${s.path}' --event pre_tool_call`, timeout: 15, fail_closed: true }],
});
function hermes(options: HermesOptions = {}) {
  const f = base("authoring-hermes-managed-");
  const s = { path: join(f.home, ".hasna/skills/agent-hooks/hermes.js"), runtime: join(f.home, ".bun/bin/bun") };
  put(s.path, "// managed Hermes supervisor\n");
  const config: Record<string, unknown> = { hooks: (options.hooks ?? managedHermes)(s) };
  if (options.skills !== undefined) config.skills = options.skills;
  put(join(f.home, ".hermes/config.yaml"), JSON.stringify(config));
  const binding = resolveAgentDiscovery({ home: f.home, agent: "hermes", executable: null });
  const supervisor = options.supervisor ? options.supervisor(s) : { ...s, sha256: sha("// managed Hermes supervisor\n") };
  put(join(f.home, ".hasna/skills/agent-policy.json"), JSON.stringify({ loading: "cli", bridge: { home: f.home, commands: { hermes: join(f.home, ".local/bin/skills") }, profiles: { hermes: "fleet" },
    ...(supervisor === undefined ? {} : { supervisors: { hermes: supervisor } }), discovery: { claude: f.claude, hermes: binding } } }));
  if (options.changeSupervisor) put(s.path, "// changed after hook install\n");
  return f;
}
const hermesOpaque = "hermes: non-enumerable hooks require a current settings review";

test("Hermes: the managed supervisor hooks and a numeric nudge interval add nothing opaque", () => {
  allowed(hermes());
  allowed(hermes({ skills: { creation_nudge_interval: 15 } }));
  allowed(hermes({ skills: { creation_nudge_interval: 0 } }));
});

test("Hermes: any other skills value or key still refuses", () => {
  for (const value of ["15", -1, 1.5, null, [15]]) refused(hermes({ skills: { creation_nudge_interval: value } }), "hermes: malformed Hermes skills creation_nudge_interval");
  refused(hermes({ skills: { creation_nudge_interval: 15, auto_create: true } }), "hermes: unsupported Hermes skills controls");
});

test("Hermes: anything beside or instead of the supervisor entries keeps refusing", () => {
  const variants: Array<(s: Supervisor) => unknown> = [
    s => ({ ...managedHermes(s), pre_llm_call: [...managedHermes(s).pre_llm_call, { command: "/usr/bin/true", timeout: 15 }] }),
    s => ({ ...managedHermes(s), pre_llm_call: [{ command: `'/other/bun' '${s.path}' --event pre_llm_call`, timeout: 15 }] }),
    s => ({ ...managedHermes(s), pre_llm_call: [{ command: `'${s.runtime}' '/other/hermes.js' --event pre_llm_call`, timeout: 15 }] }),
    s => ({ ...managedHermes(s), pre_tool_call: [{ command: `'${s.runtime}' '${s.path}' --event pre_tool_call`, timeout: 15 }] }),
    s => ({ ...managedHermes(s), pre_llm_call: [{ command: `'${s.runtime}' '${s.path}' --event pre_llm_call`, timeout: 30 }] }),
    s => ({ ...managedHermes(s), pre_llm_call: [{ command: `'${s.runtime}' '${s.path}' --event pre_llm_call`, timeout: 15, matcher: "*" }] }),
    s => ({ ...managedHermes(s), on_session_start: [{ command: `'${s.runtime}' '${s.path}' --event on_session_start`, timeout: 15 }] }),
    s => ({ ...managedHermes(s), pre_llm_call: { command: `'${s.runtime}' '${s.path}' --event pre_llm_call`, timeout: 15 } }),
  ];
  for (const hooks of variants) refused(hermes({ hooks }), hermesOpaque);
  // The supervisor file changed after the policy recorded it, or no usable record.
  refused(hermes({ changeSupervisor: true }), hermesOpaque);
  refused(hermes({ supervisor: () => undefined }), hermesOpaque);
  refused(hermes({ supervisor: s => ({ ...s, sha256: "not-a-digest" }) }), hermesOpaque);
});

// ---- Sumi ----
let previousPath: string | undefined;
beforeEach(() => { previousPath = process.env.PATH; });
afterEach(() => { if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath; });
type SumiOptions = { plugin?: string; pin?: "exact" | "none" | "stale" | "path-bytes"; method?: "reviewed" | "automatic"; config?: Record<string, unknown>; changeAfter?: string };
const pluginText = 'import { readFileSync } from "node:fs";\nexport default async function plugin() { return { name: "redaction", size: readFileSync.length }; }\n';
function sumi(options: SumiOptions = {}) {
  const f = base("authoring-sumi-pinned-");
  const bin = join(f.home, "bin"), command = join(bin, "sumi-paths");
  put(command, `#!${process.execPath}\nconst home = process.argv[process.argv.indexOf("--home") + 1];
const cwd = process.argv[process.argv.indexOf("--cwd") + 1];
const config = home + "/.config/sumi";
console.log(JSON.stringify({ schemaVersion: 1, kind: "sumi-paths", home, cwd,
  roots: { data: home + "/sumi-data", cache: home + "/sumi-cache", config, state: home + "/sumi-state" },
  legacyRoots: { data: null, cache: null, config: null, state: null },
  configFiles: { canonical: config + "/sumi.json", legacy: null }, skillRoots: { canonical: config + "/skills", legacy: null } }));\n`);
  chmodSync(command, 0o755);
  process.env.PATH = `${bin}:${previousPath ?? ""}`;
  const configText = JSON.stringify(options.config ?? {}), configPath = join(f.home, ".config/sumi/sumi.json");
  put(configPath, configText);
  put(join(f.home, ".config/sumi/plugins/skills-cli.js"), "// Skills bridge, skipped by name\n");
  const plugin = join(f.home, ".config/sumi/plugins/redaction.ts"), text = options.plugin ?? pluginText;
  put(plugin, text);
  const pin = options.pin ?? "exact";
  const sources: Array<Record<string, unknown>> = [{ path: configPath, sha256: sha(configText) }, { path: join(f.home, ".config/sumi/sumi.jsonc"), sha256: null }];
  if (pin === "exact") sources.push({ path: plugin, sha256: sha(text) });
  if (pin === "stale") sources.push({ path: plugin, sha256: sha("an earlier reviewed version\n") });
  if (pin === "path-bytes") sources.push({ path: plugin, hashMode: "path-bytes", sha256: sha(text) });
  const binding = { agent: "sumi", method: options.method ?? "reviewed", roots: [], sources };
  put(join(f.home, ".hasna/skills/agent-policy.json"), JSON.stringify({ loading: "cli", bridge: { home: f.home, discovery: { claude: f.claude, sumi: binding } } }));
  if (options.changeAfter !== undefined) put(plugin, options.changeAfter);
  return f;
}
const sumiForeign = "sumi: external or foreign local plugins require review";

test("Sumi: a local plugin file the reviewed binding pins, loading only Node builtins, is accepted", () => {
  allowed(sumi());
  allowed(sumi({ plugin: "export const plugin = async () => ({ name: \"plain\" });\n" }));
  allowed(sumi({ plugin: 'const fs = require("node:fs");\nexport default () => fs;\n' }));
});

test("Sumi: an unpinned, stale, differently pinned or unreviewed plugin still refuses", () => {
  refused(sumi({ pin: "none" }), sumiForeign);
  refused(sumi({ pin: "stale" }), sumiForeign);
  refused(sumi({ pin: "path-bytes" }), sumiForeign);
  refused(sumi({ method: "automatic" }), sumiForeign);
  refused(sumi({ changeAfter: `${pluginText}// changed\n` }), sumiForeign);
});

test("Sumi: a pinned plugin that loads any other file still refuses", () => {
  for (const plugin of [
    'import helper from "./helper.ts";\nexport default helper;\n',
    'import { z } from "zod";\nexport default z;\n',
    'export * from "../shared.ts";\n',
    'import "./side-effect.ts";\n',
    'const m = await import("./dynamic.ts");\nexport default m;\n',
    'const spec = "node:fs";\nconst m = await import(spec);\nexport default m;\n',
    'const m = require(`node:${"fs"}`);\nexport default m;\n',
    'const m = require("lodash");\nexport default m;\n',
  ]) refused(sumi({ plugin }), sumiForeign);
});

test("Sumi: configured plugin entries still refuse, even beside a pinned local plugin", () => {
  refused(sumi({ config: { plugin: ["@scope/plugin"] } }), sumiForeign);
  refused(sumi({ config: { plugins: ["/elsewhere/plugin.ts"] } }), sumiForeign);
});
