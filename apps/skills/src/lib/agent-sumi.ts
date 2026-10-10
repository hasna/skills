/** Sumi 0.2.52: Harnesses e6776271ca8065a3a091eacedebd6fd7ef47ccd3,
 * upstream 06b6c916a564c9c88af36cbd19817ba3d4ac4476. Never run its
 * adoptHome resolver during discovery: resolving paths must be read-only. */
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { HOOK_REFUSAL_REASON_CODES } from "./hook-diagnostics.js";

const SUMI_PATH_SELECTORS = ["SUMI_HOME", "SUMI_CONFIG_DIR", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME"] as const;
const SUMI_PATH_KEYS = ["data", "cache", "config", "state"] as const;
const SUMI_PATH_OUTPUT_LIMIT = 128 * 1024;

export type SumiPathPlan = {
  schemaVersion: 1;
  kind: "sumi-paths";
  home: string;
  cwd: string;
  roots: Record<typeof SUMI_PATH_KEYS[number], string>;
  legacyRoots: Record<typeof SUMI_PATH_KEYS[number], string | null>;
  configFiles: { canonical: string; legacy: string | null };
  skillRoots: { canonical: string; legacy: string | null };
};

export class SumiPathResolverError extends Error {
  constructor(readonly code: string) { super(`Sumi path discovery refused (${code})`); this.name = "SumiPathResolverError"; }
}

function recordWithKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function absolutePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 32768
    && !/[\x00-\x1f\x7f]/.test(value) && isAbsolute(value) && resolve(value) === value;
}

function absoluteInput(value: string): boolean {
  return value.length > 0 && value.length <= 32768 && !/[\x00-\x1f\x7f]/.test(value) && isAbsolute(value);
}

function resolveSumiPathsCommand(pathValue: string | undefined): string | null {
  if (!pathValue) return null;
  for (const directory of pathValue.split(delimiter)) {
    // Empty PATH elements search cwd implicitly. Do not turn that into a
    // package resolver: only an explicit installed-bin directory is eligible.
    if (!directory || /[\x00-\x1f\x7f]/.test(directory)) continue;
    const candidate = resolve(directory, "sumi-paths");
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch { /* try the next PATH directory */ }
  }
  return null;
}

function validPathPlan(value: unknown, home: string, cwd: string): value is SumiPathPlan {
  if (!recordWithKeys(value, ["schemaVersion", "kind", "home", "cwd", "roots", "legacyRoots", "configFiles", "skillRoots"])) return false;
  if (value.schemaVersion !== 1 || value.kind !== "sumi-paths" || value.home !== resolve(home) || value.cwd !== resolve(cwd)) return false;
  if (!recordWithKeys(value.roots, SUMI_PATH_KEYS) || !recordWithKeys(value.legacyRoots, SUMI_PATH_KEYS)) return false;
  for (const key of SUMI_PATH_KEYS) {
    if (!absolutePath(value.roots[key])) return false;
    if (value.legacyRoots[key] !== null && !absolutePath(value.legacyRoots[key])) return false;
  }
  if (!recordWithKeys(value.configFiles, ["canonical", "legacy"]) || !recordWithKeys(value.skillRoots, ["canonical", "legacy"])) return false;
  if (!absolutePath(value.configFiles.canonical) || !absolutePath(value.skillRoots.canonical)) return false;
  if (value.configFiles.legacy !== null && !absolutePath(value.configFiles.legacy)) return false;
  if (value.skillRoots.legacy !== null && !absolutePath(value.skillRoots.legacy)) return false;
  const configRoot = value.roots.config;
  const legacyConfigRoot = value.legacyRoots.config;
  if (typeof configRoot !== "string" || (legacyConfigRoot !== null && typeof legacyConfigRoot !== "string")) return false;
  if (value.configFiles.canonical !== join(configRoot, "sumi.json") || value.skillRoots.canonical !== join(configRoot, "skills")) return false;
  if (legacyConfigRoot === null) return value.configFiles.legacy === null && value.skillRoots.legacy === null;
  return value.configFiles.legacy === join(legacyConfigRoot, "sumi.json") && value.skillRoots.legacy === join(legacyConfigRoot, "skills");
}

