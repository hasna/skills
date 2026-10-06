/** Sumi 0.2.52: Harnesses e6776271ca8065a3a091eacedebd6fd7ef47ccd3,
 * upstream 06b6c916a564c9c88af36cbd19817ba3d4ac4476. Never run its
 * adoptHome resolver during discovery: resolving paths must be read-only. */
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

export function sumiConfigDirectory(home: string, env: NodeJS.ProcessEnv = process.env): string {
  for (const key of ["SUMI_CONFIG", "SUMI_CONFIG_CONTENT"]) if (env[key] !== undefined) throw new Error(`Sumi ${key} requires a dedicated discovery adapter; unset it before Skills integration`);
  const selected = (key: string) => env[key]?.trim() ? env[key]! : undefined;
  const expand = (value: string) => resolve(value === "~" ? home : value.startsWith("~/") ? join(home, value.slice(2)) : value);
  const explicit = selected("SUMI_CONFIG_DIR");
  const xdg = selected("XDG_CONFIG_HOME");
  const custom = selected("SUMI_HOME");
  const canonical = explicit ? expand(explicit) : xdg ? join(expand(xdg), "sumi") : join(custom ? expand(custom) : join(home, ".hasna-internal/sumi"), "config");
  if (explicit || xdg || custom) return canonical;
  const legacy = join(home, ".config/sumi");
  const a = lstatSync(canonical, { throwIfNoEntry: false }), b = lstatSync(legacy, { throwIfNoEntry: false });
  // Two independent roots can contain a partially adopted union. That is not
  // one witnessed config directory and needs owning-app adoption first.
  if (a && b && realpathSync(canonical) !== realpathSync(legacy)) throw new Error("Sumi config roots conflict; complete native home adoption before Skills integration");
  const path = a ? canonical : b ? legacy : canonical;
  if (!existsSync(path)) return path;
  const physical = realpathSync(path);
  if ((a?.isSymbolicLink() || b?.isSymbolicLink()) && ![canonical, legacy].includes(physical)) throw new Error("Sumi config alias must resolve to its canonical or legacy root");
  return physical;
}

export function sumiBridgeRoot(home: string): string { return join(sumiConfigDirectory(home), "skills"); }
export function sumiConfigPath(home: string): string { return join(sumiConfigDirectory(home), "sumi.json"); }

/** Native V2 plugin, not an OpenCode chat.message factory. Instructions enter
 * transient request context; prompts and the plugin carry no payload fallback. */
export function renderSumiPlugin(command: string, profile: string): string {
  return renderSumiPluginVersion(command, profile, false);
}

/** Exact previous generator only: upgrades may replace this owned plugin, never
 * arbitrary plugin bytes. Native discovery and config checks still run first. */
export function isManagedSumiPlugin(text: string | null, command: string, profile: string): boolean {
  return text === renderSumiPlugin(command, profile) || text === renderSumiPluginVersion(command, profile, true);
}

function renderSumiPluginVersion(command: string, profile: string, legacy: boolean): string {
  const failure = (message: string) => legacy ? `new Error(${JSON.stringify(message)})` : "refusal()";
  return `// Managed by @hasna/skills. Regenerate with skills hook install --agent sumi.
import { spawn } from "node:child_process";
const command = ${JSON.stringify(command)};
const profile = ${JSON.stringify(profile)};
${legacy ? "" : `function refusal() {
  const error = new Error("Skills verification blocked this request. Review the Sumi Skills hook configuration, then retry.");
  error.name = "SkillsHookRefusal";
  error.skillsHookRefusal = { version: 1, code: "SKILLS_HOOK_REFUSED" };
  return error;
}
`}function context(input) {
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
        if (result.decision === "block" || result.continue === false) throw ${failure("Skills prompt hook refused")};
        if (Object.keys(result).length && (!result.hookSpecificOutput || result.hookSpecificOutput.hookEventName !== input.hook_event_name)) throw ${failure("Invalid Skills hook response")};
        const text = result.hookSpecificOutput?.additionalContext ?? "";
        if (typeof text !== "string") throw ${failure("Invalid Skills prompt context")};
        resolve(text);
      } catch (error) { reject(${legacy ? "error" : "refusal()"}); }
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
      const session = await ctx.session.get({ sessionID });
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
      const last = event.messages.findLast(message => message.role === "user");
      const prompt = (last?.content ?? []).filter(part => part.type === "text").map(part => part.text).join("\\n");
      // Recheck on every primary request, including resumed and synthetic
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
