// Managed by @hasna/skills. Regenerate with skills hook install --agent sumi.
import { spawn } from "node:child_process";
const command = "skills";
const profile = "default";
function refusal() {
  const error = new Error("Skills verification blocked this request. Review the Sumi Skills hook configuration, then retry.");
  error.name = "SkillsHookRefusal";
  error.skillsHookRefusal = { version: 1, code: "SKILLS_HOOK_REFUSED" };
  return error;
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
        if (result.decision === "block" || result.continue === false) throw refusal();
        if (Object.keys(result).length && (!result.hookSpecificOutput || result.hookSpecificOutput.hookEventName !== input.hook_event_name)) throw refusal();
        const text = result.hookSpecificOutput?.additionalContext ?? "";
        if (typeof text !== "string") throw refusal();
        resolve(text);
      } catch (error) { reject(refusal()); }
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
      const last = event.messages.findLast(message => message.role === "user");
      const prompt = (last?.content ?? []).filter(part => part.type === "text").map(part => part.text).join("\n");
      // Recheck on every primary request, including resumed and synthetic
      // sessions. The CLI owns optional failures versus explicit refusals.
      const text = await context(await input(event.sessionID, prompt, !sessions.has(event.sessionID)));
      if (text) event.system.push({ type: "text", text });
      sessions.add(event.sessionID);
    }));
    return async () => { for (const registration of registrations) await registration.dispose(); };
  },
};