/** Resolve native paths through Sumi's dedicated, read-only command. Never
 * probe the general Sumi CLI: older versions may adopt their home on startup. */
export function sumiPathPlan(home: string, cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): SumiPathPlan {
  for (const key of ["SUMI_CONFIG", "SUMI_CONFIG_CONTENT"]) if (env[key] !== undefined) throw new SumiPathResolverError("SUMI_PATH_CONFIG_UNSUPPORTED");
  if (!absoluteInput(home) || !absoluteInput(cwd)) throw new SumiPathResolverError("SUMI_PATH_INPUT_REFUSED");
  const runtimePath = process.env.PATH ?? "";
  const executable = resolveSumiPathsCommand(runtimePath);
  if (!executable || !isAbsolute(executable)) throw new SumiPathResolverError("SUMI_PATH_RESOLVER_UNAVAILABLE");
  const childEnv: NodeJS.ProcessEnv = { PATH: runtimePath };
  for (const key of SUMI_PATH_SELECTORS) if (env[key] !== undefined) childEnv[key] = env[key];
  let child: ReturnType<typeof spawnSync>;
  try {
    child = spawnSync(executable, ["--json", "--home", resolve(home), "--cwd", resolve(cwd)], {
      cwd: resolve(cwd), env: childEnv, encoding: "buffer", timeout: 3000, maxBuffer: SUMI_PATH_OUTPUT_LIMIT, shell: false,
    });
  } catch { throw new SumiPathResolverError("SUMI_PATH_RESOLVER_UNAVAILABLE"); }
  const stdoutBytes = child.stdout === null ? 0 : Buffer.byteLength(child.stdout);
  const stderrBytes = child.stderr === null ? 0 : Buffer.byteLength(child.stderr);
  if (child.error || child.signal || !child.stdout || stdoutBytes > SUMI_PATH_OUTPUT_LIMIT || stderrBytes > 0) {
    throw new SumiPathResolverError("SUMI_PATH_RESOLVER_UNAVAILABLE");
  }
  let result: unknown;
  try { result = JSON.parse(child.stdout.toString("utf8")); } catch { throw new SumiPathResolverError("SUMI_PATH_RESOLVER_INVALID_RESPONSE"); }
  if (recordWithKeys(result, ["schemaVersion", "kind", "code"]) && result.schemaVersion === 1 && result.kind === "sumi-paths-error"
    && (result.code === "SUMI_PATH_INPUT_REFUSED" || result.code === "SUMI_PATH_CONFIG_UNSUPPORTED") && child.status === 2) {
    throw new SumiPathResolverError(result.code);
  }
  if (child.status !== 0 || !validPathPlan(result, home, cwd)) throw new SumiPathResolverError("SUMI_PATH_RESOLVER_INVALID_RESPONSE");
  return result;
}

function selectedConfigDirectory(plan: SumiPathPlan): string {
  const canonical = plan.roots.config, legacy = plan.legacyRoots.config;
  if (legacy === null) return existsSync(canonical) ? realpathSync(canonical) : canonical;
  const canonicalStat = lstatSync(canonical, { throwIfNoEntry: false }), legacyStat = lstatSync(legacy, { throwIfNoEntry: false });
  // Keep the prior conflict refusal: two independent stores need Sumi's home
  // adoption, not a Skills-side guess at which copy is authoritative.
  if (canonicalStat && legacyStat && realpathSync(canonical) !== realpathSync(legacy)) throw new Error("Sumi config roots conflict; complete native home adoption before Skills integration");
  const selected = canonicalStat ? canonical : legacyStat ? legacy : canonical;
  if (!existsSync(selected)) return selected;
  const physical = realpathSync(selected);
  if ((canonicalStat?.isSymbolicLink() || legacyStat?.isSymbolicLink()) && ![canonical, legacy].includes(physical)) throw new Error("Sumi config alias must resolve to its canonical or legacy root");
  return physical;
}

