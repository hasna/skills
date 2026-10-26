import { OPENCODE_BRIDGE_BODY_SHA256, OPENCODE_BRIDGE_DESCRIPTION_SHA256 } from "./opencode-hook-protocol.js";

/** OpenCode v2.0.32 Promise contract: plugin/module.ts, promise/session.ts,
 * promise/tool.ts and promise/registration.ts in anomalyco/opencode.
 * Prompt admission captures genuine input; context matches/restores at delivery. */
export function renderOpenCodePlugin(command: string, profile: string): string {
  return `// Managed by @hasna/skills. Regenerate with skills hook install --agent opencode.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
const command = ${JSON.stringify(command)};
const profile = ${JSON.stringify(profile)};
const bridgeBodySha256 = ${JSON.stringify(OPENCODE_BRIDGE_BODY_SHA256)};
const bridgeDescriptionSha256 = ${JSON.stringify(OPENCODE_BRIDGE_DESCRIPTION_SHA256)};
function digest(text) { return createHash("sha256").update(text).digest("hex"); }
function canonicalSkill(skill) {
  return skill?.id === "skills-cli" && skill.name === "skills-cli" && typeof skill.path === "string"
    && typeof skill.content === "string" && digest(skill.content) === bridgeBodySha256
    && typeof skill.description === "string" && digest(skill.description) === bridgeDescriptionSha256
    && (skill.autoinvoke === undefined || skill.autoinvoke === false);
}
function refusal() {
  const error = new Error("Skills verification blocked this request. Review the OpenCode Skills hook configuration, then retry.");
  error.name = "SkillsHookRefusal";
  error.skillsHookRefusal = { version: 1, code: "SKILLS_HOOK_REFUSED" };
  return error;
}
export default {
  id: "local.hasna-skills-cli",
  async setup(ctx) {
    if (!ctx?.session?.hook || !ctx?.session?.get || !ctx?.skill?.transform || !ctx?.skill?.list || !ctx?.tool?.hook) throw refusal();
    const registrations = [], pending = new Set(), sessions = new Set(), prompts = new Map();
    let disposed = false;
    function context(input) {
      if (disposed) return Promise.reject(refusal());
      return new Promise((resolve, reject) => {
        const child = spawn(command, ["hook", "user-prompt", "--agent", "opencode", "--selection-profile", profile], { cwd: input.cwd, stdio: ["pipe", "pipe", "pipe"] });
        const chunks = []; let bytes = 0, failed = false;
        const cancel = () => { failed = true; child.kill("SIGKILL"); reject(refusal()); };
        pending.add(cancel);
        const timer = setTimeout(cancel, 15000);
        const finish = () => { clearTimeout(timer); pending.delete(cancel); };
        child.stdout.on("data", chunk => { bytes += chunk.length; if (bytes > 1048576) cancel(); else chunks.push(chunk); });
        child.stderr.on("data", () => {});
        child.stdin.on("error", () => {});
        child.on("error", () => { finish(); reject(refusal()); });
        child.on("close", code => {
          finish();
          if (failed || disposed || code !== 0) return reject(refusal());
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!result || typeof result !== "object" || Array.isArray(result)) throw refusal();
            if (result.decision === "block" || result.continue === false) throw refusal();
            if (Object.keys(result).length && (!result.hookSpecificOutput || result.hookSpecificOutput.hookEventName !== input.hook_event_name)) throw refusal();
            const text = result.hookSpecificOutput?.additionalContext ?? "";
            if (typeof text !== "string") throw refusal();
            if (input.hook_event_name === "BeforeTool" && result.nativeBridgeVerified !== true) throw refusal();
            resolve(text);
          } catch { reject(refusal()); }
        });
        child.stdin.end(JSON.stringify(input));
      });
    }
    async function input(sessionID, prompt, event) {
      if (disposed) throw refusal();
      let session;
      try { session = await ctx.session.get({ sessionID }); } catch { throw refusal(); }
      if (disposed || !session || session.id !== sessionID || typeof session.location?.directory !== "string" || (session.parentID !== undefined && typeof session.parentID !== "string") || session.parentID === sessionID) throw refusal();
      return { hook_event_name: event ?? (!sessions.has(sessionID) ? session.parentID ? "SubagentStart" : "SessionStart" : "UserPromptSubmit"), delivery_phase: event ? "native" : "context", cwd: session.location.directory, session_id: sessionID, parent_session_id: session.parentID ?? null, prompt, restore: true };
    }
    async function dispose() {
      if (disposed) return;
      disposed = true;
      for (const cancel of pending) cancel();
      sessions.clear();
      prompts.clear();
      const results = await Promise.allSettled(registrations.reverse().map(registration => Promise.resolve().then(() => registration.dispose())));
      if (results.some(result => result.status === "rejected")) throw refusal();
    }
    try {
      registrations.push(await ctx.skill.transform(editor => {
        for (const skill of editor.list()) if (!canonicalSkill(skill)) editor.remove(skill.id);
      }));
      async function verifyNativeBridge(sessionID) {
        let skills;
        try { skills = await ctx.skill.list(); } catch { throw refusal(); }
        if (!Array.isArray(skills)) throw refusal();
        const matches = skills.filter(skill => skill?.id === "skills-cli");
        if (matches.length !== 1) throw refusal();
        const skill = matches[0];
        if (!canonicalSkill(skill)) throw refusal();
        const metadata = { id: skill.id, name: skill.name, path: skill.path, contentSha256: digest(skill.content), descriptionSha256: digest(skill.description) };
        await context({ ...await input(sessionID, "", "BeforeTool"), tool_input: { id: "skills-cli" }, native_skill: metadata });
      }
      registrations.push(await ctx.tool.hook("execute.before", async event => {
        if (disposed) throw refusal();
        if (event.tool !== "skill") return;
        if (event.input?.id !== "skills-cli") throw refusal();
        await verifyNativeBridge(event.sessionID);
      }));
      registrations.push(await ctx.session.hook("prompt", async event => {
        if (disposed || typeof event.prompt?.text !== "string" || event.prompt.text.length > 128 * 1024) throw refusal();
        if (event.prompt.skills !== undefined && (!Array.isArray(event.prompt.skills) || event.prompt.skills.some(skill => skill?.id !== "skills-cli"))) throw refusal();
        // Attachments materialize immediately after this hook. Check the actual
        // current registry object and on-disk bridge before native consumption.
        if (event.prompt.skills?.length) await verifyNativeBridge(event.sessionID);
        if (disposed) throw refusal();
        const queued = prompts.get(event.sessionID) ?? [];
        if (queued.reduce((size, entry) => size + entry.text.length + 1, 0) + event.prompt.text.length > 128 * 1024) throw refusal();
        queued.push({ text: event.prompt.text });
        prompts.set(event.sessionID, queued);
      }));
      registrations.push(await ctx.session.hook("context", async event => {
        // Only prompt-hook input has owner-prompt provenance. Keep it transient
        // until the one delivery-bearing CLI call, including an empty prompt.
        // Checkpoints, synthetic user-role history and resumes never match.
        const queued = [...(prompts.get(event.sessionID) ?? [])];
        const text = await context(await input(event.sessionID, queued.map(entry => entry.text).join("\\n")));
        if (disposed) throw refusal();
        if (text) event.system.push({ type: "text", text });
        // Remove only the prompt events this request consumed. New admission
        // while the CLI was running belongs to the next model context.
        const current = prompts.get(event.sessionID);
        if (current) {
          const remaining = current.filter(entry => !queued.includes(entry));
          if (remaining.length) prompts.set(event.sessionID, remaining);
          else prompts.delete(event.sessionID);
        }
        sessions.add(event.sessionID);
      }));
      return dispose;
    } catch {
      await dispose();
      throw refusal();
    }
  },
};
`;
}
