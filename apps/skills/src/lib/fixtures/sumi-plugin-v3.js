// Managed by @hasna/skills. Regenerate with skills hook install --agent sumi.
import { spawn } from "node:child_process";
const command = "skills";
const profile = "default";
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
function context(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["hook", "user-prompt", "--agent", "sumi", "--selection-profile", profile], { cwd: input.cwd, stdio: ["pipe", "pipe", "pipe"] });
    const chunks = []; let bytes = 0, failure;
    const timer = setTimeout(() => { failure = refusal(); child.kill("SIGKILL"); }, 15000);
    child.stdout.on("data", chunk => { bytes += chunk.length; if (bytes > 1048576) { failure = refusal(); child.kill("SIGKILL"); } else chunks.push(chunk); });
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => {});
    child.on("error", error => { clearTimeout(timer); reject(refusal()); });
    child.on("close", code => {
      clearTimeout(timer);
      if (failure || code !== 0) return reject(failure ?? refusal());
      try {
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!result || typeof result !== "object" || Array.isArray(result)) throw refusal();
        if (result.decision === "block" || result.continue === false) throw refusedResult(result);
        if (Object.keys(result).length && (!result.hookSpecificOutput || result.hookSpecificOutput.hookEventName !== input.hook_event_name)) throw refusal();
        const text = result.hookSpecificOutput?.additionalContext ?? "";
        if (typeof text !== "string") throw refusal();
        resolve(text);
      } catch (error) { reject(error instanceof Error && error.name === "SkillsHookRefusal" ? error : refusal()); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
export default {
  id: "local.hasna-skills-cli",
  async setup(ctx) {
    if (!ctx?.session?.hook || !ctx?.session?.get || !ctx?.skill?.transform || !ctx?.tool?.hook) throw refusal();
    const registrations = [];
    const sessions = new Set();
    async function input(sessionID, prompt, first) {
      // The Promise adapter unwraps single-data endpoint responses.
      let session;
      try { session = await ctx.session.get({ sessionID }); } catch { throw refusal(); }
      if (!session || session.id !== sessionID || typeof session.location?.directory !== "string" || (session.parentID !== undefined && typeof session.parentID !== "string") || session.parentID === sessionID) throw refusal();
      return { hook_event_name: first ? session.parentID ? "SubagentStart" : "SessionStart" : "UserPromptSubmit", cwd: session.location.directory, session_id: sessionID, parent_session_id: session.parentID ?? null, prompt, restore: true };
    }
    registrations.push(await ctx.skill.transform(editor => {
      for (const skill of editor.list()) if (skill.id !== "skills-cli" || skill.name !== "skills-cli") editor.remove(skill.id);
    }));
    // Native config transforms may add skills after this transform. Guard
    // both direct tool calls and prompt attachments at the consumption edge.
    registrations.push(await ctx.tool.hook("execute.before", event => {
      if (event.tool === "skill" && event.input?.id !== "skills-cli") throw refusal();
    }));
    registrations.push(await ctx.session.hook("prompt", async event => {
      if (typeof event.prompt?.text !== "string") throw refusal();
      if (event.prompt.skills !== undefined && (!Array.isArray(event.prompt.skills) || event.prompt.skills.some(skill => skill?.id !== "skills-cli"))) throw refusal();
      await context(await input(event.sessionID, event.prompt.text, !sessions.has(event.sessionID)));
      sessions.add(event.sessionID);
    }));
    registrations.push(await ctx.session.hook("context", async event => {
      // Model messages also contain checkpoints, attachments and synthetic
      // user-role history, with no owner-prompt provenance. Prompt admission
      // already matched and persisted Skills; restore that verified state only.
      const prompt = "";
      // Recheck on every primary request, including resumed and synthetic
      // sessions. The CLI owns optional failures versus explicit refusals.
      const text = await context(await input(event.sessionID, prompt, !sessions.has(event.sessionID)));
      if (text) event.system.push({ type: "text", text });
      sessions.add(event.sessionID);
    }));
    return async () => { for (const registration of registrations) await registration.dispose(); };
  },
};