export function sumiConfigDirectory(home: string, env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  return selectedConfigDirectory(sumiPathPlan(home, cwd, env));
}

export function sumiSkillRoots(home: string, cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): string[] {
  const plan = sumiPathPlan(home, cwd, env);
  return [join(selectedConfigDirectory(plan), "skills")];
}

export function sumiBridgeRoot(home: string, cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  return sumiSkillRoots(home, cwd, env)[0]!;
}

export function sumiConfigPath(home: string, cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  return join(sumiConfigDirectory(home, env, cwd), "sumi.json");
}

/** Native V2 plugin, not an OpenCode chat.message factory. Instructions enter
 * transient request context; prompts and the plugin carry no payload fallback. */
export function renderSumiPlugin(command: string, profile: string): string {
  return renderSumiPluginVersion(command, profile, 3);
}

/** Exact previous generator only: upgrades may replace this owned plugin, never
 * arbitrary plugin bytes. Native discovery and config checks still run first. */
export function isManagedSumiPlugin(text: string | null, command: string, profile: string): boolean {
  return text === renderSumiPlugin(command, profile) || text === renderSumiPluginVersion(command, profile, 2)
    || text === renderSumiPluginVersion(command, profile, 1);
}

function renderSumiPluginVersion(command: string, profile: string, version: 1 | 2 | 3): string {
  const legacy = version === 1;
  const failure = (message: string) => legacy ? `new Error(${JSON.stringify(message)})` : "refusal()";
  return `// Managed by @hasna/skills. Regenerate with skills hook install --agent sumi.
import { spawn } from "node:child_process";
const command = ${JSON.stringify(command)};
const profile = ${JSON.stringify(profile)};
${legacy ? "" : `function refusal(${version === 3 ? "reasonCode" : ""}) {
  const error = new Error("Skills verification blocked this request. Review the Sumi Skills hook configuration, then retry."${version === 3 ? ' + (reasonCode ? " [" + reasonCode + "]" : "")' : ""});
  error.name = "SkillsHookRefusal";
  error.skillsHookRefusal = { version: 1, code: "SKILLS_HOOK_REFUSED"${version === 3 ? ", ...(reasonCode ? { reasonCode } : {})" : ""} };
  return error;
}
`}${version === 3 ? `const reasonCodes = new Set(${JSON.stringify(HOOK_REFUSAL_REASON_CODES)});
function refusedResult(result) {
  const reason = result.reason ?? result.stopReason ?? result.systemMessage;
  if (typeof reason !== "string" || reason.length > 16384) return refusal();
  if (reason.startsWith("NATIVE_SKILL_DRIFT:")) return refusal("NATIVE_SKILL_DRIFT");
  const code = /^Skills context is unavailable \\[([A-Z_]+)\\]/.exec(reason)?.[1];
  return refusal(reasonCodes.has(code) ? code : undefined);
}
` : ""}function context(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["hook", "user-prompt", "--agent", "sumi", "--selection-profile", profile], { cwd: input.cwd, stdio: ["pipe", "pipe", "pipe"] });
    const chunks = []; let bytes = 0, failure;
    const timer = setTimeout(() => { failure = ${failure("Skills prompt hook timed out")}; child.kill("SIGKILL"); }, 15000);
    child.stdout.on("data", chunk => { bytes += chunk.length; if (bytes > 1048576) { failure = ${failure("Skills prompt hook output exceeded its limit")}; child.kill("SIGKILL"); } else chunks.push(chunk); });
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => {});
    child.on("error", error => { clearTimeout(timer); reject(${legacy ? "error" : "refusal()"}); });
    child.on("close", code => {
      clearTimeout(timer);
      if (failure || code !== 0) return reject(failure ?? ${failure("Skills prompt hook failed")});
      try {
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!result || typeof result !== "object" || Array.isArray(result)) throw ${failure("Invalid Skills hook response")};
        if (result.decision === "block" || result.continue === false) throw ${version === 3 ? "refusedResult(result)" : failure("Skills prompt hook refused")};
        if (Object.keys(result).length && (!result.hookSpecificOutput || result.hookSpecificOutput.hookEventName !== input.hook_event_name)) throw ${failure("Invalid Skills hook response")};
        const text = result.hookSpecificOutput?.additionalContext ?? "";
        if (typeof text !== "string") throw ${failure("Invalid Skills prompt context")};
        resolve(text);
      } catch (error) { reject(${legacy ? "error" : version === 3 ? 'error instanceof Error && error.name === "SkillsHookRefusal" ? error : refusal()' : "refusal()"}); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
export default {
  id: "local.hasna-skills-cli",
  async setup(ctx) {
    if (!ctx?.session?.hook || !ctx?.session?.get || !ctx?.skill?.transform || !ctx?.tool?.hook) throw ${failure("Unsupported Sumi native Skills contract")};
    const registrations = [];
    const sessions = new Set();
    async function input(sessionID, prompt, first) {
      // The Promise adapter unwraps single-data endpoint responses.
      ${legacy ? "const session = await ctx.session.get({ sessionID });" : "let session;\n      try { session = await ctx.session.get({ sessionID }); } catch { throw refusal(); }"}
      if (!session || session.id !== sessionID || typeof session.location?.directory !== "string" || (session.parentID !== undefined && typeof session.parentID !== "string") || session.parentID === sessionID) throw ${failure("Invalid Sumi session custody")};
      return { hook_event_name: first ? session.parentID ? "SubagentStart" : "SessionStart" : "UserPromptSubmit", cwd: session.location.directory, session_id: sessionID, parent_session_id: session.parentID ?? null, prompt, restore: true };
    }
    registrations.push(await ctx.skill.transform(editor => {
      for (const skill of editor.list()) if (skill.id !== "skills-cli" || skill.name !== "skills-cli") editor.remove(skill.id);
    }));
    // Native config transforms may add skills after this transform. Guard
    // both direct tool calls and prompt attachments at the consumption edge.
    registrations.push(await ctx.tool.hook("execute.before", event => {
      if (event.tool === "skill" && event.input?.id !== "skills-cli") throw ${failure("Native Sumi skill payload refused; use Skills CLI")};
    }));
    registrations.push(await ctx.session.hook("prompt", async event => {
      if (typeof event.prompt?.text !== "string") throw ${failure("Invalid Sumi prompt")};
      if (event.prompt.skills !== undefined && (!Array.isArray(event.prompt.skills) || event.prompt.skills.some(skill => skill?.id !== "skills-cli"))) throw ${failure("Native Sumi skill attachment refused; use Skills CLI")};
      await context(await input(event.sessionID, event.prompt.text, !sessions.has(event.sessionID)));
      sessions.add(event.sessionID);
    }));
    registrations.push(await ctx.session.hook("context", async event => {
${version === 3 ? `      // Model messages also contain checkpoints, attachments and synthetic
      // user-role history, with no owner-prompt provenance. Prompt admission
      // already matched and persisted Skills; restore that verified state only.
      const prompt = "";
` : `      const last = event.messages.findLast(message => message.role === "user");
      const prompt = (last?.content ?? []).filter(part => part.type === "text").map(part => part.text).join("\\n");
`}      // Recheck on every primary request, including resumed and synthetic
      // sessions. The CLI owns optional failures versus explicit refusals.
      const text = await context(await input(event.sessionID, prompt, !sessions.has(event.sessionID)));
      if (text) event.system.push({ type: "text", text });
      sessions.add(event.sessionID);
    }));
    return async () => { for (const registration of registrations) await registration.dispose(); };
  },
};
`;
}

export const SUMI_SKILL_PERMISSIONS = [
  { action: "skill", resource: "*", effect: "deny" },
  { action: "skill", resource: "skills-cli", effect: "allow" },
] as const;
