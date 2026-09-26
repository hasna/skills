import { isAlias, parseDocument, visit } from "yaml";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { lstatSync, readFileSync, opendirSync } from "node:fs";

export interface HermesSupervisorBinding { path: string; runtime: string; sha256: string }
export const HERMES_OPT_OUT = ".no-bundled-skills";
const EVENTS = ["pre_llm_call", "pre_tool_call"] as const;
function object(value: unknown): value is Record<string, any> { return Boolean(value && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)); }
function sameEntry(actual: unknown, expected: Record<string, unknown>): boolean {
  return object(actual) && JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(Object.keys(expected).sort()) && Object.keys(expected).every(key => actual[key] === expected[key]);
}
function document(text: string | null) {
  if (text !== null && Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error("Hermes configuration exceeds its size limit");
  const doc = parseDocument(text ?? "{}\n", { uniqueKeys: true, strict: true, version: "1.1" });
  if (doc.errors.length || doc.warnings.length) throw new Error("Invalid Hermes YAML configuration");
  visit(doc, (_key, node) => { if (isAlias(node)) throw new Error("Hermes YAML aliases require separate review"); });
  if (!object(doc.toJS({ maxAliasCount: 0 }))) throw new Error("Expected Hermes configuration object");
  return doc;
}
export function parseHermesConfig(text: string | null): Record<string, any> {
  const value = document(text).toJS({ maxAliasCount: 0 });
  for (const name of ["skills", "plugins", "hooks"]) if (value[name] !== undefined && !object(value[name])) throw new Error(`Expected Hermes ${name} object`);
  return value;
}
function quoted(value: string): string {
  if (!value || /[\0\r\n]/.test(value)) throw new Error("Invalid Hermes Skills command");
  // Hermes uses Python shlex.split(...), not a shell. This is one argv token.
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
export function hermesHookDefinitions(supervisor: Pick<HermesSupervisorBinding, "path" | "runtime">): Record<typeof EVENTS[number], { command: string; timeout: number; fail_closed?: boolean }> {
  if (!isAbsolute(supervisor.runtime) || !isAbsolute(supervisor.path)) throw new Error("Expected absolute Hermes supervisor paths");
  const entry = (event: typeof EVENTS[number]) => ({ command: `${quoted(supervisor.runtime)} ${quoted(supervisor.path)} --event ${event}`, timeout: 15, ...(event === "pre_tool_call" ? { fail_closed: true } : {}) });
  return { pre_llm_call: entry("pre_llm_call"), pre_tool_call: entry("pre_tool_call") };
}
export function configureHermesHooks(text: string | null, supervisor: HermesSupervisorBinding, previous?: HermesSupervisorBinding): string {
  const config = parseHermesConfig(text), doc = document(text), required = hermesHookDefinitions(supervisor);
  // YAML1.1 setIn would otherwise synthesize an !!omap for a missing parent.
  // Hermes safe_load expects an ordinary mapping for hooks.
  if (config.hooks === undefined) doc.set("hooks", doc.createNode({}));
  const prior = previous ? hermesHookDefinitions(previous) : required;
  for (const event of EVENTS) {
    const entries = config.hooks?.[event] ?? [];
    if (!Array.isArray(entries)) throw new Error(`Expected Hermes ${event} hooks array`);
    const retained = entries.filter((entry: unknown) => {
      if (!object(entry) || typeof entry.command !== "string" || !entry.command.trim()) throw new Error(`Malformed Hermes ${event} hook`);
      if (sameEntry(entry, required[event]) || sameEntry(entry, prior[event])) return false;
      if (entry.command === required[event].command || entry.command === prior[event].command || /(?:^|\s)hook user-prompt --agent hermes(?:\s|$)/.test(entry.command)) throw new Error("Modified Hermes Skills hook requires review before replacement");
      return true;
    });
    if (JSON.stringify(entries) !== JSON.stringify([...retained, required[event]])) doc.setIn(["hooks", event], [...retained, required[event]]);
  }
  return doc.toString({ lineWidth: 0 });
}
export function assertHermesEnvironment(home: string): void {
  // Native Hermes sets this to its working directory before running hooks.
  // Admit that exact directory only: relative paths, aliases and a distinct
  // terminal project would change discovery without changing the hook cwd.
  if (process.env.TERMINAL_CWD && process.env.TERMINAL_CWD !== process.cwd()) throw new Error("NATIVE_SKILL_DRIFT: Hermes TERMINAL_CWD must match the checked process working directory; review the effective project before using this adapter");
  for (const variable of ["HERMES_BUNDLED_PLUGINS", "HERMES_BUNDLED_SKILLS"] as const) {
    // Hermes accepts relative plugin overrides, including whitespace-only paths.
    if (process.env[variable]) throw new Error(`NATIVE_SKILL_DRIFT: Hermes ${variable} requires a dedicated discovery adapter; unset it before using this adapter`);
  }
  const selected = process.env.HERMES_HOME?.trim();
  if (selected && (!isAbsolute(selected) || resolve(selected) !== join(resolve(home), ".hermes"))) throw new Error("NATIVE_SKILL_DRIFT: custom Hermes homes/profiles require their own reviewed bridge");
  if (process.env.HERMES_ENABLE_PROJECT_PLUGINS?.trim() && !["0", "false", "no", "off"].includes(process.env.HERMES_ENABLE_PROJECT_PLUGINS.trim().toLowerCase())) throw new Error("NATIVE_SKILL_DRIFT: Hermes project plugins require a dedicated discovery review");
}
function read(path: string): string | null {
  for (let current = path; ; current = dirname(current)) { if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("NATIVE_SKILL_DRIFT: symlink Hermes protection input"); if (dirname(current) === current) break; }
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error("NATIVE_SKILL_DRIFT: invalid Hermes protection input");
  return readFileSync(path, "utf8");
}
export function assertHermesProtection(home: string, config: Record<string, any>, command: string, profile: string, supervisor: HermesSupervisorBinding): void {
  assertHermesEnvironment(home);
  if (read(join(home, ".hermes", HERMES_OPT_OUT)) === null) throw new Error("NATIVE_SKILL_DRIFT: Hermes bundled skill reseeding is not disabled; run skills hook install");
  if (!supervisor || !isAbsolute(supervisor.path) || supervisor.runtime !== process.execPath || read(supervisor.path) !== renderHermesSupervisor(command, profile)) throw new Error("NATIVE_SKILL_DRIFT: Hermes owned supervisor changed; run skills hook install");
  const raw = read(join(home, ".hermes/shell-hooks-allowlist.json"));
  let trust: any; try { trust = raw === null ? undefined : JSON.parse(raw); } catch { throw new Error("NATIVE_SKILL_DRIFT: invalid Hermes native hook trust"); }
  for (const [event, entry] of Object.entries(hermesHookDefinitions(supervisor))) {
    if (!Array.isArray(config.hooks?.[event]) || config.hooks[event].filter((actual: unknown) => sameEntry(actual, entry)).length !== 1) throw new Error("NATIVE_SKILL_DRIFT: Hermes required native hooks changed; run skills hook install");
    if (!Array.isArray(trust?.approvals) || !trust.approvals.some((approval: any) => object(approval) && approval.event === event && approval.command === entry.command)) throw new Error("NATIVE_SKILL_DRIFT: approve the exact managed commands through Hermes normal native hook trust before starting a session");
  }
  if (config.skills?.platform_disabled !== undefined && !object(config.skills.platform_disabled)) throw new Error("NATIVE_SKILL_DRIFT: malformed Hermes platform skill settings");
  const disabled = config.skills?.disabled;
  if (disabled !== undefined && (!Array.isArray(disabled) || disabled.some((value: unknown) => typeof value !== "string") || disabled.includes("skills-cli"))) throw new Error("NATIVE_SKILL_DRIFT: Hermes Skills CLI bridge is disabled or its names are malformed");
  for (const names of Object.values(config.skills?.platform_disabled ?? {})) if (!Array.isArray(names) || names.some(value => typeof value !== "string") || names.includes("skills-cli")) throw new Error("NATIVE_SKILL_DRIFT: a Hermes platform disables the Skills CLI bridge");
}
/** skill_view also searches legacy <name>.md with rglob, including hidden and
 * dependency directories that the normal SKILL.md index skips. Check the one
 * name admitted by the native tool guard without reading any candidate bytes.
 * Only support folders directly under a real skill descriptor are excluded,
 * matching Hermes is_skill_support_path. Every other bounded path is checked. */
export function assertNoHermesLegacyShadow(root: string): void {
  let entries = 0;
  for (let cursor = resolve(root); ; cursor = dirname(cursor)) {
    if (lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("NATIVE_SKILL_DRIFT: symlink Hermes legacy discovery root");
    if (dirname(cursor) === cursor) break;
  }
  function scan(path: string, depth: number): void {
    if (++entries > 10000 || depth > 64) throw new Error("NATIVE_SKILL_DRIFT: Hermes legacy discovery limit exceeded; review the root before continuing");
    const stat = lstatSync(path, { throwIfNoEntry: false }); if (!stat) return;
    if (stat.isSymbolicLink()) throw new Error("NATIVE_SKILL_DRIFT: symlink Hermes legacy discovery input");
    if (!stat.isDirectory()) { if (!stat.isFile()) throw new Error("NATIVE_SKILL_DRIFT: unsupported Hermes legacy discovery input"); return; }
    if (lstatSync(join(path, "skills-cli.md"), { throwIfNoEntry: false })) throw new Error("NATIVE_SKILL_DRIFT: legacy Hermes skills-cli.md can shadow the owned bridge; preserve and retire it before continuing");
    const hasDescriptor = Boolean(lstatSync(join(path, "SKILL.md"), { throwIfNoEntry: false }));
    const directory = opendirSync(path);
    try {
      for (let child = directory.readSync(); child; child = directory.readSync()) {
        if (hasDescriptor && ["references", "templates", "assets", "scripts"].includes(child.name)) continue;
        scan(join(path, child.name), depth + 1);
      }
    } finally { directory.closeSync(); }
  }
  scan(root, 0);
}
export function normalizeHermesHookInput(input: Record<string, any>): Record<string, any> {
  if (input.hook_event_name === "pre_tool_call") return input;
  if (input.hook_event_name !== "pre_llm_call" || !object(input.extra) || typeof input.extra.user_message !== "string" || typeof input.extra.is_first_turn !== "boolean") throw new Error("Invalid Hermes native prompt payload");
  return { cwd: input.cwd, session_id: input.session_id, prompt: input.extra.user_message, hook_event_name: input.extra.is_first_turn ? "SessionStart" : "UserPromptSubmit" };
}
export function assertHermesTool(input: Record<string, any>): void {
  if (typeof input.tool_name !== "string" || !input.tool_name) throw new Error("Invalid Hermes tool payload");
  if (input.tool_name === "skill_manage" || (input.tool_name === "skill_view" && input.tool_input?.name !== "skills-cli")) throw new Error("NATIVE_SKILL_DRIFT: use skills load/new/prepare/push for payload skills; only skills-cli may be loaded natively");
}

/** Hermes 0.20.5 treats some empty/non-directive child failures as no directive,
 * even with fail_closed. This owned supervisor produces its explicit blocking
 * wire shape and exit 2 for every observed Skills child failure. Native host or
 * supervisor death is outside that guarantee; no native runtime is patched. */
export function renderHermesSupervisor(command: string, profile: string): string {
  quoted(command);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(profile) || profile.includes("..")) throw new Error("Invalid Hermes Skills profile");
  return `// Managed by @hasna/skills. Do not edit; regenerate with skills hook install.
import { readSync } from "node:fs";
import { spawn } from "node:child_process";
const command = ${JSON.stringify(command)}, profile = ${JSON.stringify(profile)};
const event = process.argv[3] === "pre_llm_call" ? "pre_llm_call" : "pre_tool_call";
const refusal = "Required Skills context is unavailable. Stop and repair skills sync/hook installation; do not substitute native payloads.";
let output, failed = false;
try {
  if (process.argv.length !== 4 || process.argv[2] !== "--event" || !["pre_llm_call", "pre_tool_call"].includes(process.argv[3])) throw new Error("Invalid event");
  const chunks = []; let bytes = 0;
  while (true) { const chunk = Buffer.allocUnsafe(8192), count = readSync(0, chunk, 0, chunk.length, null); if (!count) break; bytes += count; if (bytes > 1048576) throw new Error("Input limit"); chunks.push(chunk.subarray(0, count)); }
  const payload = Buffer.concat(chunks);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(command, ["hook", "user-prompt", "--agent", "hermes", "--selection-profile", profile, "--event", event], { stdio: ["pipe", "pipe", "pipe"], detached: true });
    let reason, size = 0, errors = 0, settled = false; const chunks = [];
    const stop = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} } };
    const finish = (code) => { if (settled) return; settled = true; clearTimeout(timer); stop(); child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy(); if (reason || code !== 0) reject(new Error("Skills child failed")); else resolve(Buffer.concat(chunks).toString("utf8")); };
    const timer = setTimeout(() => { reason = "timeout"; stop(); finish(2); }, 12000);
    child.stdout.on("data", chunk => { size += chunk.length; if (size > 65536) { reason = "output-limit"; stop(); finish(2); } else chunks.push(chunk); });
    child.stderr.on("data", chunk => { errors += chunk.length; if (errors > 65536) { reason = "error-limit"; stop(); finish(2); } });
    child.stdin.on("error", () => {});
    child.on("error", () => { reason = "start-error"; finish(2); });
    // Kill descendants even when the leader has already exited; their inherited
    // pipes must not keep this hook alive past its deadline.
    child.on("exit", () => stop()); child.on("close", finish);
    child.stdin.end(payload);
  });
  output = JSON.parse(result);
  if (!output || typeof output !== "object" || Array.isArray(output)) throw new Error("Invalid result");
  const keys = Object.keys(output).sort().join(",");
  if (event === "pre_tool_call") {
    // Do not forward a contradictory native decision/modify directive hidden
    // alongside action:continue. Only the two actual CLI response shapes pass.
    if (!((output.action === "continue" && keys === "action") || (output.action === "block" && keys === "action,message" && typeof output.message === "string"))) throw new Error("Missing or conflicting tool directive");
  } else if (keys !== "context" || typeof output.context !== "string") throw new Error("Missing context directive");
} catch {
  failed = true;
  output = event === "pre_tool_call" ? { action: "block", message: refusal } : { context: refusal };
}
await new Promise((resolve, reject) => process.stdout.write(JSON.stringify(output) + "\\n", error => error ? reject(error) : resolve()));
if (failed) process.exitCode = 2;
`;
}
