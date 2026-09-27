export const INTEGRATION_AGENTS = ["claude", "codex", "gemini", "opencode", "cursor", "hermes"] as const;
export type IntegrationAgent = typeof INTEGRATION_AGENTS[number];
export function renderAgentHookCommand(command: string, agent: IntegrationAgent, profileId: string, event: string): string {
  if (typeof profileId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(profileId) || profileId.includes("..")) throw new Error("Invalid selection profile id");
  return `'${command.replace(/'/g, `'\\''`)}' hook user-prompt --agent ${agent} --selection-profile ${profileId} --event ${event}`;
}
export const AGENT_ADAPTERS = {
  claude: { root: ".claude/skills", config: ".claude/settings.json", events: ["UserPromptSubmit", "SessionStart", "SubagentStart"], promptContext: true },
  codex: { root: ".codex/skills", config: ".codex/hooks.json", events: ["UserPromptSubmit", "SessionStart", "SubagentStart"], promptContext: true },
  gemini: { root: ".gemini/skills", config: ".gemini/settings.json", events: ["BeforeAgent", "SessionStart"], promptContext: true },
  opencode: { root: ".config/opencode/skills", config: ".config/opencode/opencode.json", events: ["chat.message"], promptContext: true },
  hermes: { root: ".hermes/skills", config: ".hermes/config.yaml", events: ["pre_llm_call", "pre_tool_call"], promptContext: true, promptFailureMode: "open", toolFailureMode: "supervised-child-errors-block", requiresNativeTrust: true },
  cursor: { root: ".cursor/skills", config: ".cursor/hooks.json", events: ["beforeSubmitPrompt", "sessionStart"], promptContext: false },
} as const;

export function normalizeAgentHookEvent(agent: IntegrationAgent, event: string): string {
  if (agent === "gemini" && event === "BeforeAgent") return "UserPromptSubmit";
  if (agent === "cursor") {
    if (event === "beforeSubmitPrompt") return "UserPromptSubmit";
    if (event === "sessionStart") return "SessionStart";
  }
  return event;
}

export function renderOpenCodePlugin(command: string, profileId: string): string {
  // No package dependency, shell interpolation, provider call, or saved prompt.
  // OpenCode awaits chat.message; throwing refuses the message before its model call.
  return `// Managed by @hasna/skills. Regenerate with skills hook install --agent opencode.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
const command = ${JSON.stringify(command)};
const profile = ${JSON.stringify(profileId)};
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
      const text = await context({ hook_event_name: first ? "SessionStart" : "UserPromptSubmit", cwd: directory, session_id: input.sessionID, prompt: parts.map(part => part.text).join("\\n") });
      if (text && parts.length) parts[0].text += "\\n\\n" + text;
      else if (text) output.parts.push({ id: "prt_" + randomUUID().replaceAll("-", ""), sessionID: input.sessionID, messageID: output.message.id, type: "text", text, synthetic: true });
      if (sessions.size >= 1000) sessions.clear();
      sessions.add(input.sessionID);
    },
    "tool.execute.before": async (input, output) => {
      if (input.tool === "skill" && output.args?.name !== "skills-cli") throw new Error("Load instructions through the Skills CLI bridge");
    },
  };
};
`;
}
