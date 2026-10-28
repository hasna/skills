// Managed by @hasna/skills. Regenerate with skills hook install --agent sumi.
import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
const command = "skills";
const profile = "default";
const maxSessionIdChars = 256;
function refusal(reasonCode) {
  const error = new Error("Skills verification blocked this request. Review the Sumi Skills hook configuration, then retry." + (reasonCode ? " [" + reasonCode + "]" : ""));
  error.name = "SkillsHookRefusal";
  error.skillsHookRefusal = { version: 1, code: "SKILLS_HOOK_REFUSED", ...(reasonCode ? { reasonCode } : {}) };
  return error;
}
const reasonCodes = new Set(["SKILLS_API_CREDENTIAL_UNAVAILABLE","SKILLS_API_UNAVAILABLE","SKILLS_API_UNAUTHORIZED","SKILLS_API_FORBIDDEN","SKILLS_API_RESOURCE_UNAVAILABLE","SESSION_WRITE_BUSY","SKILLS_CONTEXT_FAILED","SKILLS_STORAGE_FULL","PROFILE_LOCK_MISMATCH","PROFILE_IDENTITY_MISMATCH","PROFILE_APPLIED_REPORT_FAILED","CACHED_AUTHORITY_REQUIRED","CACHED_PROFILE_EXPIRED","CACHED_PROFILE_MISSING","CACHED_BUNDLE_MISSING","INVALID_CONTEXT_INPUT","CONTEXT_INPUT_TOO_LARGE","INVALID_CONTEXT_BUDGET","INVALID_SELECTION","INVALID_SELECTION_ALIASES","INVALID_RECEIPT","INVALID_CACHE_FILE","UNSAFE_CACHE_PATH","RECEIPT_TOO_LARGE","BUNDLE_DIGEST_MISMATCH","BUNDLE_IDENTITY_MISMATCH","BUNDLE_UNAVAILABLE","BUNDLE_TOO_LARGE","SKILL_NOT_SELECTED","INVALID_SESSION","SESSION_PARENT_NOT_FOUND","SESSION_PARENT_MISMATCH","SESSION_NOT_FOUND","SESSION_GENERATION_CHANGED","SESSION_GENERATION_EXHAUSTED","SESSION_PARENT_CHANGED","SESSION_RECEIPT_CHANGED","SESSION_RECONCILIATION_REQUIRED","SESSION_RENEWAL_TIMEOUT","SESSION_CONTEXT_CONFLICT","SESSION_RECONCILIATION_INCOMPLETE","SESSION_WRITE_LOCKED","SESSION_WRITE_LOCK_CHANGED","SESSION_LOCK_RECOVERY_INCOMPLETE","SKILLS_HOOK_FAILED","SKILLS_HOOK_TIMEOUT","SKILLS_HOOK_INVALID_RESPONSE"]);
function refusedResult(result) {
  const reason = result.reason ?? result.stopReason ?? result.systemMessage;
  if (typeof reason !== "string" || reason.length > 16384) return refusal();
  if (reason.startsWith("NATIVE_SKILL_DRIFT:")) return refusal("NATIVE_SKILL_DRIFT");
  const code = /^Skills context is unavailable \[([A-Z_]+)\]/.exec(reason)?.[1];
  return refusal(reasonCodes.has(code) ? code : undefined);
}
export default {
  id: "local.hasna-skills-cli",
  async setup(ctx) {
    if (!ctx?.session?.hook || !ctx?.session?.get || !ctx?.skill?.transform || !ctx?.tool?.hook) throw refusal();
    const registrations = [], pending = new Set(), sessions = new Set(), notices = new Map();
    let disposed = false;
    function context(input) {
      if (disposed) return Promise.reject(refusal());
      // Match the context child's existing input bound before transport can
      // classify an unavailable child. Invalid input is never optional.
      const serialized = JSON.stringify(input);
      if (Buffer.byteLength(serialized) > 256 * 1024) return Promise.reject(refusal("CONTEXT_INPUT_TOO_LARGE"));
      return new Promise((resolve, reject) => {
        const chunks = []; let bytes = 0, settled = false, child, timer;
        const finish = () => { clearTimeout(timer); pending.delete(cancel); };
        const deny = error => { if (settled) return; settled = true; finish(); reject(error ?? refusal()); };
        const unavailable = code => {
          if (settled) return;
          if (disposed) return deny();
          settled = true; finish();
          resolve({ delivered: false, text: "Skills context is unavailable [SKILLS_HOOK_" + code + "]. No Skills instructions were delivered by this hook. Ordinary work may continue. Do not perform actions that depend on unavailable Skills instructions, including previously loaded instructions. Explicit skills load, context and run still require verification. Do not substitute native, unmanaged or stale payloads." });
        };
        const stop = code => { unavailable(code); child?.kill("SIGKILL"); };
        const cancel = () => { deny(); child?.kill("SIGKILL"); };
        try {
          child = spawn(command, ["hook", "user-prompt", "--agent", "sumi", "--selection-profile", profile], { cwd: input.cwd, stdio: ["pipe", "pipe", "pipe"] });
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
          try { result = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
          catch { unavailable("INVALID_RESPONSE"); return; }
          if (!result || typeof result !== "object" || Array.isArray(result)) return unavailable("INVALID_RESPONSE");
          // A supported policy refusal is an explicit status-0 envelope. Never
          // turn that refusal, including session/receipt integrity, into context.
          if (result.decision === "block" || result.continue === false) return deny(refusedResult(result));
          const output = Object.keys(result).length === 0
            ? { hookEventName: input.hook_event_name, additionalContext: "" }
            : result.hookSpecificOutput;
          if (!output || typeof output !== "object" || Array.isArray(output) || output.hookEventName !== input.hook_event_name || typeof output.additionalContext !== "string") return unavailable("INVALID_RESPONSE");
          settled = true; finish();
          resolve({ delivered: true, text: output.additionalContext });
        });
        try { child.stdin.end(serialized); } catch { stop("TRANSPORT_FAILED"); }
      });
    }
    async function input(sessionID, prompt, first) {
      if (disposed) throw refusal();
      if (typeof sessionID !== "string" || !sessionID.trim() || sessionID.length > maxSessionIdChars) throw refusal("INVALID_SESSION");
      let session;
      try { session = await ctx.session.get({ sessionID }); } catch { throw refusal(); }
      if (disposed || !session || session.id !== sessionID || typeof session.location?.directory !== "string" || !isAbsolute(session.location.directory) || session.location.directory.includes("\0") || (session.parentID !== undefined && (typeof session.parentID !== "string" || !session.parentID.trim() || session.parentID.length > maxSessionIdChars)) || session.parentID === sessionID) throw refusal();
      return { hook_event_name: first ? session.parentID ? "SubagentStart" : "SessionStart" : "UserPromptSubmit", cwd: session.location.directory, session_id: sessionID, parent_session_id: session.parentID ?? null, prompt, restore: true };
    }
    async function dispose() {
      if (disposed) return;
      disposed = true;
      for (const cancel of pending) cancel();
      sessions.clear(); notices.clear();
      const results = await Promise.allSettled(registrations.reverse().map(registration => Promise.resolve().then(() => registration.dispose())));
      if (results.some(result => result.status === "rejected")) throw refusal();
    }
    try {
      registrations.push(await ctx.skill.transform(editor => {
        for (const skill of editor.list()) if (skill.id !== "skills-cli" || skill.name !== "skills-cli") editor.remove(skill.id);
      }));
      registrations.push(await ctx.tool.hook("execute.before", event => {
        if (disposed) throw refusal();
        if (event.tool === "skill" && event.input?.id !== "skills-cli") throw refusal();
      }));
      registrations.push(await ctx.session.hook("prompt", async event => {
        if (disposed || typeof event.prompt?.text !== "string") throw refusal();
        if (event.prompt.text.length > 128 * 1024) throw refusal("CONTEXT_INPUT_TOO_LARGE");
        if (event.prompt.skills !== undefined && (!Array.isArray(event.prompt.skills) || event.prompt.skills.some(skill => skill?.id !== "skills-cli"))) throw refusal();
        const result = await context(await input(event.sessionID, event.prompt.text, !sessions.has(event.sessionID)));
        if (disposed) throw refusal();
        if (result.delivered) sessions.add(event.sessionID);
        // Admission has no model-context output. Retain one fixed warning until
        // delivery, never the prompt text or an unverified child payload.
        else notices.set(event.sessionID, { text: result.text });
      }));
      registrations.push(await ctx.session.hook("context", async event => {
        // Owner input is matched only at admission. History and checkpoints
        // cannot introduce new selections, including after transport failure.
        const notice = notices.get(event.sessionID);
        const result = await context(await input(event.sessionID, "", !sessions.has(event.sessionID)));
        if (disposed) throw refusal();
        // An unavailable admission did not verify its requested selection.
        // Report it for this turn instead of silently using restored old skills.
        const text = notice?.text ?? result.text;
        if (text) event.system.push({ type: "text", text });
        if (notice && notices.get(event.sessionID) === notice) notices.delete(event.sessionID);
        if (result.delivered && !notice) sessions.add(event.sessionID);
      }));
      return dispose;
    } catch {
      await dispose();
      throw refusal();
    }
  },
};
