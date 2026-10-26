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
        // Availability failures may omit optional model context. Native skill
        // consumption and explicit policy refusals always remain fail-closed.
        const optional = input.delivery_phase === "context";
        const chunks = []; let bytes = 0, settled = false, child, timer;
        const finish = () => { clearTimeout(timer); pending.delete(cancel); };
        const deny = () => { if (settled) return; settled = true; finish(); reject(refusal()); };
        const unavailable = code => {
          if (settled) return;
          if (!optional || disposed) return deny();
          settled = true; finish();
          resolve({ delivered: false, text: "Skills context is unavailable [SKILLS_HOOK_" + code + "]. No Skills instructions were delivered by this hook. Ordinary work may continue. Do not perform actions that depend on unavailable Skills instructions, including previously loaded instructions. Explicit skills load, context and run still require verification. Do not substitute native, unmanaged or stale payloads." });
        };
        const stop = code => { unavailable(code); child?.kill("SIGKILL"); };
        const cancel = () => { deny(); child?.kill("SIGKILL"); };
        try {
          child = spawn(command, ["hook", "user-prompt", "--agent", "opencode", "--selection-profile", profile], { cwd: input.cwd, stdio: ["pipe", "pipe", "pipe"] });
        } catch { unavailable("SPAWN_FAILED"); return; }
        pending.add(cancel);
        timer = setTimeout(() => stop("TIMEOUT"), 15000);
        child.stdout.on("data", chunk => { if (settled) return; bytes += chunk.length; if (bytes > 1048576) stop("OUTPUT_LIMIT"); else chunks.push(chunk); });
        child.stdout.on("error", () => stop("TRANSPORT_FAILED"));
        child.stderr.on("data", () => {});
        child.stderr.on("error", () => stop("TRANSPORT_FAILED"));
        child.stdin.on("error", () => stop("TRANSPORT_FAILED"));
        child.on("error", () => unavailable("SPAWN_FAILED"));
        child.on("close", code => {
          if (settled) return;
          if (disposed) return deny();
          if (code !== 0) return unavailable("CHILD_FAILED");
          let result;
          try {
            result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch { unavailable("INVALID_RESPONSE"); return; }
          if (!result || typeof result !== "object" || Array.isArray(result)) return unavailable("INVALID_RESPONSE");
          if (result.decision === "block" || result.continue === false) return deny();
          // hookContextOutput returns exactly {} for a successful empty
          // context. It never attests native bridge verification.
          const output = optional && Object.keys(result).length === 0
            ? { hookEventName: input.hook_event_name, additionalContext: "" }
            : result.hookSpecificOutput;
          if (!output || typeof output !== "object" || Array.isArray(output) || output.hookEventName !== input.hook_event_name || typeof output.additionalContext !== "string") return unavailable("INVALID_RESPONSE");
          if (input.hook_event_name === "BeforeTool" && result.nativeBridgeVerified !== true) return deny();
          settled = true; finish();
          resolve({ delivered: true, text: output.additionalContext });
        });
        try { child.stdin.end(JSON.stringify(input)); } catch { stop("TRANSPORT_FAILED"); }
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
        const result = await context(await input(event.sessionID, queued.map(entry => entry.text).join("\\n")));
        if (disposed) throw refusal();
        if (result.text) event.system.push({ type: "text", text: result.text });
        // Remove only the prompt events this request consumed. New admission
        // while the CLI was running belongs to the next model context.
        const current = prompts.get(event.sessionID);
        if (current) {
          const remaining = current.filter(entry => !queued.includes(entry));
          if (remaining.length) prompts.set(event.sessionID, remaining);
          else prompts.delete(event.sessionID);
        }
        // Retry SessionStart on the next context after an unavailable child,
        // but never replay prompt text already admitted to this model turn.
        if (result.delivered) sessions.add(event.sessionID);
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
