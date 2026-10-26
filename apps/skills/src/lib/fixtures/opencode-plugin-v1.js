// Managed by @hasna/skills. Regenerate with skills hook install --agent opencode.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
const command = "skills";
const profile = "default";
function context(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["hook", "user-prompt", "--agent", "opencode", "--selection-profile", profile], { cwd: input.cwd, stdio: ["pipe", "pipe", "pipe"] });
    const chunks = []; let bytes = 0, failure;
    const timer = setTimeout(() => { failure = new Error("Skills prompt hook timed out"); child.kill("SIGKILL"); }, 15000);
    child.stdout.on("data", chunk => { bytes += chunk.length; if (bytes > 1048576) { failure = new Error("Skills prompt hook output exceeded its limit"); child.kill("SIGKILL"); } else chunks.push(chunk); });
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => {});
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (failure || code !== 0) return reject(failure ?? new Error("Skills prompt hook failed"));
      try {
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid Skills hook response");
        if (result.decision === "block" || result.continue === false) throw new Error(result.reason ?? result.stopReason ?? "Skills prompt hook refused");
        if (Object.keys(result).length && (!result.hookSpecificOutput || result.hookSpecificOutput.hookEventName !== input.hook_event_name)) throw new Error("Invalid Skills hook response");
        const text = result.hookSpecificOutput?.additionalContext ?? "";
        if (typeof text !== "string") throw new Error("Invalid Skills prompt context");
        resolve(text);
      } catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
export default async ({ directory }) => {
  const sessions = new Set();
  return {
    "chat.message": async (input, output) => {
      const parts = output.parts.filter(part => part.type === "text" && typeof part.text === "string");
      const first = !sessions.has(input.sessionID);
      const text = await context({ hook_event_name: first ? "SessionStart" : "UserPromptSubmit", cwd: directory, session_id: input.sessionID, prompt: parts.map(part => part.text).join("\n") });
      if (text && parts.length) parts[0].text += "\n\n" + text;
      else if (text) output.parts.push({ id: "prt_" + randomUUID().replaceAll("-", ""), sessionID: input.sessionID, messageID: output.message.id, type: "text", text, synthetic: true });
      if (sessions.size >= 1000) sessions.clear();
      sessions.add(input.sessionID);
    },
    "tool.execute.before": async (input, output) => {
      if (input.tool === "skill" && output.args?.name !== "skills-cli") throw new Error("Load instructions through the Skills CLI bridge");
    },
  };
};
